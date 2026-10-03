import { describe, expect, it } from 'vitest';
import { isPartner, partnerCurrentStop, partnerModesOf, PartnerOffer } from './partner-io.js';

describe('partner-io', () => {
  it('maps roles to Partner modes in a stable order', () => {
    expect(partnerModesOf(['customer', 'field_ops', 'khat_driver', 'courier', 'shopper'])).toEqual(['courier', 'khat', 'ops']);
    expect(partnerModesOf(['customer'])).toEqual([]);
  });

  it('lets in drivers, fleet owners and field ops only', () => {
    expect(isPartner(['customer'])).toBe(false);
    expect(isPartner(['customer', 'intercity_driver'])).toBe(true);
    expect(isPartner(['fleet_owner'])).toBe(true);
    expect(isPartner(['merchant_owner', 'dispatcher'])).toBe(false);
  });

  it('the current task is the first open stop in run order', () => {
    const stops = [
      { stopId: 'b', seq: 1, state: 'pending' },
      { stopId: 'a', seq: 0, state: 'completed' },
      { stopId: 'c', seq: 2, state: 'pending' },
    ];
    expect(partnerCurrentStop(stops)?.stopId).toBe('b');
    expect(partnerCurrentStop([{ stopId: 'a', seq: 0, state: 'skipped' }])).toBeNull();
  });

  it('offer dates survive the wire as strings', () => {
    const parsed = PartnerOffer.parse({
      offerId: 'o',
      tripId: 't',
      vertical: 'food',
      wave: 1,
      sentAt: '2026-10-03T10:00:00Z',
      expiresAt: '2026-10-03T10:00:15Z',
      ringSec: 15,
      seen: false,
      pickup: { zoneId: 'centre', label: 'مطعم خالد', pin: null },
      dropoff: { zoneId: 'zakur', label: null, pin: null },
      distanceToPickupKm: 0.8,
      tripKm: 2.4,
      pay: { totalIqd: 1000, components: [{ key: 'delivery', amountIqd: 1000 }], takePct: null },
      batch: null,
      merchant: null,
      collectIqd: null,
    });
    expect(parsed.expiresAt.getTime() - parsed.sentAt.getTime()).toBe(15_000);
  });
});
