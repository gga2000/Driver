import { describe, expect, it } from 'vitest';
import { DriverError, STAFF_SESSION_MAX_SEC } from '@driver/contracts';
import { harness } from './test-harness.js';

const ALI = '07700000001';
const ZAINAB = '07700000003';
const LAPTOP = { fingerprint: 'console-laptop-1111', platform: 'web' as const };
const STOLEN = { fingerprint: 'console-phone-2222', platform: 'web' as const };

async function expectCode(p: Promise<unknown>, code: string | string[]) {
  const codes = Array.isArray(code) ? code : [code];
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DriverError && codes.includes(e.code));
}

/** Ali (admin) and Zainab (support), both signed in once. */
async function staff() {
  const h = harness();
  const ali = await h.login(ALI, LAPTOP);
  await h.service.grantRole({ personId: 'system' }, { personId: ali.personId, kind: 'admin' });
  h.clock.advanceSeconds(31);
  const zainab = await h.login(ZAINAB, LAPTOP);
  await h.service.grantRole(ali.actor, { personId: zainab.personId, kind: 'support' });
  h.clock.advanceSeconds(31);
  return { h, ali, zainab };
}

describe('taking a staff role away ends every session', () => {
  it('a device signed in before is cut off, and stays cut off when the role is granted back', async () => {
    const { h, ali, zainab } = await staff();
    const stolen = await h.login(ZAINAB, STOLEN);
    expect(await h.service.hasRole(zainab.personId, 'support')).toBe(true);

    await h.service.revokeRole(ali.actor, { personId: zainab.personId, kind: 'support' });

    await expectCode(h.service.verifyAccessToken(stolen.tokens.accessToken), 'session_expired');
    await expectCode(h.service.refresh(stolen.tokens.refreshToken, STOLEN), 'refresh_reused');
    await expectCode(h.service.verifyAccessToken(zainab.tokens.accessToken), 'session_expired');

    // She gets a new phone, Ali gives the role back: the old device still has nothing.
    await h.service.grantRole(ali.actor, { personId: zainab.personId, kind: 'support' });
    await expectCode(h.service.refresh(stolen.tokens.refreshToken, STOLEN), 'refresh_reused');
    await expectCode(h.service.verifyAccessToken(stolen.tokens.accessToken), 'session_expired');

    // Each ended session drops its push tokens (notify listens to session.signed_out).
    const signedOut = h.events.events.filter((e) => e.type === 'session.signed_out').map((e) => e.payload['sessionId']);
    expect(signedOut).toEqual(expect.arrayContaining([stolen.actor.sessionId, zainab.actor.sessionId]));
    expect(h.events.last('session.all_ended')?.payload).toMatchObject({ personId: zainab.personId, reason: 'role_revoked', sessions: 2 });
  });

  it('a merchant or customer role change leaves the person signed in', async () => {
    const { h, ali, zainab } = await staff();
    await h.service.grantRole(ali.actor, { personId: zainab.personId, kind: 'merchant_staff', orgId: 'org_1' });
    await h.service.revokeRole(ali.actor, { personId: zainab.personId, kind: 'merchant_staff', orgId: 'org_1' });
    await expect(h.service.verifyAccessToken(zainab.tokens.accessToken)).resolves.toMatchObject({ sub: zainab.personId });
  });
});

describe('endAllSessions', () => {
  it('ends every session of the person on every device, nobody else', async () => {
    const { h, ali, zainab } = await staff();
    const second = await h.login(ZAINAB, STOLEN);
    expect(await h.service.endAllSessions(ali.actor, zainab.personId, 'admin')).toEqual({ ended: 2 });
    await expectCode(h.service.verifyAccessToken(second.tokens.accessToken), 'session_expired');
    await expectCode(h.service.refresh(zainab.tokens.refreshToken, LAPTOP), 'refresh_reused');
    await expect(h.service.verifyAccessToken(ali.tokens.accessToken)).resolves.toMatchObject({ sub: ali.personId });
    // Her role is untouched: she signs in again on her own phone and works.
    expect(await h.service.hasRole(zainab.personId, 'support')).toBe(true);
    expect(h.events.last('session.all_ended')?.payload).toMatchObject({ personId: zainab.personId, endedBy: ali.personId, reason: 'admin', sessions: 2 });
  });
});

describe('staff sessions last at most 12 hours', () => {
  it('a staff sign-in ends 12 h after it opened, however often it refreshes', async () => {
    const { h, zainab } = await staff();
    h.clock.advanceSeconds(31);
    const opened = h.clock.now().getTime();
    const s = await h.login(ZAINAB, LAPTOP);
    expect(s.tokens.refreshExpiresAt.getTime()).toBe(opened + STAFF_SESSION_MAX_SEC * 1000);

    h.clock.advanceMinutes(11 * 60);
    const later = await h.service.refresh(s.tokens.refreshToken, LAPTOP);
    expect(later.refreshExpiresAt.getTime()).toBe(opened + STAFF_SESSION_MAX_SEC * 1000);

    h.clock.advanceMinutes(61);
    await expectCode(h.service.refresh(later.refreshToken, LAPTOP), 'session_expired');
    void zainab;
  });

  it('a session older than 12 h stops at its next refresh once the person is made staff', async () => {
    const h = harness();
    const ali = await h.login(ALI, LAPTOP);
    await h.service.grantRole({ personId: 'system' }, { personId: ali.personId, kind: 'admin' });
    h.clock.advanceSeconds(31);
    const ahmed = await h.login('07700000009', LAPTOP);
    h.clock.advanceMinutes(13 * 60);
    const fresh = await h.service.refresh(ahmed.tokens.refreshToken, LAPTOP);
    await h.service.grantRole(ali.actor, { personId: ahmed.personId, kind: 'dispatcher' });
    await expectCode(h.service.refresh(fresh.refreshToken, LAPTOP), 'session_expired');
  });

  it('customers keep their 30-day refresh', async () => {
    const h = harness();
    const c = await h.login('07700000009', LAPTOP);
    h.clock.advanceMinutes(13 * 60);
    const next = await h.service.refresh(c.tokens.refreshToken, LAPTOP);
    expect(next.refreshExpiresAt.getTime() - h.clock.now().getTime()).toBe(30 * 86_400_000);
  });
});

describe('a staff sign-in from a device never seen alerts the admins', () => {
  it('names the admins on the event, once per new device', async () => {
    const { h, ali, zainab } = await staff();
    expect(h.events.types()).not.toContain('staff.new_device');

    await h.login(ZAINAB, STOLEN);
    const alert = h.events.last('staff.new_device');
    expect(alert?.payload).toMatchObject({ personId: zainab.personId, platform: 'web', adminIds: [ali.personId] });

    h.clock.advanceSeconds(31);
    await h.login(ZAINAB, STOLEN);
    expect(h.events.types().filter((t) => t === 'staff.new_device')).toHaveLength(1);
  });

  it('says nothing for a customer on a new phone', async () => {
    const h = harness();
    await h.login('07700000009', LAPTOP);
    h.clock.advanceSeconds(31);
    await h.login('07700000009', STOLEN);
    expect(h.events.types()).not.toContain('staff.new_device');
  });
});
