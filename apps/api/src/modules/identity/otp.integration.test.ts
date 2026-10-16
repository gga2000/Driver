import { afterAll, describe, expect, it } from 'vitest';
import { DriverError, OTP_MAX_ATTEMPTS } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryWindowCounter } from '../../shared/window-counter.js';
import { RecordingEventEmitter } from './events.adapter.js';
import { PrismaIdentityRepository } from './identity.repository.js';
import { IdentityService } from './identity.service.js';
import { hashPhone } from './phone.js';
import { DEFAULT_OTP_GUARD, OtpGuard, RecordingOtpAlerts } from './rate-limit.js';
import { SessionService } from './session.service.js';
import { FakeSmsProvider } from './sms/fake.provider.js';

/**
 * Sign-in codes on a real Postgres (audit SEC-01 and the W5 guard): parallel guesses each claim an
 * attempt with one conditional UPDATE, so 20 at once still count exactly 5 and lock the code.
 * Needs DATABASE_URL with the migrations deployed. Skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('sign-in codes on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaIdentityRepository(prisma);
  const clock = new FakeClock();
  const sms = new FakeSmsProvider(false);
  const pepper = `otp-it-${Date.now().toString(36)}`;
  const sessions = new SessionService(repo, clock, { keys: [{ kid: 'k1', secret: 'integration-secret' }], activeKid: 'k1' });
  const alerts = new RecordingOtpAlerts();
  const guard = new OtpGuard(new InMemoryWindowCounter(clock), alerts, DEFAULT_OTP_GUARD);
  const service = new IdentityService(repo, new RecordingEventEmitter(), sms, clock, new UnitOfWork(prisma), pepper, sessions, guard);
  const base = Date.now().toString().slice(-6);
  const phone = (n: number) => `077${n}${base}0`.slice(0, 11);
  const e164 = (p: string) => `+964${p.slice(1)}`;
  const personIds: string[] = [];

  afterAll(async () => {
    const db = prisma.prisma;
    await db.session.deleteMany({ where: { personId: { in: personIds } } });
    await db.role.deleteMany({ where: { personId: { in: personIds } } });
    await prisma.onModuleDestroy();
  });

  const outcome = (p: Promise<unknown>) =>
    p.then(
      (r) => {
        const id = (r as { personId?: string }).personId;
        if (id) personIds.push(id);
        return 'ok';
      },
      (e: unknown) => (e instanceof DriverError ? e.code : String(e)),
    );

  it('20 parallel wrong codes: exactly 5 counted, then locked, and the right code is refused', async () => {
    const p = phone(1);
    await service.requestOtp({ phone: p, purpose: 'login' });
    const real = sms.lastCodeFor(e164(p))!;
    const wrong = (i: number) => String((Number(real) + 1 + i) % 1_000_000).padStart(6, '0');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => outcome(service.verifyOtp({ phone: p, code: wrong(i) }))));
    expect(results.filter((r) => r === 'otp_invalid')).toHaveLength(OTP_MAX_ATTEMPTS - 1);
    expect(results.filter((r) => r === 'otp_locked')).toHaveLength(20 - (OTP_MAX_ATTEMPTS - 1));
    const row = await prisma.prisma.otpChallenge.findFirstOrThrow({ where: { phoneHash: hashPhone(e164(p), pepper) }, orderBy: { createdAt: 'desc' } });
    expect(row.attempts).toBe(OTP_MAX_ATTEMPTS);
    expect(row.lockedAt).not.toBeNull();
    expect(await outcome(service.verifyOtp({ phone: p, code: real }))).toBe('otp_locked');
  });

  it('a right code among parallel guesses signs in once; the challenge is used up', async () => {
    const p = phone(2);
    await service.requestOtp({ phone: p, purpose: 'login' });
    const real = sms.lastCodeFor(e164(p))!;
    const results = await Promise.all([outcome(service.verifyOtp({ phone: p, code: real })), outcome(service.verifyOtp({ phone: p, code: real }))]);
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'otp_not_found')).toHaveLength(1);
  });

  it('a miss survives the rolled-back sign-in transaction', async () => {
    const p = phone(3);
    await service.requestOtp({ phone: p, purpose: 'login' });
    const real = sms.lastCodeFor(e164(p))!;
    const bad = real === '000000' ? '111111' : '000000';
    expect(await outcome(service.verifyOtp({ phone: p, code: bad }))).toBe('otp_invalid');
    const row = await prisma.prisma.otpChallenge.findFirstOrThrow({ where: { phoneHash: hashPhone(e164(p), pepper) }, orderBy: { createdAt: 'desc' } });
    expect(row.attempts).toBe(1);
    expect(await outcome(service.verifyOtp({ phone: p, code: real }))).toBe('ok');
  });
});
