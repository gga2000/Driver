import type { DriverRosterRow, MerchantRow } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { capFill, flattenRoster, looksLikeId, merchantOptionLabel, merchantsForPicker, rosterInput, sortRoster } from './roster';

const row = (personId: string): DriverRosterRow => ({
  personId,
  roles: ['courier'],
  frozen: false,
  trustTier: 'new',
  joinedAt: new Date('2026-10-01T00:00:00Z'),
  online: false,
  state: null,
  vehicleClass: null,
  zoneId: null,
  lastSeenAt: null,
  tripId: null,
  tier: 'gold',
  scoreIndex: 100,
  observation: true,
  today: null,
  cash: null,
  docs: null,
});

const merchant = (merchantId: string, name: string, overExposure = false): MerchantRow => ({
  merchantId,
  name,
  type: 'restaurant',
  cityId: 'aziziyah',
  balanceIqd: 45_000,
  mode: 'nightly_courier',
  exposureCapIqd: 300_000,
  overExposure,
  lastHeartbeatAt: null,
});

describe('roster helpers', () => {
  it('builds the drivers.list input, dropping empty filters', () => {
    expect(rosterInput('aziziyah', { presence: 'all', role: 'all', q: ' ' })).toEqual({ cityId: 'aziziyah', limit: 50, filter: { presence: 'all' } });
    expect(rosterInput('aziziyah', { presence: 'online', role: 'khat_driver', q: ' p_1 ' }, 20)).toEqual({
      cityId: 'aziziyah',
      limit: 20,
      filter: { presence: 'online', role: 'khat_driver', q: 'p_1' },
    });
  });

  it('sends a name to the logged name search and a pasted id to the id filter', () => {
    expect(looksLikeId('p_103')).toBe(true);
    expect(looksLikeId('حيدر')).toBe(false);
    expect(rosterInput('aziziyah', { presence: 'all', role: 'all', q: ' حيدر ك ' }).filter).toEqual({ presence: 'all', name: 'حيدر ك' });
    expect(rosterInput('aziziyah', { presence: 'all', role: 'all', q: 'p_103', tier: 'gold', docsExpiring: true }).filter).toEqual({ presence: 'all', q: 'p_103', tier: 'gold', docsExpiring: true });
  });

  it('puts problems first: over the cap, at its edge, papers, near it, then working, then offline', () => {
    const cash = (owedIqd: number) => ({ heldIqd: owedIqd, owedIqd, capIqd: 100_000, overCap: owedIqd >= 100_000 });
    const rows = [
      { ...row('offline'), state: null },
      { ...row('free'), state: 'free' as const, cash: cash(0) },
      { ...row('near'), state: 'free' as const, cash: cash(75_000) },
      { ...row('job'), state: 'on_job' as const, cash: cash(10_000) },
      { ...row('over'), state: 'over_cap' as const, cash: cash(120_000) },
      { ...row('papers'), docs: { state: 'expired' as const, expiresAt: new Date('2026-10-01T00:00:00Z') } },
      { ...row('edge'), state: 'on_job' as const, cash: cash(92_000) },
    ];
    expect(sortRoster(rows).map((r) => r.personId)).toEqual(['over', 'edge', 'papers', 'near', 'job', 'free', 'offline']);
    expect(capFill({ owedIqd: 45_000, capIqd: 90_000 })).toBe(0.5);
    expect(capFill({ owedIqd: 10, capIqd: 0 })).toBe(1);
  });

  it('flattens pages once per driver', () => {
    expect(flattenRoster([{ rows: [row('a'), row('b')] }, { rows: [row('b'), row('c')] }]).map((r) => r.personId)).toEqual(['a', 'b', 'c']);
    expect(flattenRoster(undefined)).toEqual([]);
  });
});

describe('merchant picker', () => {
  it('labels with the live balance and lists over-exposure first', () => {
    expect(merchantOptionLabel({ name: 'كباب', balanceIqd: 45_000 })).toBe('كباب · 45,000');
    expect(merchantsForPicker([merchant('a', 'مطعم ب'), merchant('b', 'مطعم أ'), merchant('c', 'مطعم ج', true)]).map((m) => m.merchantId)).toEqual(['c', 'b', 'a']);
  });
});
