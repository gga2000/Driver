import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DriverError, STAFF_TOTP_RULES } from '@driver/contracts';
import { runWithRequestId, setRequestCaller } from '../../shared/request-context.js';
import { harness } from './test-harness.js';
import { base32Encode, findRecoveryHash, hashRecoveryCode, matchTotp, newRecoveryCodes, openSecret, otpauthUri, recoveryChars, sealSecret, staffTotpConfigFromEnv, totpCode, totpStep } from './totp.js';

const ALI = '07700000001';
const NOOR = '07700000004';
const ZAINAB = '07700000003';
const LAPTOP = { fingerprint: 'console-laptop-1111', platform: 'web' as const };
const KEY = createHash('sha256').update('unit-test-staff-totp-key').digest();

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DriverError && e.code === code);
}

/** Ali signs in by SMS, then becomes admin; Noor finance; Zainab support. Each has one session. */
async function staff(opts: { demo?: boolean } = {}) {
  const h = harness('2026-10-02T09:00:00Z', { authenticator: { key: KEY, demo: opts.demo ?? false } });
  const ali = await h.login(ALI, LAPTOP);
  await h.service.grantRole({ personId: 'system' }, { personId: ali.personId, kind: 'admin' });
  const noor = await h.login(NOOR, LAPTOP);
  await h.service.grantRole({ personId: 'system' }, { personId: noor.personId, kind: 'finance' });
  const zainab = await h.login(ZAINAB, LAPTOP);
  await h.service.grantRole({ personId: 'system' }, { personId: zainab.personId, kind: 'support' });
  h.clock.advanceSeconds(31);
  return { h, ali, noor, zainab };
}

type H = Awaited<ReturnType<typeof staff>>['h'];
type Actor = { personId: string; sessionId: string };

/** Sets the app up on this session the way a person does; returns the secret and the recovery codes. */
async function enrol(h: H, actor: Actor) {
  const { secret, uri } = await h.service.staffTotpEnrol(actor);
  const { recoveryCodes } = await h.service.staffTotpConfirm(actor, totpCode(secret, totpStep(h.clock.now())));
  return { secret, uri, recoveryCodes };
}

/** Runs `fn` as an HTTP request whose verified caller is `actor` (what the tRPC context records). */
function asCaller<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return runWithRequestId('req-test', () => {
    setRequestCaller(actor);
    return fn();
  });
}

describe('the authenticator codes (RFC 6238)', () => {
  it('matches the RFC test vectors (SHA-1, 30 s), 6 digits', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, totpStep(new Date(59_000)))).toBe('287082');
    expect(totpCode(secret, totpStep(new Date(1_111_111_109_000)))).toBe('081804');
    expect(totpCode(secret, totpStep(new Date(1_234_567_890_000)))).toBe('005924');
  });

  it('accepts one step either side, never an older or the same step again', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const at = new Date(1_111_111_109_000);
    const s = totpStep(at);
    expect(matchTotp(secret, totpCode(secret, s - 1), at, null)).toBe(s - 1);
    expect(matchTotp(secret, totpCode(secret, s + 1), at, null)).toBe(s + 1);
    expect(matchTotp(secret, totpCode(secret, s - 2), at, null)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, s + 2), at, null)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, s), at, s)).toBeNull();
    expect(matchTotp(secret, 'abcdef', at, null)).toBeNull();
  });

  it('gives the app a Driver link: issuer, SHA-1, 6 digits, 30 seconds', () => {
    expect(otpauthUri('ABC', 'Console')).toBe('otpauth://totp/Driver%3AConsole?secret=ABC&issuer=Driver&algorithm=SHA1&digits=6&period=30');
  });

  it('seals the secret with AES-256-GCM, bound to its person', () => {
    const sealed = sealSecret(KEY, 'p1', 'JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(sealed).not.toBe(sealSecret(KEY, 'p1', 'JBSWY3DPEHPK3PXP'));
    expect(openSecret(KEY, 'p1', sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => openSecret(KEY, 'p2', sealed)).toThrow();
    expect(() => openSecret(createHash('sha256').update('other').digest(), 'p1', sealed)).toThrow();
  });

  it('keeps recovery codes as salted hashes: two hashes of one code differ, both match it', () => {
    const a = hashRecoveryCode('ABCDE-FGHJK');
    const b = hashRecoveryCode('ABCDE-FGHJK');
    expect(a).not.toBe(b);
    expect(a).not.toContain('ABCDE');
    expect(findRecoveryHash('abcde fghjk', [b, a])).toBe(b);
    expect(findRecoveryHash('ABCDE-FGHJM', [a, b])).toBeNull();
  });

  it('recovery codes: 8 of XXXXX-XXXXX, every letter equally likely (bytes 248 and up are drawn again)', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(8);
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{5}$/);
    // Bytes 0 and 31 both map to "A"; 248–255 would bias the first letters, so they are skipped.
    const draws = [Buffer.from([248, 255, 0, 31, 250]), Buffer.from([1, 252, 30])];
    expect(recoveryChars(4, () => draws.shift() ?? Buffer.from([2, 2, 2, 2]))).toBe('AAB9');
  });
});

describe('STAFF_TOTP_KEY and the demo switch', () => {
  it('a deployed server refuses to boot without its own key; a laptop has a dev key', () => {
    expect(() => staffTotpConfigFromEnv({ NODE_ENV: 'production' })).toThrow(/STAFF_TOTP_KEY is not set.*refusing to boot/);
    expect(() => staffTotpConfigFromEnv({ NODE_ENV: 'production', DEPLOY_ENVIRONMENT: 'staging', STAFF_TOTP_KEY: 'too-short' })).toThrow(/refusing to boot/);
    expect(() => staffTotpConfigFromEnv({ NODE_ENV: 'production', STAFF_TOTP_KEY: 'ab'.repeat(32), JWT_SECRET: 'ab'.repeat(32) })).toThrow(/its own value/);
    expect(staffTotpConfigFromEnv({ NODE_ENV: 'production', STAFF_TOTP_KEY: 'ab'.repeat(32) })).toEqual({ key: Buffer.from('ab'.repeat(32), 'hex'), demo: false });
    expect(staffTotpConfigFromEnv({}).key).toHaveLength(32);
  });

  it('demo autofill: on only when asked on a laptop; a deployed server (staging too) refuses to boot with it', () => {
    expect(staffTotpConfigFromEnv({}).demo).toBe(false);
    expect(staffTotpConfigFromEnv({ STAFF_TOTP_DEMO: '1' }).demo).toBe(true);
    const live = { NODE_ENV: 'production', STAFF_TOTP_KEY: 'ab'.repeat(32), STAFF_TOTP_DEMO: '1' };
    expect(() => staffTotpConfigFromEnv(live)).toThrow(/STAFF_TOTP_DEMO is for the local demo only.*refusing to boot/);
    expect(() => staffTotpConfigFromEnv({ ...live, DEPLOY_ENVIRONMENT: 'staging' })).toThrow(/refusing to boot/);
  });
});

describe('admin and finance owe the authenticator step after the SMS code', () => {
  it('an SMS-only session holds the roles but they do not count for its own requests', async () => {
    const { h, ali, noor, zainab } = await staff();
    const again = await h.login(ALI, LAPTOP);
    expect(again.secondStep).toBe('enrol');
    expect(await h.service.secondStepPending(again.actor)).toBe(true);
    expect(await h.service.secondStepPending(zainab.actor)).toBe(false);

    // Inside a request by Ali on that session: admin is not his yet; support's request still sees him as admin.
    expect(await asCaller(again.actor, () => h.service.hasRole(ali.personId, 'admin'))).toBe(false);
    expect(await asCaller(again.actor, () => h.service.activeRoles(ali.personId))).toEqual(['customer']);
    expect(await asCaller(zainab.actor, () => h.service.hasRole(ali.personId, 'admin'))).toBe(true);
    // Background work (no caller) and other people's reads are untouched.
    expect(await h.service.hasRole(ali.personId, 'admin')).toBe(true);
    expect(await asCaller(again.actor, () => h.service.hasRole(zainab.personId, 'support'))).toBe(true);

    // me says what is owed; finance owes it too, support never.
    expect((await h.service.me(again.actor)).secondStep).toBe('enrol');
    h.clock.advanceSeconds(31);
    expect((await h.login(NOOR, LAPTOP)).secondStep).toBe('enrol');
    h.clock.advanceSeconds(31);
    const z = await h.login(ZAINAB, LAPTOP);
    expect(z.secondStep).toBeUndefined();
    expect((await h.service.me(z.actor)).secondStep).toBeNull();
    await expectCode(h.service.staffTotpEnrol(z.actor), 'forbidden');
    void noor;
  });

  it('first time: set up with the QR secret, confirm one code, 8 recovery codes once; the session then counts', async () => {
    const { h, ali } = await staff();
    const s = await h.login(ALI, LAPTOP);
    const { secret, uri, recoveryCodes } = await enrol(h, s.actor);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=Driver');
    expect(recoveryCodes).toHaveLength(STAFF_TOTP_RULES.recoveryCodes);
    expect(new Set(recoveryCodes).size).toBe(8);
    for (const c of recoveryCodes) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    expect(await h.service.secondStepPending(s.actor)).toBe(false);
    expect(await asCaller(s.actor, () => h.service.hasRole(ali.personId, 'admin'))).toBe(true);
    expect((await h.service.me(s.actor)).secondStep).toBeNull();
    expect(h.events.last('staff.totp_passed')?.payload).toMatchObject({ personId: ali.personId, sessionId: s.actor.sessionId, how: 'enrolled' });

    // Set up once: no second secret, no second set of recovery codes.
    await expectCode(h.service.staffTotpEnrol(s.actor), 'totp_already_set');
    await expectCode(h.service.staffTotpConfirm(s.actor, totpCode(secret, totpStep(h.clock.now()) + 1)), 'totp_already_set');

    // Stored sealed, recovery codes hashed: nothing readable in the row.
    const row = h.repo.staffTotps.get(ali.personId)!;
    expect(row.secretEnc).not.toContain(secret);
    expect(row.recoveryHashes).toHaveLength(8);
    for (const c of recoveryCodes) expect(row.recoveryHashes.join(' ')).not.toContain(c);
    // Every read of the secret is in the vault access log.
    const purposes = (await h.repo.vaultAccessLogs(ali.personId)).map((l) => l.purpose);
    expect(purposes).toEqual(expect.arrayContaining(['staff_totp_enrol']));
  });

  it('a session that never confirmed starts over with a fresh secret; a wrong first code does not set it up', async () => {
    const { h } = await staff();
    const s = await h.login(ALI, LAPTOP);
    const first = await h.service.staffTotpEnrol(s.actor);
    const second = await h.service.staffTotpEnrol(s.actor);
    expect(second.secret).not.toBe(first.secret);
    await expectCode(h.service.staffTotpConfirm(s.actor, totpCode(first.secret, totpStep(h.clock.now()))), 'totp_invalid');
    expect(await h.service.secondStepPending(s.actor)).toBe(true);
    await h.service.staffTotpConfirm(s.actor, totpCode(second.secret, totpStep(h.clock.now())));
    expect(await h.service.secondStepPending(s.actor)).toBe(false);
  });

  it('later sign-ins type a code; a code is never accepted twice', async () => {
    const { h } = await staff();
    const first = await h.login(ALI, LAPTOP);
    const { secret } = await enrol(h, first.actor);

    h.clock.advanceSeconds(60);
    const next = await h.login(ALI, LAPTOP);
    expect(next.secondStep).toBe('code');
    const code = totpCode(secret, totpStep(h.clock.now()));
    await expectCode(h.service.staffTotpVerify(next.actor, '000000'), 'totp_invalid');
    expect(await h.service.staffTotpVerify(next.actor, code)).toEqual({ recoveryLeft: null });
    expect(await h.service.secondStepPending(next.actor)).toBe(false);

    // The same code on another fresh session (a shoulder-surfer, a replay): refused.
    h.clock.advanceSeconds(31);
    const other = await h.login(ALI, LAPTOP);
    h.clock.set(new Date(h.clock.now().getTime() - 31_000));
    await expectCode(h.service.staffTotpVerify(other.actor, code), 'totp_invalid');
    expect(await h.service.secondStepPending(other.actor)).toBe(true);
  });

  it('5 wrong codes in a row lock the step 15 minutes and tell the admins once; then it opens again', async () => {
    const { h, ali, noor } = await staff();
    const a = await h.login(ALI, LAPTOP);
    await enrol(h, a.actor);
    h.clock.advanceSeconds(31);
    const n = await h.login(NOOR, LAPTOP);
    const { secret } = await enrol(h, n.actor);

    h.clock.advanceSeconds(31);
    const n2 = await h.login(NOOR, LAPTOP);
    for (let i = 0; i < 4; i += 1) await expectCode(h.service.staffTotpVerify(n2.actor, '111111'), 'totp_invalid');
    await expect(h.service.staffTotpVerify(n2.actor, '111111')).rejects.toSatisfy((e: unknown) => e instanceof DriverError && e.envelope.code === 'totp_locked' && e.envelope.retryAfterSec === 15 * 60);
    // Locked: even the right code waits.
    await expectCode(h.service.staffTotpVerify(n2.actor, totpCode(secret, totpStep(h.clock.now()))), 'totp_locked');
    const alerts = h.events.events.filter((e) => e.type === 'staff.totp_locked');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload).toMatchObject({ personId: noor.personId, minutes: 15, adminIds: [ali.personId] });
    expect(await h.service.staffTotpLocks(a.actor)).toEqual([expect.objectContaining({ personId: noor.personId })]);

    h.clock.advanceMinutes(15);
    expect(await h.service.staffTotpLocks(a.actor)).toEqual([]);
    await h.service.staffTotpVerify(n2.actor, totpCode(secret, totpStep(h.clock.now())));
    expect(await h.service.secondStepPending(n2.actor)).toBe(false);
  });

  it('a right code clears the wrong tries: they count in a row only', async () => {
    const { h } = await staff();
    const a = await h.login(ALI, LAPTOP);
    const { secret } = await enrol(h, a.actor);
    h.clock.advanceSeconds(31);
    const b = await h.login(ALI, LAPTOP);
    for (let i = 0; i < 4; i += 1) await expectCode(h.service.staffTotpVerify(b.actor, '222222'), 'totp_invalid');
    await h.service.staffTotpVerify(b.actor, totpCode(secret, totpStep(h.clock.now())));
    h.clock.advanceSeconds(31);
    const c = await h.login(ALI, LAPTOP);
    for (let i = 0; i < 4; i += 1) await expectCode(h.service.staffTotpVerify(c.actor, '222222'), 'totp_invalid');
    await h.service.staffTotpVerify(c.actor, totpCode(secret, totpStep(h.clock.now())));
    expect(h.events.types()).not.toContain('staff.totp_locked');
  });

  it('a recovery code works once, is logged, and says how many are left', async () => {
    const { h, ali } = await staff();
    const a = await h.login(ALI, LAPTOP);
    const { recoveryCodes } = await enrol(h, a.actor);
    h.clock.advanceSeconds(31);
    const lost = await h.login(ALI, LAPTOP);
    expect(await h.service.staffTotpVerify(lost.actor, recoveryCodes[2]!.toLowerCase().replace('-', ' '))).toEqual({ recoveryLeft: 7 });
    expect(h.events.last('staff.totp_recovery_used')?.payload).toEqual({ personId: ali.personId, left: 7 });
    expect((await h.repo.vaultAccessLogs(ali.personId)).filter((l) => l.purpose === 'staff_totp_verify').at(-1)?.fieldsRead).toEqual(['totp_recovery_hashes']);
    h.clock.advanceSeconds(31);
    const again = await h.login(ALI, LAPTOP);
    await expectCode(h.service.staffTotpVerify(again.actor, recoveryCodes[2]!), 'totp_invalid');
  });

  it('demo mode fills the code (the next one when this one is used); off, it gives nothing', async () => {
    const off = await staff();
    const s = await off.h.login(ALI, LAPTOP);
    await enrol(off.h, s.actor);
    expect(await off.h.service.staffTotpDemoCode(s.actor)).toEqual({ code: null });

    const { h } = await staff({ demo: true });
    const a = await h.login(ALI, LAPTOP);
    expect(await h.service.staffTotpDemoCode(a.actor)).toEqual({ code: null });
    await h.service.staffTotpEnrol(a.actor);
    const { code } = await h.service.staffTotpDemoCode(a.actor);
    await h.service.staffTotpConfirm(a.actor, code!);
    const next = (await h.service.staffTotpDemoCode(a.actor)).code;
    expect(next).not.toBe(code);
    h.clock.advanceSeconds(1);
    const b = await h.login(ALI, LAPTOP);
    await h.service.staffTotpVerify(b.actor, next!);
    expect(await h.service.secondStepPending(b.actor)).toBe(false);
  });
});

describe('an admin resets another staff member’s authenticator', () => {
  it('needs his own fresh code, never resets his own, ends the person’s sessions; the person sets it up again', async () => {
    const { h, ali, noor } = await staff();
    const a = await h.login(ALI, LAPTOP);
    const { secret } = await enrol(h, a.actor);
    h.clock.advanceSeconds(31);
    const n = await h.login(NOOR, LAPTOP);
    await enrol(h, n.actor);

    await expectCode(h.service.confirmOwnStaffTotp(a.actor, '333333'), 'totp_invalid');
    await expectCode(h.service.resetStaffTotp(a.actor, ali.personId), 'forbidden');
    h.clock.advanceSeconds(31);
    await h.service.confirmOwnStaffTotp(a.actor, totpCode(secret, totpStep(h.clock.now())));
    expect(await h.service.resetStaffTotp(a.actor, noor.personId)).toEqual({ reset: true, ended: 2 });
    expect(h.events.last('staff.totp_reset')?.payload).toEqual({ personId: noor.personId, resetBy: ali.personId, hadApp: true });
    await expectCode(h.service.verifyAccessToken(n.tokens.accessToken), 'session_expired');

    h.clock.advanceSeconds(31);
    expect((await h.login(NOOR, LAPTOP)).secondStep).toBe('enrol');
  });

  it('every new set-up, first time or after a reset, tells the other admins and shows on their strip for a day', async () => {
    const { h, ali, noor } = await staff();
    const a = await h.login(ALI, LAPTOP);
    const { secret } = await enrol(h, a.actor);
    // Ali is the only admin: nobody else to tell about his own set-up.
    expect(h.events.last('staff.totp_enrolled')?.payload).toEqual({ personId: ali.personId, adminIds: [] });
    h.clock.advanceSeconds(31);
    const n = await h.login(NOOR, LAPTOP);
    await enrol(h, n.actor);
    expect(h.events.last('staff.totp_enrolled')?.payload).toEqual({ personId: noor.personId, adminIds: [ali.personId] });
    expect((await h.service.staffTotpEnrolments(a.actor)).map((r) => r.personId)).toEqual([noor.personId]);

    // Reset, then set up again: told again.
    h.clock.advanceSeconds(31);
    await h.service.confirmOwnStaffTotp(a.actor, totpCode(secret, totpStep(h.clock.now())));
    await h.service.resetStaffTotp(a.actor, noor.personId);
    h.clock.advanceSeconds(31);
    const again = await h.login(NOOR, LAPTOP);
    await enrol(h, again.actor);
    expect(h.events.events.filter((e) => e.type === 'staff.totp_enrolled' && e.payload['personId'] === noor.personId)).toHaveLength(2);

    h.clock.advanceMinutes(STAFF_TOTP_RULES.enrolAlertHours * 60 + 1);
    expect(await h.service.staffTotpEnrolments(a.actor)).toEqual([]);
  });

  it('an admin who never set the app up cannot confirm a reset', async () => {
    const { h } = await staff();
    const a = await h.login(ALI, LAPTOP);
    await expectCode(h.service.confirmOwnStaffTotp(a.actor, '123456'), 'totp_required');
  });

  it('closing an account removes the set-up', async () => {
    const { h, noor } = await staff();
    const n = await h.login(NOOR, LAPTOP);
    await enrol(h, n.actor);
    expect(h.repo.staffTotps.has(noor.personId)).toBe(true);
    await h.repo.closeAccount(noor.personId, h.clock.now());
    expect(h.repo.staffTotps.has(noor.personId)).toBe(false);
  });
});
