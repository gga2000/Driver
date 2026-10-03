import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { RecordingEventEmitter } from './events.adapter.js';
import { PrismaIdentityRepository } from './identity.repository.js';
import { IdentityService } from './identity.service.js';
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
    await db.vaultAccessLog.deleteMany({ where: { personId } });
    await db.session.deleteMany({ where: { personId } });
    await db.role.deleteMany({ where: { personId } });
    await db.personIdentity.deleteMany({ where: { personId } });
    await db.person.deleteMany({ where: { id: personId } });
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

  it('profile read writes a vault access log row with the reason', async () => {
    const claims = await service.verifyAccessToken((await service.refresh((await sessions.open(personId, null)).tokens.refreshToken)).accessToken);
    await service.me({ personId: claims.sub, sessionId: claims.sid });
    const logs = await prisma.prisma.vaultAccessLog.findMany({ where: { personId } });
    expect(logs.map((l) => l.purpose)).toContain('self_profile');
  });
});
