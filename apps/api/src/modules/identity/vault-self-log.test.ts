import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { SelfReadLogWindow, selfReadLogWindowMsFromEnv } from './auth-cache.js';
import { harness } from './test-harness.js';

/** x4 privacy part (Ali, 8 Oct): own profile reads log once per session per 30 s; others always. */
describe('vault access log: own profile reads once per session per 30 seconds', () => {
  async function selfRows(h: ReturnType<typeof harness>, personId: string) {
    return (await h.repo.vaultAccessLogs(personId)).filter((r) => r.purpose === 'self_profile');
  }

  it('repeat home opens within 30 s share one row; the next window writes a new one', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    for (let i = 0; i < 5; i++) await h.service.me(actor);
    expect(await selfRows(h, actor.personId)).toHaveLength(1);
    h.clock.advance(29_000);
    await h.service.me(actor);
    expect(await selfRows(h, actor.personId)).toHaveLength(1);
    h.clock.advance(1_000);
    await h.service.me(actor);
    expect(await selfRows(h, actor.personId)).toHaveLength(2);
  });

  it('each session (phone) gets its own row', async () => {
    const h = harness();
    const first = await h.login('07712345678', { fingerprint: 'phone-a', platform: 'android' });
    const second = await h.login('07712345678', { fingerprint: 'phone-b', platform: 'android' });
    await h.service.me(first.actor);
    await h.service.me(second.actor);
    expect(await selfRows(h, first.actor.personId)).toHaveLength(2);
  });

  it('a read of different fields writes its own row (an emergency contact was just added)', async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    await h.service.me(actor);
    await h.repo.updateIdentity(actor.personId, { emergencyContact: { name: 'ام علي', phoneE164: '+9647701234567' } } as never);
    await h.service.me(actor);
    const rows = await selfRows(h, actor.personId);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.fieldsRead).toContain('emergency_contact');
  });

  it("someone else's read always writes its row", async () => {
    const h = harness();
    const { actor } = await h.login('07712345678');
    const staff = await h.login('07798765432');
    for (let i = 0; i < 3; i++) await h.service.profile(actor.personId, staff.actor.personId, 'support_case');
    const rows = (await h.repo.vaultAccessLogs(actor.personId)).filter((r) => r.purpose === 'support_case');
    expect(rows).toHaveLength(3);
  });

  it('a read whose transaction rolled back does not hide the next one', () => {
    const w = new SelfReadLogWindow(new FakeClock(), 30_000);
    expect(w.due('s|name')).toBe(true);
    // No commit → `wrote` never ran → still due.
    expect(w.due('s|name')).toBe(true);
    w.wrote('s|name');
    expect(w.due('s|name')).toBe(false);
  });

  it('VAULT_SELF_LOG_WINDOW_SEC: default 30, capped at 30, 0 logs every read', () => {
    expect(selfReadLogWindowMsFromEnv({})).toBe(30_000);
    expect(selfReadLogWindowMsFromEnv({ VAULT_SELF_LOG_WINDOW_SEC: '10' })).toBe(10_000);
    expect(selfReadLogWindowMsFromEnv({ VAULT_SELF_LOG_WINDOW_SEC: '600' })).toBe(30_000);
    expect(selfReadLogWindowMsFromEnv({ VAULT_SELF_LOG_WINDOW_SEC: '0' })).toBe(0);
    const off = new SelfReadLogWindow(new FakeClock(), 0);
    off.wrote('k');
    expect(off.due('k')).toBe(true);
  });
});
