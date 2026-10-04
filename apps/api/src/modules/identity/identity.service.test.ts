import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { DriverError } from '@driver/contracts';
import { MIN_SECRET_LENGTH, phonePepperFromEnv, sessionConfigFromEnv } from './session.service.js';
import { hashPhone, maskPhone, normalizeIraqiPhone } from './phone.js';
import { otpRateLimitsFromEnv } from './rate-limit.js';
import { harness, PEPPER } from './test-harness.js';

const PHONE = '07712345678';
const DEV_A = { fingerprint: 'device-aaaa-1111', platform: 'android' as const };
const DEV_B = { fingerprint: 'device-bbbb-2222', platform: 'ios' as const };

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof DriverError && e.code === code);
}

describe('phone normalisation', () => {
  it('maps every Iraqi format to one E.164 and one hash', () => {
    const variants = ['07712345678', '7712345678', '+9647712345678', '9647712345678', '00964 771 234 5678', '0771-234-5678', '٠٧٧١٢٣٤٥٦٧٨'];
    for (const v of variants) expect(normalizeIraqiPhone(v)).toBe('+9647712345678');
    const hashes = new Set(variants.map((v) => hashPhone(normalizeIraqiPhone(v), PEPPER)));
    expect(hashes.size).toBe(1);
  });

  it('rejects landlines, short numbers and foreign numbers', () => {
    for (const bad of ['0612345678', '771234', '+447712345678', 'abc']) expect(() => normalizeIraqiPhone(bad)).toThrow(DriverError);
  });

  it('pepper changes the hash and masking hides the middle', () => {
    expect(hashPhone('+9647712345678', 'a')).not.toBe(hashPhone('+9647712345678', 'b'));
    expect(maskPhone('+9647712345678')).toBe('+96477*****78');
  });
});

describe('OTP login', () => {
  it('phone format variants resolve to ONE person, with the phone only in the vault', async () => {
    const h = harness();
    const a = await h.login('07712345678');
    const b = await h.login('+964 771 234 5678');
    const c = await h.login('9647712345678');
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false);
    expect(a.personId).toBe(b.personId);
    expect(c.personId).toBe(a.personId);
    expect(h.repo.people.size).toBe(1);
    const person = h.repo.people.get(a.personId)!;
    expect(JSON.stringify(person)).not.toContain('7712345678');
    expect(h.repo.identities.get(a.personId)?.phoneE164).toBe('+9647712345678');
    expect(h.events.types().slice(0, 3)).toEqual(['person.registered', 'role.granted', 'person.verified']);
    expect(h.sessions).toBeDefined();
  });

  it('new persons get the customer role and every mutation ran inside a committed transaction', async () => {
    const h = harness();
    const { actor } = await h.login(PHONE);
    expect(await h.service.hasRole(actor.personId, 'customer')).toBe(true);
    expect(h.log.every((l) => l.startsWith('commit'))).toBe(true);
  });

  it('wrong code counts attempts and the 5th miss locks the challenge', async () => {
    const h = harness();
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    const real = h.sms.lastCodeFor('+9647712345678')!;
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) await expectCode(h.service.verifyOtp({ phone: PHONE, code: wrong }), 'otp_invalid');
    await expectCode(h.service.verifyOtp({ phone: PHONE, code: wrong }), 'otp_locked');
    // Even the right code is refused while locked, and so is a new request.
    await expectCode(h.service.verifyOtp({ phone: PHONE, code: real }), 'otp_locked');
    await expectCode(h.service.requestOtp({ phone: PHONE, purpose: 'login' }), 'otp_locked');
    h.clock.advanceMinutes(16);
    await expect(h.service.requestOtp({ phone: PHONE, purpose: 'login' })).resolves.toBeTruthy();
  });

  it('review C1: a miss is counted even though its transaction rolls back (login)', async () => {
    const h = harness();
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    const real = h.sms.lastCodeFor('+9647712345678')!;
    const wrong = real === '000000' ? '111111' : '000000';
    // The harness UnitOfWork undoes every in-tx write of the in-memory repo on rollback, like Postgres.
    const before = h.log.length;
    await expectCode(h.service.verifyOtp({ phone: PHONE, code: wrong }), 'otp_invalid');
    expect(h.log.slice(before)).toEqual([expect.stringMatching(/^rollback/)]);
    expect(h.repo.otps.at(-1)!.attempts).toBe(1);
    for (let i = 0; i < 3; i += 1) await expectCode(h.service.verifyOtp({ phone: PHONE, code: wrong }), 'otp_invalid');
    await expectCode(h.service.verifyOtp({ phone: PHONE, code: wrong }), 'otp_locked');
    expect(h.repo.otps.at(-1)!.lockedAt).not.toBeNull();
    await expectCode(h.service.verifyOtp({ phone: PHONE, code: real }), 'otp_locked');
    expect(h.repo.people.size).toBe(0);
  });

  it('review C1: the in-memory repo really rolls back in-tx writes (person creation undone)', async () => {
    const h = harness();
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    const code = h.sms.lastCodeFor('+9647712345678')!;
    await expect(
      h.uow.run(async (tx) => {
        await h.repo.createPersonWithIdentity({ locale: 'ar-IQ', sharedFamilyPhone: false, phoneE164: '+9647712345678', phoneHash: 'x', name: null, now: h.clock.now() }, tx);
        await h.repo.updateOtp(h.repo.otps.at(-1)!.id, { attempts: 3 }, tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(h.repo.people.size).toBe(0);
    expect(h.repo.otps.at(-1)!.attempts).toBe(0);
    await expect(h.service.verifyOtp({ phone: PHONE, code })).resolves.toMatchObject({ isNew: true });
  });

  it('review C1: phone-change and guardian-consent misses also lock after 5', async () => {
    const h = harness();
    const { actor } = await h.login('07700000001');
    await h.service.changePhoneStart(actor, { newPhone: '07700000002' });
    const oldCode = h.sms.lastCodeFor('+9647700000001')!;
    const newCode = h.sms.lastCodeFor('+9647700000002')!;
    const badNew = newCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) await expectCode(h.service.changePhoneConfirm(actor, { oldCode, newCode: badNew }), 'otp_invalid');
    await expectCode(h.service.changePhoneConfirm(actor, { oldCode, newCode: badNew }), 'otp_locked');
    await expectCode(h.service.changePhoneConfirm(actor, { oldCode, newCode }), 'otp_locked');
    expect(h.repo.identities.get(actor.personId)?.phoneE164).toBe('+9647700000001');

    const link = await h.service.linkGuardian(actor, { wardPhone: '07700000003' });
    const wardCode = h.sms.lastCodeFor('+9647700000003')!;
    const badWard = wardCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) await expectCode(h.service.consentGuardianLink(actor, { linkId: link.id, code: badWard }), 'otp_invalid');
    await expectCode(h.service.consentGuardianLink(actor, { linkId: link.id, code: badWard }), 'otp_locked');
    await expectCode(h.service.consentGuardianLink(actor, { linkId: link.id, code: wardCode }), 'otp_locked');
    expect(await h.service.hasRole(actor.personId, 'guardian')).toBe(false);
  });

  it('codes expire after 3 minutes and resend is refused inside 30 seconds', async () => {
    const h = harness();
    await h.service.requestOtp({ phone: PHONE, purpose: 'login' });
    const code = h.sms.lastCodeFor('+9647712345678')!;
    await expectCode(h.service.requestOtp({ phone: PHONE, purpose: 'login' }), 'otp_resend_too_soon');
    h.clock.advanceSeconds(31);
    await expect(h.service.requestOtp({ phone: PHONE, purpose: 'login' })).resolves.toBeTruthy();
    h.clock.advanceSeconds(180);
    await expectCode(h.service.verifyOtp({ phone: PHONE, code }), 'otp_expired');
    expect(h.sms.sentTo('+9647712345678')).toHaveLength(2);
  });

  it('M2 follow-up: requestOtp is rate-limited per IP (10/hour) with retryAfterSec', async () => {
    const h = harness();
    const phone = (i: number) => `0771200${String(i).padStart(4, '0')}`;
    for (let i = 0; i < 10; i += 1) await h.service.requestOtp({ phone: phone(i), purpose: 'login' }, { ip: '203.0.113.7' });
    const err = await h.service.requestOtp({ phone: phone(10), purpose: 'login' }, { ip: '203.0.113.7' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriverError);
    expect((err as DriverError).code).toBe('rate_limited');
    expect((err as DriverError).envelope).toMatchObject({ retryHint: 'later', retryAfterSec: 3600 });
    expect(h.sms.sentTo('+9647712000010')).toHaveLength(0);
    // Another IP is not affected; the window ends after an hour.
    await expect(h.service.requestOtp({ phone: phone(11), purpose: 'login' }, { ip: '198.51.100.1' })).resolves.toBeTruthy();
    h.clock.advanceSeconds(20 * 60);
    expect(((await h.service.requestOtp({ phone: phone(12), purpose: 'login' }, { ip: '203.0.113.7' }).catch((e: unknown) => e)) as DriverError).envelope.retryAfterSec).toBe(2400);
    h.clock.advanceSeconds(40 * 60);
    await expect(h.service.requestOtp({ phone: phone(13), purpose: 'login' }, { ip: '203.0.113.7' })).resolves.toBeTruthy();
  });

  it('M2 follow-up: requestOtp is rate-limited per device (5/hour), whatever the IP; limits are config', async () => {
    const h = harness();
    const phone = (i: number) => `0771300${String(i).padStart(4, '0')}`;
    for (let i = 0; i < 5; i += 1) await h.service.requestOtp({ phone: phone(i), purpose: 'login', device: DEV_A }, { ip: `10.0.0.${i}` });
    await expectCode(h.service.requestOtp({ phone: phone(5), purpose: 'login', device: DEV_A }, { ip: '10.0.0.99' }), 'rate_limited');
    await expect(h.service.requestOtp({ phone: phone(6), purpose: 'login', device: DEV_B }, { ip: '10.0.0.99' })).resolves.toBeTruthy();

    const strict = harness('2026-10-02T09:00:00Z', { otpRateLimits: { perIpPerHour: 2, perDevicePerHour: 1 } });
    await strict.service.requestOtp({ phone: phone(20), purpose: 'login', device: DEV_A }, { ip: '10.1.1.1' });
    await expectCode(strict.service.requestOtp({ phone: phone(21), purpose: 'login', device: DEV_A }, { ip: '10.1.1.2' }), 'rate_limited');
    await strict.service.requestOtp({ phone: phone(22), purpose: 'login' }, { ip: '10.1.1.1' });
    await expectCode(strict.service.requestOtp({ phone: phone(23), purpose: 'login' }, { ip: '10.1.1.1' }), 'rate_limited');
  });

  it('M2 follow-up: limits come from config (OTP_RATE_LIMIT_PER_IP_HOUR / _PER_DEVICE_HOUR, defaults 10 and 5)', () => {
    expect(otpRateLimitsFromEnv({})).toEqual({ perIpPerHour: 10, perDevicePerHour: 5 });
    expect(otpRateLimitsFromEnv({ OTP_RATE_LIMIT_PER_IP_HOUR: '30', OTP_RATE_LIMIT_PER_DEVICE_HOUR: '3' })).toEqual({ perIpPerHour: 30, perDevicePerHour: 3 });
    expect(() => otpRateLimitsFromEnv({ OTP_RATE_LIMIT_PER_IP_HOUR: 'lots' })).toThrow();
  });

  it('a code cannot be used twice', async () => {
    const h = harness();
    const { tokens } = await h.login(PHONE);
    expect(tokens.accessToken).toBeTruthy();
    const code = h.sms.lastCodeFor('+9647712345678')!;
    await expectCode(h.service.verifyOtp({ phone: PHONE, code }), 'otp_not_found');
  });

  it('error envelopes carry Arabic text and a retry hint', async () => {
    const h = harness();
    try {
      await h.service.verifyOtp({ phone: PHONE, code: '123456' });
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DriverError);
      const e = err as DriverError;
      expect(e.envelope.message_ar).toMatch(/[؀-ۿ]/);
      expect(e.envelope.retryHint).toBe('never');
    }
  });
});

describe('sessions', () => {
  it('access tokens are 15-minute HS256 JWTs with a kid; refresh rotates and old tokens die', async () => {
    const h = harness();
    const { tokens, actor } = await h.login(PHONE);
    const [header] = tokens.accessToken.split('.');
    const parsedHeader = JSON.parse(Buffer.from(header!, 'base64url').toString());
    expect(parsedHeader).toEqual({ alg: 'HS256', kid: 'k1' });
    expect(tokens.accessExpiresAt.getTime() - h.clock.now().getTime()).toBe(15 * 60_000);
    expect(tokens.refreshExpiresAt.getTime() - h.clock.now().getTime()).toBe(30 * 86_400_000);

    const next = await h.service.refresh(tokens.refreshToken);
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect((await h.actorFor(next.accessToken)).sessionId).toBe(actor.sessionId);
    // Reusing the rotated token is treated as theft: the session is gone.
    await expectCode(h.service.refresh(tokens.refreshToken), 'token_invalid');
    await expect(h.service.refresh(next.refreshToken)).resolves.toBeTruthy();
  });

  it('access tokens expire by the clock and logout kills the session', async () => {
    const h = harness();
    const { tokens, actor } = await h.login(PHONE);
    h.clock.advanceMinutes(16);
    await expectCode(h.service.verifyAccessToken(tokens.accessToken), 'session_expired');
    h.clock.advanceMinutes(-16);
    await h.service.logout(actor, tokens.refreshToken);
    await expectCode(h.service.verifyAccessToken(tokens.accessToken), 'session_expired');
    await expectCode(h.service.refresh(tokens.refreshToken), 'refresh_reused');
    // Notify drops the push tokens this session registered.
    expect(h.events.last('session.signed_out')).toMatchObject({ payload: { personId: actor.personId, sessionId: actor.sessionId } });
  });

  it('notifyContact reads the phone only when asked, and logs that read; childNotice names the guardian', async () => {
    const h = harness();
    const { actor } = await h.login(PHONE);
    const reads = async () => (await h.repo.vaultAccessLogs(actor.personId)).filter((l) => l.accessorId === 'system:notify');
    expect(await h.service.notifyContact(actor.personId, { phone: false, purpose: 'notify:order_accepted' })).toEqual({ locale: 'ar-IQ', phoneE164: null });
    expect(await reads()).toHaveLength(0);
    expect((await h.service.notifyContact(actor.personId, { phone: true, purpose: 'notify:order_receipt' }))?.phoneE164).toMatch(/^\+964/);
    expect((await reads()).map((l) => [l.purpose, l.fieldsRead])).toEqual([['notify:order_receipt', ['phone_e164']]]);
    expect(await h.service.notifyContact('nobody', { phone: true, purpose: 'x' })).toBeNull();
    expect(await h.service.childNotice('chref_missing')).toBeNull();
  });

  it('review H: a live session id of person A never authenticates a token claiming person B', async () => {
    const h = harness();
    const { actor: attacker } = await h.login('07700000011');
    const { actor: victim } = await h.login('07700000012');
    const now = Math.floor(h.clock.now().getTime() / 1000);
    // Signed with the real key (worst case: the secret leaked) but sid is the attacker's own session.
    const forge = (claims: Record<string, unknown>, sub: string, alg = 'HS256') =>
      new SignJWT(claims).setProtectedHeader({ alg, kid: 'k1' }).setSubject(sub).setIssuer('driver-api').setIssuedAt(now).setExpirationTime(now + 900).sign(new TextEncoder().encode('unit-test-secret'));
    await expectCode(h.service.verifyAccessToken(await forge({ sid: attacker.sessionId }, victim.personId)), 'token_invalid');
    // A device id the session is not bound to is refused too.
    await expectCode(h.service.verifyAccessToken(await forge({ sid: attacker.sessionId, did: 'dev_other' }, attacker.personId)), 'token_invalid');
    // Only HS256 is accepted.
    await expectCode(h.service.verifyAccessToken(await forge({ sid: attacker.sessionId }, attacker.personId, 'HS512')), 'token_invalid');
    // The honest token still works.
    await expect(h.service.verifyAccessToken(await forge({ sid: attacker.sessionId }, attacker.personId))).resolves.toMatchObject({ sub: attacker.personId });
  });

  it('review H: a token whose session has expired is refused even inside the access-token life', async () => {
    const h = harness();
    const { tokens, actor } = await h.login(PHONE);
    const session = h.repo.sessions.find((x) => x.id === actor.sessionId)!;
    session.expiresAt = new Date(h.clock.now().getTime() - 1);
    await expectCode(h.service.verifyAccessToken(tokens.accessToken), 'session_expired');
  });

  it('review H: production refuses to boot without strong JWT_SECRET and PHONE_HASH_PEPPER', () => {
    const strong = 'x'.repeat(MIN_SECRET_LENGTH);
    const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(() => sessionConfigFromEnv(prod)).toThrow(/JWT_SECRET is required/);
    expect(() => sessionConfigFromEnv({ ...prod, JWT_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => sessionConfigFromEnv({ ...prod, JWT_SECRET: 'dev-only-insecure-secret-change-me-32chars' })).toThrow(/placeholder/);
    expect(sessionConfigFromEnv({ ...prod, JWT_SECRET: strong }).keys[0]!.secret).toBe(strong);
    expect(() => phonePepperFromEnv({ ...prod, JWT_SECRET: strong })).toThrow(/PHONE_HASH_PEPPER is required/);
    expect(() => phonePepperFromEnv({ ...prod, PHONE_HASH_PEPPER: 'short' })).toThrow(/at least 32/);
    expect(phonePepperFromEnv({ ...prod, PHONE_HASH_PEPPER: strong })).toBe(strong);
    // Development still boots with no env at all.
    expect(sessionConfigFromEnv({}).keys[0]!.secret.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(phonePepperFromEnv({})).toBeTruthy();
  });

  it('tampered tokens are rejected', async () => {
    const h = harness();
    const { tokens } = await h.login(PHONE);
    await expectCode(h.service.verifyAccessToken(tokens.accessToken.slice(0, -3) + 'abc'), 'token_invalid');
    await expectCode(h.service.verifyAccessToken('not.a.jwt'), 'token_invalid');
  });
});

describe('roles', () => {
  it('grants are idempotent and org-scoped; revoke emits the actor', async () => {
    const h = harness();
    const { actor: admin } = await h.login('07700000001');
    const { actor: user } = await h.login('07700000002');
    const before = h.events.events.length;
    await h.service.grantRole(admin, { personId: user.personId, kind: 'merchant_staff', orgId: 'org_1' });
    await h.service.grantRole(admin, { personId: user.personId, kind: 'merchant_staff', orgId: 'org_1' });
    expect(h.events.events.slice(before).filter((e) => e.type === 'role.granted')).toHaveLength(1);
    expect(await h.service.hasRole(user.personId, 'merchant_staff', 'org_1')).toBe(true);
    expect(await h.service.hasRole(user.personId, 'merchant_staff', 'org_2')).toBe(false);
    expect(await h.service.hasRole(user.personId, 'merchant_staff')).toBe(true);

    await h.service.revokeRole(admin, { personId: user.personId, kind: 'merchant_staff', orgId: 'org_1' });
    await h.service.revokeRole(admin, { personId: user.personId, kind: 'merchant_staff', orgId: 'org_1' });
    const revoked = h.events.events.filter((e) => e.type === 'role.revoked');
    expect(revoked).toHaveLength(1);
    expect(revoked[0]!.actorId).toBe(admin.personId);
    expect(revoked[0]!.payload['revokedBy']).toBe(admin.personId);
    expect(await h.service.hasRole(user.personId, 'merchant_staff', 'org_1')).toBe(false);
    // Re-grant after revoke works and emits again.
    await h.service.grantRole(admin, { personId: user.personId, kind: 'merchant_staff', orgId: 'org_1' });
    expect(await h.service.hasRole(user.personId, 'merchant_staff', 'org_1')).toBe(true);
  });

  it('a declared shared family phone cannot hold guardian or driver roles', async () => {
    const h = harness();
    const { actor: admin } = await h.login('07700000001');
    const { actor: shared } = await h.login('07700000009', undefined, true);
    for (const kind of ['guardian', 'driver', 'courier', 'khat_driver'] as const) {
      await expectCode(h.service.grantRole(admin, { personId: shared.personId, kind }), 'shared_phone_role_forbidden');
    }
    await expect(h.service.grantRole(admin, { personId: shared.personId, kind: 'merchant_staff', orgId: 'o' })).resolves.toBeTruthy();
    await expectCode(h.service.linkGuardian(shared, { wardPhone: '07700000010' }), 'shared_phone_role_forbidden');
  });
});

describe('guardian links', () => {
  it('stays pending until the ward enters the consent code, then grants guardian', async () => {
    const h = harness();
    const { actor: guardian } = await h.login('07700000001');
    const link = await h.service.linkGuardian(guardian, { wardPhone: '07700000002' });
    expect(link.state).toBe('pending');
    expect(link.state_ar).toBe('بانتظار الموافقة');
    expect(await h.service.hasRole(guardian.personId, 'guardian')).toBe(false);
    expect(h.events.types()).not.toContain('guardian.linked');

    const wardCode = h.sms.lastCodeFor('+9647700000002')!;
    expect(h.sms.sentTo('+9647700000002')[0]!.body).toContain('ولي الأمر');
    await expectCode(h.service.consentGuardianLink(guardian, { linkId: link.id, code: wardCode === '000000' ? '111111' : '000000' }), 'otp_invalid');
    const active = await h.service.consentGuardianLink(guardian, { linkId: link.id, code: wardCode });
    expect(active.state).toBe('active');
    expect(active.state_ar).toBe('مفعّل');
    expect(await h.service.hasRole(guardian.personId, 'guardian')).toBe(true);
    expect(h.events.types()).toContain('guardian.linked');
    // Linking the same ward again while pending reuses the row; the ward person is pseudonymous.
    expect(h.repo.guardianLinks).toHaveLength(1);
    expect(h.repo.people.size).toBe(2);
  });

  it('revoke emits guardian.revoked with the actor and drops the guardian role when no link remains', async () => {
    const h = harness();
    const { actor: guardian } = await h.login('07700000001');
    const link = await h.service.linkGuardian(guardian, { wardPhone: '07700000002' });
    await h.service.consentGuardianLink(guardian, { linkId: link.id, code: h.sms.lastCodeFor('+9647700000002')! });
    const { actor: stranger } = await h.login('07700000003');
    await expectCode(h.service.revokeGuardianLink(stranger, { linkId: link.id }), 'forbidden');
    const revoked = await h.service.revokeGuardianLink(guardian, { linkId: link.id });
    expect(revoked.state).toBe('revoked');
    const ev = h.events.last('guardian.revoked')!;
    expect(ev.actorId).toBe(guardian.personId);
    expect(ev.payload['linkId']).toBe(link.id);
    expect(await h.service.hasRole(guardian.personId, 'guardian')).toBe(false);
    expect(h.events.last('role.revoked')?.payload['kind']).toBe('guardian');
  });

  it('refuses self-links', async () => {
    const h = harness();
    const { actor } = await h.login('07700000001');
    await expectCode(h.service.linkGuardian(actor, { wardPhone: '07700000001' }), 'guardian_self_link');
  });
});

describe('re-verification (edge-case §7)', () => {
  it('120 idle days freeze guardian/driver roles until the next OTP', async () => {
    const h = harness();
    const { actor: admin } = await h.login('07700000001');
    const { actor: driver, tokens } = await h.login('07700000002');
    await h.service.grantRole(admin, { personId: driver.personId, kind: 'driver' });
    await h.service.grantRole(admin, { personId: driver.personId, kind: 'merchant_staff', orgId: 'o' });
    h.clock.advance(119 * 86_400_000);
    expect((await h.service.me(driver)).reverificationRequired).toBe(false);
    h.clock.advance(1 * 86_400_000);
    const me = await h.service.me(driver);
    expect(me.reverificationRequired).toBe(true);
    expect(me.canWithdraw).toBe(false);
    expect(me.roles.find((r) => r.kind === 'driver')?.frozen).toBe(true);
    expect(me.roles.find((r) => r.kind === 'merchant_staff')?.frozen).toBe(false);
    expect(await h.service.hasRole(driver.personId, 'driver')).toBe(false);
    expect(await h.service.hasRole(driver.personId, 'merchant_staff')).toBe(true);
    // the narrow role port the ledger's cash caps read: frozen roles do not count
    expect(await h.service.activeRoles(driver.personId)).toEqual(['customer', 'merchant_staff']);
    expect(h.events.last('person.reverification_required')?.payload['reason']).toBe('idle_120_days');
    await expectCode(h.service.linkGuardian(driver, { wardPhone: '07700000003' }), 'reverification_required');
    expect(tokens.refreshToken).toBeTruthy();

    // A fresh OTP thaws everything.
    const again = await h.login('07700000002');
    expect(again.isNew).toBe(false);
    expect(h.events.last('person.reverified')).toBeTruthy();
    const after = await h.service.me(again.actor);
    expect(after.reverificationRequired).toBe(false);
    expect(await h.service.hasRole(driver.personId, 'driver')).toBe(true);
  });

  it('a new device fingerprint on refresh triggers re-verification; OTP on that device clears it', async () => {
    const h = harness();
    const { actor: admin } = await h.login('07700000001');
    const first = await h.login('07700000002', DEV_A);
    await h.service.grantRole(admin, { personId: first.personId, kind: 'guardian' });
    expect(h.events.types().filter((t) => t === 'device.registered')).toHaveLength(1);
    expect((await h.service.me(first.actor)).reverificationRequired).toBe(false);

    const rotated = await h.service.refresh(first.tokens.refreshToken, DEV_B);
    const actorB = await h.actorFor(rotated.accessToken);
    expect(actorB.deviceId).not.toBe(first.actor.deviceId);
    const me = await h.service.me(actorB);
    expect(me.reverificationRequired).toBe(true);
    expect(me.roles.find((r) => r.kind === 'guardian')?.frozen).toBe(true);
    expect(h.events.last('person.reverification_required')?.payload['reason']).toBe('new_device');

    const verified = await h.login('07700000002', DEV_B);
    expect((await h.service.me(verified.actor)).reverificationRequired).toBe(false);
    expect(await h.service.hasRole(first.personId, 'guardian')).toBe(true);
    // Known device refresh does nothing.
    const again = await h.service.refresh(verified.tokens.refreshToken, DEV_B);
    expect((await h.service.me(await h.actorFor(again.accessToken))).reverificationRequired).toBe(false);
  });
});

describe('phone change (edge-case §7)', () => {
  it('needs a valid code on BOTH numbers before the vault row changes', async () => {
    const h = harness();
    const { actor } = await h.login('07700000001');
    await expectCode(h.service.changePhoneStart(actor, { newPhone: '07700000001' }), 'phone_change_same_number');
    await h.login('07700000009');
    await expectCode(h.service.changePhoneStart(actor, { newPhone: '07700000009' }), 'phone_change_taken');

    const started = await h.service.changePhoneStart(actor, { newPhone: '07700000002' });
    expect(started.oldPhoneMasked).toBe('+96477*****01');
    expect(started.newPhoneMasked).toBe('+96477*****02');
    const oldCode = h.sms.lastCodeFor('+9647700000001')!;
    const newCode = h.sms.lastCodeFor('+9647700000002')!;
    await expectCode(h.service.changePhoneConfirm(actor, { oldCode, newCode: newCode === '000000' ? '111111' : '000000' }), 'otp_invalid');
    expect(h.repo.identities.get(actor.personId)?.phoneE164).toBe('+9647700000001');
    // The failed confirm rolled back as a whole, so the old code was not consumed by it.
    expect(h.repo.otps.filter((o) => o.purpose === 'phone_change').every((o) => o.verifiedAt === null)).toBe(true);
    h.clock.advanceSeconds(31);
    await h.service.changePhoneStart(actor, { newPhone: '07700000002' });
    const me = await h.service.changePhoneConfirm(actor, { oldCode: h.sms.lastCodeFor('+9647700000001')!, newCode: h.sms.lastCodeFor('+9647700000002')! });
    expect(me.phoneMasked).toBe('+96477*****02');
    expect(h.repo.identities.get(actor.personId)?.phoneE164).toBe('+9647700000002');
    expect(h.events.last('phone.changed')?.payload['newPhoneMasked']).toBe('+96477*****02');
    // Logging in with the new number lands on the same person; the old number is now free.
    expect((await h.login('07700000002')).personId).toBe(actor.personId);
    expect((await h.login('07700000001')).isNew).toBe(true);
  });
});

describe('profile and vault access', () => {
  it('reads the name from the vault and logs every access with its reason', async () => {
    const h = harness();
    const { actor } = await h.login('07700000001');
    await h.service.setName(actor, 'علي');
    const me = await h.service.me(actor);
    expect(me.name).toBe('علي');
    expect(me.phoneMasked).toBe('+96477*****01');
    const { actor: support } = await h.login('07700000002');
    await h.service.profile(actor.personId, support.personId, 'support_ticket_42');
    const logs = await h.repo.vaultAccessLogs(actor.personId);
    expect(logs.map((l) => [l.accessorId, l.purpose])).toEqual([
      [actor.personId, 'self_profile'],
      [support.personId, 'support_ticket_42'],
    ]);
    expect(logs[0]!.fieldsRead).toEqual(['name', 'phone_e164']);
  });

  it('M2 follow-up: a khat child is registered into the vault; only an opaque childRef leaves it', async () => {
    const h = harness();
    const { actor: mum } = await h.login('07700000001');
    const { childRef } = await h.service.registerChild(mum, { name: 'زينب' });
    expect(childRef).toMatch(/^chref_/);
    expect(childRef).not.toContain('زينب');
    expect(h.repo.children).toEqual([{ childRef, guardianId: mum.personId, name: 'زينب' }]);
    // The event says a child was registered, never who.
    const ev = h.events.last('child.registered')!;
    expect(ev.payload).toEqual({ childRef, guardianId: mum.personId });
    expect(JSON.stringify(ev)).not.toContain('زينب');
    await expectCode(h.service.registerChild(mum, { name: '   ' }), 'invalid_input');
  });

  it('M2 follow-up: run sheet and guardian view resolve names through identity, every read logged in VaultAccessLog', async () => {
    const h = harness();
    const { actor: mum } = await h.login('07700000001');
    const { actor: driver } = await h.login('07700000002');
    const { actor: stranger } = await h.login('07700000003');
    const zainab = (await h.service.registerChild(mum, { name: 'زينب' })).childRef;
    const ali = (await h.service.registerChild(mum, { name: 'علي' })).childRef;

    expect(await h.service.childNamesForRunSheet(driver.personId, [zainab, ali, zainab, 'chref_unknown'])).toEqual({ [zainab]: 'زينب', [ali]: 'علي' });
    expect(await h.service.myChildren(mum)).toEqual([
      { childRef: zainab, name: 'زينب' },
      { childRef: ali, name: 'علي' },
    ]);
    expect(await h.service.myChildren(stranger)).toEqual([]);

    const logs = (await h.repo.vaultAccessLogs(mum.personId)).filter((l) => l.childRef);
    expect(logs.map((l) => [l.childRef, l.accessorId, l.purpose, l.fieldsRead])).toEqual([
      [zainab, driver.personId, 'khat_run_sheet', ['child_name']],
      [ali, driver.personId, 'khat_run_sheet', ['child_name']],
      [zainab, mum.personId, 'guardian_view', ['child_name']],
      [ali, mum.personId, 'guardian_view', ['child_name']],
    ]);
  });

  it('lost-SIM claim: support records it, nothing changes', async () => {
    const h = harness();
    const { actor: admin } = await h.login('07700000001');
    const { actor: victim } = await h.login('07700000002');
    await expectCode(h.service.recordLostSimClaim(victim, { personId: victim.personId, newPhone: '07700000003' }), 'forbidden');
    const { actor: agent } = await h.login('07700000004');
    await h.service.grantRole(admin, { personId: agent.personId, kind: 'support' });
    const claim = await h.service.recordLostSimClaim(agent, { personId: victim.personId, newPhone: '07700000003', note: 'ID matched at desk' });
    expect(claim.claimId).toBeTruthy();
    const ev = h.events.last('identity.lost_sim_claim')!;
    expect(ev.payload['status']).toBe('manual');
    expect(ev.payload['newPhoneMasked']).toBe('+96477*****03');
    expect(h.repo.identities.get(victim.personId)?.phoneE164).toBe('+9647700000002');
  });

  it('devLastOtp surfaces the fake provider code', async () => {
    const h = harness();
    await h.service.requestOtp({ phone: '0770 000 0001', purpose: 'login' });
    const { code, phoneMasked } = await h.service.devLastOtp('07700000001');
    expect(code).toMatch(/^\d{6}$/);
    expect(phoneMasked).toBe('+96477*****01');
    expect((await h.service.devLastOtp('07700000002')).code).toBeNull();
  });
});
