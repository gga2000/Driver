import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { RecordingEventEmitter } from './events.adapter.js';
import { PrismaIdentityRepository } from './identity.repository.js';
import { IdentityService } from './identity.service.js';
import { hashPhone } from './phone.js';
import { SessionService } from './session.service.js';
import { FakeSmsProvider } from './sms/fake.provider.js';

/**
 * Identity against a real Postgres (plan Step 2 integration): no PII on `people`, one vault row per
 * person, access log written on profile reads, find-or-create inside one transaction.
 * Needs DATABASE_URL with the migration deployed (`pnpm db:up && pnpm db:migrate`). Skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('identity on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaIdentityRepository(prisma);
  const clock = new FakeClock();
  const sms = new FakeSmsProvider(false);
  const events = new RecordingEventEmitter();
  const pepper = `it-${Date.now().toString(36)}`;
  const sessions = new SessionService(repo, clock, { keys: [{ kid: 'k1', secret: 'integration-secret' }], activeKid: 'k1' });
  const service = new IdentityService(repo, events, sms, clock, new UnitOfWork(prisma), pepper, sessions);
  const phone = `0770${Date.now().toString().slice(-7)}`;
  const e164 = `+964${phone.slice(1)}`;
  let personId = '';

  beforeAll(async () => {
    await service.requestOtp({ phone, purpose: 'login' });
    const res = await service.verifyOtp({ phone, code: sms.lastCodeFor(e164)! });
    personId = res.personId;
  });

  afterAll(async () => {
    const db = prisma.prisma;
    // vault_access_logs is append-only (by design) and references the person, so the person and
    // its audit trail stay; the CI database is thrown away after the run. Clear what can be cleared.
    await db.session.deleteMany({ where: { personId } });
    await db.role.deleteMany({ where: { personId } });
    await prisma.onModuleDestroy();
  });

  it('people row carries no phone or name; the vault row does', async () => {
    const person = await prisma.prisma.person.findUniqueOrThrow({ where: { id: personId } });
    expect(JSON.stringify(person)).not.toContain(phone.slice(1));
    const identity = await prisma.prisma.personIdentity.findUniqueOrThrow({ where: { personId } });
    expect(identity.phoneE164).toBe(e164);
    expect(identity.phoneHash).toHaveLength(64);
  });

  it('second login with another format finds the same person', async () => {
    clock.advanceSeconds(31);
    await service.requestOtp({ phone: `+964 ${phone.slice(1)}`, purpose: 'login' });
    const res = await service.verifyOtp({ phone: `964${phone.slice(1)}`, code: sms.lastCodeFor(e164)! });
    expect(res.isNew).toBe(false);
    expect(res.personId).toBe(personId);
  });

  it('review C1: wrong codes are counted and lock the challenge although each verify rolls back', async () => {
    const lockPhone = `0771${Date.now().toString().slice(-7)}`;
    const lockE164 = `+964${lockPhone.slice(1)}`;
    const lockHash = hashPhone(lockE164, pepper);
    try {
      await service.requestOtp({ phone: lockPhone, purpose: 'login' });
      const real = sms.lastCodeFor(lockE164)!;
      const wrong = real === '000000' ? '111111' : '000000';
      const codes: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        await service.verifyOtp({ phone: lockPhone, code: wrong }).catch((e: unknown) => codes.push(e instanceof DriverError ? e.code : String(e)));
      }
      expect(codes).toEqual(['otp_invalid', 'otp_invalid', 'otp_invalid', 'otp_invalid', 'otp_locked', 'otp_locked']);
      const row = await prisma.prisma.otpChallenge.findFirstOrThrow({ where: { phoneHash: lockHash }, orderBy: { createdAt: 'desc' } });
      expect(row.attempts).toBe(5);
      expect(row.lockedAt).not.toBeNull();
      await expect(service.verifyOtp({ phone: lockPhone, code: real })).rejects.toSatisfy((e: unknown) => e instanceof DriverError && e.code === 'otp_locked');
      expect(await prisma.prisma.personIdentity.findUnique({ where: { phoneHash: lockHash } })).toBeNull();
    } finally {
      await prisma.prisma.otpChallenge.deleteMany({ where: { phoneHash: lockHash } });
    }
  });

  it('profile read writes a vault access log row with the reason', async () => {
    const claims = await service.verifyAccessToken((await service.refresh((await sessions.open(personId, null)).tokens.refreshToken)).accessToken);
    await service.me({ personId: claims.sub, sessionId: claims.sid });
    const logs = await prisma.prisma.vaultAccessLog.findMany({ where: { personId } });
    expect(logs.map((l) => l.purpose)).toContain('self_profile');
  });

  it('K-01 console names: batched reads, one log row per person read, against the staff member', async () => {
    await service.setName({ personId, sessionId: 'it' }, 'حيدر كاظم');
    const staff = `it_staff_${Date.now().toString(36)}`;
    const before = await prisma.prisma.vaultAccessLog.count({ where: { personId, purpose: 'console_names_it' } });
    const out = await service.displayNamesFor([personId, personId, 'p_does_not_exist'], staff, 'console_names_it');
    expect(out).toEqual({ [personId]: { displayName: 'حيدر ك.', deleted: false } });
    const rows = await prisma.prisma.vaultAccessLog.findMany({ where: { personId, purpose: 'console_names_it' } });
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ accessorId: staff, fieldsRead: ['name'] });
  });
});
