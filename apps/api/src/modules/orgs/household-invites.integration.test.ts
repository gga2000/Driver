import { afterAll, describe, expect, it } from 'vitest';
import { DriverError, HOUSEHOLD_INVITE_RULES } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { PrismaOrgsRepository } from './orgs.repository.js';
import { OrgsService } from './orgs.service.js';

/**
 * SEC-06 on Postgres: household invites through the Prisma repository, and the races two API instances
 * can run — two yeses for the last place, one person saying yes to two households at once. Each
 * instance has its own unit of work; the advisory locks are what serialise them. Skipped without
 * DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('household invites on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const clock = new FakeClock('2026-10-08T09:00:00Z');
  // Real person rows (org_members references persons), one per name, made on first use.
  const people = new Map<string, string>();
  const person = (n: string) => people.get(n)!;
  const make = async (...names: string[]) => {
    for (const n of names) if (!people.has(n)) people.set(n, (await prisma.prisma.person.create({ data: {} })).id);
  };
  const orgIds: string[] = [];
  const instance = () => new OrgsService(undefined, clock, new PrismaOrgsRepository(prisma), new UnitOfWork(prisma));
  const a = instance();
  const b = instance();

  afterAll(async () => {
    await prisma.prisma.householdInvite.deleteMany({ where: { orgId: { in: orgIds } } });
    await prisma.prisma.orgMember.deleteMany({ where: { orgId: { in: orgIds } } });
    await prisma.prisma.org.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.prisma.person.deleteMany({ where: { id: { in: [...people.values()] } } });
    await prisma.onModuleDestroy();
  });

  async function household(payer: string) {
    await make(payer);
    const home = await a.createHousehold({ name: `بيت ${payer}`, cityId: 'aziziyah', payerId: person(payer) });
    orgIds.push(home.id);
    return home;
  }
  const outcome = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (err: unknown) => (err instanceof DriverError ? err.code : String(err)),
    );

  it('invite, re-invite keeps one row, yes joins, the invite is closed once', async () => {
    const home = await household('ali');
    await make('minar');
    expect(await a.inviteToHousehold({ orgId: home.id, personId: person('minar'), role: 'orderer', spendingLimitIqd: 25_000, actorId: person('ali') })).toBe('invited');
    expect(await b.inviteToHousehold({ orgId: home.id, personId: person('minar'), role: 'member', spendingLimitIqd: null, actorId: person('ali') })).toBe('invited');
    const open = await a.openInvitesOf(home.id);
    expect(open.map((i) => [i.personId, i.role])).toEqual([[person('minar'), 'member']]);
    expect(await prisma.prisma.householdInvite.count({ where: { orgId: home.id } })).toBe(1);
    const [inv] = await b.openInvitesFor(person('minar'));
    const both = await Promise.all([outcome(a.respondToHouseholdInvite(inv!.id, person('minar'), true)), outcome(b.respondToHouseholdInvite(inv!.id, person('minar'), true))]);
    expect(both.sort()).toEqual(['household_invite_gone', 'ok']);
    expect((await a.get(home.id)).members.map((m) => [m.personId, m.role])).toEqual([
      [person('ali'), 'payer'],
      [person('minar'), 'member'],
    ]);
  });

  it('two invites for the last place at once (two phones of the payer): one is sent, the other is told the household is full', async () => {
    const home = await household('big');
    await make(...Array.from({ length: HOUSEHOLD_INVITE_RULES.maxMembers + 1 }, (_, n) => `m${n}`));
    const last = HOUSEHOLD_INVITE_RULES.maxMembers - 2;
    for (let n = 0; n < last; n += 1) {
      await a.inviteToHousehold({ orgId: home.id, personId: person(`m${n}`), role: 'member', spendingLimitIqd: null, actorId: person('big') });
    }
    const both = await Promise.all([
      outcome(a.inviteToHousehold({ orgId: home.id, personId: person(`m${last}`), role: 'member', spendingLimitIqd: null, actorId: person('big') })),
      outcome(b.inviteToHousehold({ orgId: home.id, personId: person(`m${last + 1}`), role: 'member', spendingLimitIqd: null, actorId: person('big') })),
    ]);
    expect(both.sort()).toEqual(['household_full', 'ok']);
    expect((await a.openInvitesOf(home.id)).length + (await a.get(home.id)).members.length).toBe(HOUSEHOLD_INVITE_RULES.maxMembers);
  });

  it('one person says yes to two households at once: only one of them', async () => {
    const h1 = await household('one');
    const h2 = await household('two');
    await make('sara');
    await a.inviteToHousehold({ orgId: h1.id, personId: person('sara'), role: 'member', spendingLimitIqd: null, actorId: person('one') });
    await a.inviteToHousehold({ orgId: h2.id, personId: person('sara'), role: 'member', spendingLimitIqd: null, actorId: person('two') });
    const invites = await a.openInvitesFor(person('sara'));
    expect(invites).toHaveLength(2);
    const both = await Promise.all([outcome(a.respondToHouseholdInvite(invites[0]!.id, person('sara'), true)), outcome(b.respondToHouseholdInvite(invites[1]!.id, person('sara'), true))]);
    expect(both.sort()).toEqual(['household_exists', 'ok']);
    expect(await a.householdsOf(person('sara'))).toHaveLength(1);
  });
});
