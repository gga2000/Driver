import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { hashPhone, maskPhone, normalizeIraqiPhone } from './phone.js';
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
    // The old code was consumed by the first (half-successful) attempt: both codes are required together.
    await expectCode(h.service.changePhoneConfirm(actor, { oldCode, newCode }), 'otp_not_found');
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
