import type { DriverRosterRow, MerchantRow } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { flattenRoster, merchantOptionLabel, merchantsForPicker, rosterInput } from './roster';

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
