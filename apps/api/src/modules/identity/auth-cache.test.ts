import { describe, expect, it, vi } from 'vitest';
import { DriverError } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { AuthCache, authCacheTtlMsFromEnv, cachedIdentityRepository, type AuthDrop, type AuthDropBus } from './auth-cache.js';
import { RecordingEventEmitter } from './events.adapter.js';
import { IdentityService } from './identity.service.js';
import { InMemoryIdentityRepository } from './memory.repository.js';
import { DEFAULT_OTP_GUARD, OtpGuard, RecordingOtpAlerts } from './rate-limit.js';
import { SessionService } from './session.service.js';
import { FakeSmsProvider } from './sms/fake.provider.js';
import { fakeRunner, PEPPER } from './test-harness.js';
import { InMemoryWindowCounter } from '../../shared/window-counter.js';

/** Two API machines sharing one database; drops travel between them like Redis pub/sub. */
class LinkedBus implements AuthDropBus {
  private readonly peers: LinkedBus[] = [];
  private onDrop: (d: AuthDrop) => void = () => {};
  private onGap: () => void = () => {};
  link(other: LinkedBus) {
    this.peers.push(other);
    other.peers.push(this);
  }
  async publish(drop: AuthDrop) {
    for (const p of this.peers) p.onDrop(drop);
  }
  listen(onDrop: (d: AuthDrop) => void, onGap: () => void) {
    this.onDrop = onDrop;
    this.onGap = onGap;
  }
  gap() {
    this.onGap();
  }
  async close() {}
}

function machine(db: InMemoryIdentityRepository, clock: FakeClock, bus: LinkedBus, ttlMs = 30_000) {
  const cache = new AuthCache(clock, ttlMs, bus);
  const repo = cachedIdentityRepository(db, cache);
  const { runner } = fakeRunner();
  const sessions = new SessionService(repo, clock, { keys: [{ kid: 'k1', secret: 'unit-test-secret' }], activeKid: 'k1' });
  const sms = new FakeSmsProvider(false);
  const otpGuard = new OtpGuard(new InMemoryWindowCounter(clock), new RecordingOtpAlerts(), DEFAULT_OTP_GUARD);
  const service = new IdentityService(repo, new RecordingEventEmitter(), sms, clock, new UnitOfWork(runner), PEPPER, sessions, otpGuard);
  return { cache, service, sms };
}

function setup() {
  const clock = new FakeClock('2026-10-08T18:00:00Z');
  const db = new InMemoryIdentityRepository();
  const sessionReads = vi.spyOn(db, 'findSessionById');
  const roleReads = vi.spyOn(db, 'rolesOf');
  const busA = new LinkedBus();
  const busB = new LinkedBus();
  busA.link(busB);
  const a = machine(db, clock, busA);
  const b = machine(db, clock, busB);
  async function signIn(phone = '07712345678') {
    await a.service.requestOtp({ phone, purpose: 'login' });
    const code = a.sms.lastCodeFor(`+964${phone.slice(1)}`)!;
    const res = await a.service.verifyOtp({ phone, code, device: { fingerprint: `dev-${phone}`, platform: 'android' } });
    const claims = await a.service.verifyAccessToken(res.tokens.accessToken);
    return { ...res, actor: { personId: claims.sub, sessionId: claims.sid, ...(claims.did ? { deviceId: claims.did } : {}) } };
  }
  return { clock, db, sessionReads, roleReads, a, b, busB, signIn };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DriverError && e.code === code);
}

describe('auth cache: a signed-in call reads its session and roles from memory (speed x4)', () => {
  it('the session is read from the database once per 30 seconds per machine', async () => {
    const t = setup();
    const { tokens } = await t.signIn();
    t.sessionReads.mockClear();
    for (let i = 0; i < 5; i++) await t.b.service.verifyAccessToken(tokens.accessToken);
    expect(t.sessionReads).toHaveBeenCalledTimes(1);
    t.clock.advance(29_000);
    await t.b.service.verifyAccessToken(tokens.accessToken);
    expect(t.sessionReads).toHaveBeenCalledTimes(1);
    t.clock.advance(1_000);
    await t.b.service.verifyAccessToken(tokens.accessToken);
    expect(t.sessionReads).toHaveBeenCalledTimes(2);
  });

  it('roles are read once per 30 seconds and come back as a copy', async () => {
    const t = setup();
    const { actor } = await t.signIn();
    await t.a.service.grantRole({ personId: 'system' }, { personId: actor.personId, kind: 'support' });
    t.roleReads.mockClear();
    const first = await t.a.service.activeRoles(actor.personId);
    first.length = 0;
    expect(await t.a.service.activeRoles(actor.personId)).toContain('support');
    expect(await t.a.service.hasRole(actor.personId, 'support')).toBe(true);
    expect(t.roleReads).toHaveBeenCalledTimes(1);
  });

  it('signing out ends the session at once on this machine and on the other one', async () => {
    const t = setup();
    const { tokens, actor } = await t.signIn();
    await t.a.service.verifyAccessToken(tokens.accessToken);
    await t.b.service.verifyAccessToken(tokens.accessToken);
    await t.a.service.logout(actor);
    await expectCode(t.a.service.verifyAccessToken(tokens.accessToken), 'session_expired');
    await expectCode(t.b.service.verifyAccessToken(tokens.accessToken), 'session_expired');
  });

  it('a revoked or frozen role stops working at once on both machines', async () => {
    const t = setup();
    const { actor } = await t.signIn();
    await t.a.service.grantRole({ personId: 'system' }, { personId: actor.personId, kind: 'dispatcher' });
    expect(await t.a.service.hasRole(actor.personId, 'dispatcher')).toBe(true);
    expect(await t.b.service.hasRole(actor.personId, 'dispatcher')).toBe(true);
    await t.b.service.revokeRole({ personId: 'system' }, { personId: actor.personId, kind: 'dispatcher' });
    expect(await t.a.service.hasRole(actor.personId, 'dispatcher')).toBe(false);
    expect(await t.b.service.hasRole(actor.personId, 'dispatcher')).toBe(false);

    await t.a.service.grantRole({ personId: 'system' }, { personId: actor.personId, kind: 'courier' });
    expect(await t.b.service.activeRoles(actor.personId)).toContain('courier');
    await t.db.setRolesFrozen(actor.personId, ['courier'], t.clock.now());
    // A write that skips the cached repository is only seen after the 30 seconds…
    expect(await t.b.service.activeRoles(actor.personId)).toContain('courier');
    t.clock.advance(30_000);
    expect(await t.b.service.activeRoles(actor.personId)).not.toContain('courier');
  });

  it('a granted role works at once (no 30-second wait for a new courier)', async () => {
    const t = setup();
    const { actor } = await t.signIn();
    expect(await t.b.service.hasRole(actor.personId, 'courier')).toBe(false);
    await t.a.service.grantRole({ personId: 'system' }, { personId: actor.personId, kind: 'courier' });
    expect(await t.b.service.hasRole(actor.personId, 'courier')).toBe(true);
  });

  it('revoking every session of a person drops all of them everywhere', async () => {
    const t = setup();
    const { tokens, actor } = await t.signIn();
    await t.b.service.verifyAccessToken(tokens.accessToken);
    const repo = cachedIdentityRepository(t.db, t.a.cache);
    await repo.revokeSessionsOf(actor.personId, t.clock.now());
    await expectCode(t.b.service.verifyAccessToken(tokens.accessToken), 'session_expired');
  });

  it('a slow read that started before a drop never puts the old row back', async () => {
    const t = setup();
    const { tokens, actor } = await t.signIn();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inside = new Promise<void>((r) => (entered = r));
    const original = InMemoryIdentityRepository.prototype.findSessionById.bind(t.db);
    const slowOnce = async (id: string, tx?: unknown) => {
      const found = await original(id);
      if (tx) return found;
      // The row as the database had it before the sign-out (a real read returns a copy).
      const row = found && { ...found };
      t.sessionReads.mockImplementation(original);
      entered();
      await gate;
      return row;
    };
    t.sessionReads.mockImplementation(slowOnce as never);
    const slow = t.b.service.verifyAccessToken(tokens.accessToken);
    await inside;
    await t.a.service.logout(actor);
    release();
    await slow;
    await expectCode(t.b.service.verifyAccessToken(tokens.accessToken), 'session_expired');
  });

  it('after missed drops (Redis reconnect) the machine forgets everything', async () => {
    const t = setup();
    const { tokens } = await t.signIn();
    await t.b.service.verifyAccessToken(tokens.accessToken);
    t.sessionReads.mockClear();
    t.busB.gap();
    await t.b.service.verifyAccessToken(tokens.accessToken);
    expect(t.sessionReads).toHaveBeenCalledTimes(1);
  });

  it('reads inside a transaction always go to the database', async () => {
    const t = setup();
    const { actor } = await t.signIn();
    const repo = cachedIdentityRepository(t.db, t.a.cache);
    t.sessionReads.mockClear();
    const tx = { txId: 1 } as never;
    await repo.findSessionById(actor.sessionId, tx);
    await repo.findSessionById(actor.sessionId, tx);
    expect(t.sessionReads).toHaveBeenCalledTimes(2);
  });

  it('AUTH_CACHE_TTL_SEC: default 30, capped at 30, 0 turns it off', () => {
    expect(authCacheTtlMsFromEnv({})).toBe(30_000);
    expect(authCacheTtlMsFromEnv({ AUTH_CACHE_TTL_SEC: '10' })).toBe(10_000);
    expect(authCacheTtlMsFromEnv({ AUTH_CACHE_TTL_SEC: '300' })).toBe(30_000);
    expect(authCacheTtlMsFromEnv({ AUTH_CACHE_TTL_SEC: '0' })).toBe(0);
    expect(authCacheTtlMsFromEnv({ AUTH_CACHE_TTL_SEC: 'nope' })).toBe(0);
    const db = new InMemoryIdentityRepository();
    expect(cachedIdentityRepository(db, new AuthCache(new FakeClock(), 0))).toBe(db);
  });
});
