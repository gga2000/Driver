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
import { VaultLogWriteError, swallowedVaultLogFailures } from './vault-log.js';

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
  const uow = new UnitOfWork(prisma);
  const service = new IdentityService(repo, events, sms, clock, uow, pepper, sessions);
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

  it('a retired refresh token presented again revokes the session although the refresh rolls back', async () => {
    const { session, tokens } = await sessions.open(personId, null);
    const next = await service.refresh(tokens.refreshToken);
    await expect(service.refresh(tokens.refreshToken)).rejects.toSatisfy((e: unknown) => e instanceof DriverError && e.code === 'refresh_reused');
    expect((await prisma.prisma.session.findUnique({ where: { id: session.id } }))?.revokedAt).not.toBeNull();
    await expect(service.refresh(next.refreshToken)).rejects.toSatisfy((e: unknown) => e instanceof DriverError && e.code === 'refresh_reused');
  });

  it('profile read writes a vault access log row with the reason', async () => {
    const claims = await service.verifyAccessToken((await service.refresh((await sessions.open(personId, null)).tokens.refreshToken)).accessToken);
    await service.me({ personId: claims.sub, sessionId: claims.sid });
    const logs = await prisma.prisma.vaultAccessLog.findMany({ where: { personId } });
    expect(logs.map((l) => l.purpose)).toContain('self_profile');
  });

  it('K-01 console names: batched reads, one log row per person read, against the staff member', async () => {
    await service.setName({ personId, sessionId: 'it' }, 'حيدر كاظم');
    // The accessor is a real person (vault_access_logs.accessor_id references persons).
    const staff = (await prisma.prisma.person.create({ data: {} })).id;
    const before = await prisma.prisma.vaultAccessLog.count({ where: { personId, purpose: 'console_names_it' } });
    const out = await service.displayNamesFor([personId, personId, 'p_does_not_exist'], staff, 'console_names_it');
    expect(out).toEqual({ [personId]: { displayName: 'حيدر ك.', deleted: false } });
    const rows = await prisma.prisma.vaultAccessLog.findMany({ where: { personId, purpose: 'console_names_it' } });
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ accessorId: staff, accessorKind: 'person', accessorRef: null, fieldsRead: ['name'] });
  });

  it('vault_accessor_fk: the system, a share link and an SOS link read as kind + ref, with no person in accessor_id', async () => {
    await service.firstNamesFor([personId], 'system:khat', 'khat_sweep_page_it');
    await service.firstNamesFor([personId], 'share:lnk_it', 'share_trip_it');
    await service.firstNamesFor([personId], 'sos_link:inc_it', 'sos_link_it');
    await service.notifyContact(personId, { phone: true, purpose: 'notify:it' });
    const rows = await prisma.prisma.vaultAccessLog.findMany({ where: { personId, purpose: { in: ['khat_sweep_page_it', 'share_trip_it', 'sos_link_it', 'notify:it'] } }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.accessorId, r.accessorKind, r.accessorRef, r.purpose])).toEqual([
      [null, 'system', 'system:khat', 'khat_sweep_page_it'],
      [null, 'share_link', 'share:lnk_it', 'share_trip_it'],
      [null, 'sos_link', 'sos_link:inc_it', 'sos_link_it'],
      [null, 'system', 'system:notify', 'notify:it'],
    ]);
    // The repository's records name the reader either way.
    expect((await repo.vaultAccessLogs(personId)).find((l) => l.purpose === 'share_trip_it')).toMatchObject({ accessorId: 'share:lnk_it', accessorKind: 'share_link' });
  });

  it('a failed log insert inside a transaction is rolled back to its savepoint: the caller’s writes commit, the failure is counted', async () => {
    const before = swallowedVaultLogFailures();
    // An accessor that looks like a person but is not one: the insert breaks the foreign key.
    const ghost = 'cghostaccessor000000000000';
    const contact = await uow.run(async (tx) => {
      await repo.updatePerson(personId, { locale: 'en' }, tx);
      const read = await service.phoneForCall(personId, ghost, 'masked_call_it');
      // The transaction is still usable after the failed insert (no 25P02).
      await repo.updatePerson(personId, { sharedFamilyPhone: true }, tx);
      return read;
    });
    expect(contact).toBe(e164);
    expect(swallowedVaultLogFailures()).toBe(before + 1);
    const person = await prisma.prisma.person.findUniqueOrThrow({ where: { id: personId } });
    expect(person).toMatchObject({ locale: 'en', sharedFamilyPhone: true });
    expect(await prisma.prisma.vaultAccessLog.count({ where: { personId, purpose: 'masked_call_it' } })).toBe(0);
    await repo.updatePerson(personId, { locale: 'ar-IQ', sharedFamilyPhone: false });
  });

  it('a Console staff read whose log row cannot be written returns no data (fail closed)', async () => {
    const before = swallowedVaultLogFailures();
    await expect(service.displayNamesFor([personId], 'cghoststaff00000000000000', 'console_names')).rejects.toBeInstanceOf(VaultLogWriteError);
    expect(swallowedVaultLogFailures()).toBe(before);
  });

  it('the access log stays append-only: the reject_mutation trigger is still on it', async () => {
    const triggers = await prisma.prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'identity_vault' AND c.relname = 'vault_access_logs' AND NOT t.tgisinternal`;
    expect(triggers.map((t) => t.tgname)).toContain('vault_access_logs_append_only');
    await expect(prisma.prisma.$executeRaw`UPDATE "identity_vault"."vault_access_logs" SET "purpose" = 'tampered' WHERE "person_id" = ${personId}`).rejects.toBeTruthy();
    await expect(prisma.prisma.$executeRaw`DELETE FROM "identity_vault"."vault_access_logs" WHERE "person_id" = ${personId}`).rejects.toBeTruthy();
  });
});
