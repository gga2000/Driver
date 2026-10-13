import { describe, expect, it } from 'vitest';
import { DriverError, MerchantCommissionTier, type Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import type { IdentityService } from '../identity/index.js';
import { ORDERS_RULES } from '../orders/index.js';
import { OrgsMerchantDirectory } from '../orders/merchants.port.js';
import { OrgsService } from '../orgs/index.js';
import { COMMISSION_TIER_AUDIT, CommissionTierService } from './commission.service.js';

const FINANCE: Actor = { personId: 'p_fin', sessionId: 's1' };
const OWNER: Actor = { personId: 'p_owner', sessionId: 's2' };
const DAY_MS = 86_400_000;

async function setup() {
  const clock = new FakeClock('2026-10-12T09:00:00Z');
  const uow = new UnitOfWork(new NoDatabaseRunner());
  const orgs = new OrgsService(undefined, clock, undefined, uow);
  const khalid = await orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: OWNER.personId });
  const identity = { firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, id === FINANCE.personId ? 'زينب' : null])) } as unknown as IdentityService;
  const audits = new AuditLogService(new InMemoryControlsRepository(), new StaffNames(identity, clock), clock);
  const service = new CommissionTierService(orgs, audits, clock, uow);
  return { clock, orgs, khalid, audits, service };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

describe('starter commission (Ali 2026-10-11)', () => {
  it('a new restaurant with no tier on file is on starter, 5 %, and its orders are charged at it', async () => {
    const h = await setup();
    expect(ORDERS_RULES.defaultCommissionTier).toBe('starter');
    expect(await h.service.view(h.khalid.id)).toMatchObject({ tier: 'starter', pct: 5, onFile: false, starterSince: h.khalid.createdAt, starterDays: 0, reviewDue: false, lastChange: null });
    // The order path reads the same default when the merchant has none on file.
    expect((await new OrgsMerchantDirectory(h.orgs, () => h.clock.now()).profile(h.khalid.id))?.commissionTier).toBe('starter');
  });

  it('the reminder shows after 7 weeks on starter and not before; nothing switches by itself', async () => {
    const h = await setup();
    h.clock.advance(48 * DAY_MS);
    expect((await h.service.view(h.khalid.id)).reviewDue).toBe(false);
    expect(await h.service.due('aziziyah')).toEqual([]);
    h.clock.advance(DAY_MS);
    expect(await h.service.view(h.khalid.id)).toMatchObject({ tier: 'starter', starterDays: 49, reviewDue: true });
    expect(await h.service.due('aziziyah')).toEqual([{ merchantOrgId: h.khalid.id, name: 'مطعم خالد', starterSince: h.khalid.createdAt, days: 49 }]);
    h.clock.advance(30 * DAY_MS);
    expect((await h.orgs.merchantSettings(h.khalid.id)).commissionTier).toBeNull();
    expect((await h.service.view(h.khalid.id)).tier).toBe('starter');
  });

  it('finance puts the store on another tier: written to the audit log, the reminder goes away', async () => {
    const h = await setup();
    h.clock.advance(50 * DAY_MS);
    const v = await h.service.set(FINANCE, { merchantOrgId: h.khalid.id, tier: 'base' });
    expect(v).toMatchObject({ tier: 'base', pct: 12, onFile: true, starterSince: null, reviewDue: false, lastChange: { byName: 'زينب', from: null, to: 'base' } });
    expect((await h.orgs.merchantSettings(h.khalid.id)).commissionTier).toBe('base');
    expect(await h.service.due('aziziyah')).toEqual([]);
    const rows = await h.audits.list({ subjectKind: COMMISSION_TIER_AUDIT.subjectKind, subjectId: h.khalid.id, limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: COMMISSION_TIER_AUDIT.action, actorId: FINANCE.personId, detail: { from: null, to: 'base', fromPct: 5, toPct: 12 } });
    // The same tier again changes nothing and writes no second row.
    await h.service.set(FINANCE, { merchantOrgId: h.khalid.id, tier: 'base' });
    expect(await h.audits.list({ subjectKind: 'store', subjectId: h.khalid.id, limit: 10 })).toHaveLength(1);
  });

  it("nobody sets the rate of his own shop; households and unknown ids are not stores", async () => {
    const h = await setup();
    expect(await code(h.service.set(OWNER, { merchantOrgId: h.khalid.id, tier: 'starter' }))).toBe('staff_own_account');
    const home = await h.orgs.createHousehold({ name: 'بيت', cityId: 'aziziyah', payerId: 'p_c' });
    expect(await code(h.service.view(home.id))).toBe('org_not_found');
    expect(await code(h.service.view('org_nope'))).toBe('org_not_found');
    expect(await h.audits.list({ subjectKind: 'store', subjectId: h.khalid.id, limit: 10 })).toEqual([]);
  });
});

describe('the home rate is a home kitchen’s alone (أكل بيت)', () => {
  /** A cook's kitchen as activation leaves it: a restaurant org on the home tier. */
  async function kitchen(h: Awaited<ReturnType<typeof setup>>) {
    const k = await h.orgs.create({ type: 'restaurant', name: 'مطبخ أم حسين', cityId: 'aziziyah', ownerId: 'p_cook' });
    await h.orgs.setMerchantSettings(k.id, { commissionTier: 'home' });
    return k;
  }

  it('finance cannot move an ordinary store onto home, whatever its tier', async () => {
    const h = await setup();
    expect(await code(h.service.set(FINANCE, { merchantOrgId: h.khalid.id, tier: 'home' }))).toBe('commission_tier_home_only');
    await h.service.set(FINANCE, { merchantOrgId: h.khalid.id, tier: 'base' });
    expect(await code(h.service.set(FINANCE, { merchantOrgId: h.khalid.id, tier: 'home' }))).toBe('commission_tier_home_only');
    expect((await h.orgs.merchantSettings(h.khalid.id)).commissionTier).toBe('base');
    // Only the base move is on the audit log.
    expect((await h.audits.list({ subjectKind: 'store', subjectId: h.khalid.id, limit: 10 })).map((a) => a.detail['to'])).toEqual(['base']);
  });

  it('a home kitchen cannot be moved off home to any other tier; home again is a no-op', async () => {
    const h = await setup();
    const k = await kitchen(h);
    for (const tier of MerchantCommissionTier.options.filter((t) => t !== 'home')) {
      expect(await code(h.service.set(FINANCE, { merchantOrgId: k.id, tier }))).toBe('commission_tier_home_only');
    }
    expect((await h.orgs.merchantSettings(k.id)).commissionTier).toBe('home');
    expect(await h.service.set(FINANCE, { merchantOrgId: k.id, tier: 'home' })).toMatchObject({ tier: 'home' });
    expect(await h.audits.list({ subjectKind: 'store', subjectId: k.id, limit: 10 })).toEqual([]);
  });

  it('the picker offers only home to a home kitchen, and never home to anyone else', async () => {
    const h = await setup();
    const k = await kitchen(h);
    expect((await h.service.view(k.id)).options.map((o) => o.tier)).toEqual(['home']);
    expect((await h.service.view(k.id)).tier).toBe('home');
    // A store with nothing on file (starter by default) and one put on another tier.
    const others = MerchantCommissionTier.options.filter((t) => t !== 'home');
    expect((await h.service.view(h.khalid.id)).options.map((o) => o.tier)).toEqual(others);
    await h.service.set(FINANCE, { merchantOrgId: h.khalid.id, tier: 'featured' });
    expect((await h.service.view(h.khalid.id)).options.map((o) => o.tier)).toEqual(others);
  });
});
