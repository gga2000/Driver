import { describe, expect, it } from 'vitest';
import type { PartnerOffer } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { OFFER_MAP_FULL, offerBodyHeight, offerDetailsOpen, offerLayout, offerSummary, rideMinutes } from './offer-layout';

const t = createT('ar-IQ');

const food = (over: Partial<PartnerOffer> = {}): PartnerOffer => ({
  offerId: 'o1',
  tripId: 't1',
  vertical: 'food',
  wave: 1,
  sentAt: new Date('2026-10-05T10:00:00Z'),
  expiresAt: new Date('2026-10-05T10:00:15Z'),
  ringSec: 15,
  seen: false,
  pickup: { zoneId: 'centre', label: 'مطعم خالد', pin: null, landmark: null },
  dropoff: { zoneId: 'zakur', label: null, pin: null, landmark: null },
  distanceToPickupKm: 0.6,
  tripKm: 2.8,
  pay: { totalIqd: 1000, components: [{ key: 'delivery', amountIqd: 1000 }], takePct: null },
  batch: null,
  merchant: { name: 'مطعم خالد', state: 'preparing', readyInMin: 9 },
  collectIqd: 18_000,
  favourite: false,
  nudgedAt: null,
  rideCargo: [],
  rider: null,
  climate: null,
  riderTrips: null,
  ...over,
});

describe('offer card layout (P-04)', () => {
  it('360×740: the map shrinks to 28 % of the height (at most 220 px)', () => {
    const l = offerLayout(740);
    expect(l.compact).toBe(true);
    expect(l.mapHeight).toBe(207);
    expect(offerLayout(640).mapHeight).toBe(179);
    expect(offerLayout(500).mapHeight).toBe(150);
  });

  it('390×844 keeps the full 300 px map', () => {
    expect(offerLayout(844)).toMatchObject({ compact: false, mapHeight: OFFER_MAP_FULL });
  });

  it('the whole offer fits without scrolling on 360×740 and 390×844, batch banner included', () => {
    for (const h of [740, 844]) {
      const l = offerLayout(h);
      for (const batch of [false, true]) {
        for (const components of [1, 3]) {
          const details = offerDetailsOpen(l, { batch, components }, h);
          const total = l.mapHeight + offerBodyHeight(l, { batch, details, components });
          expect(total, `${h} batch=${batch} components=${components}`).toBeLessThanOrEqual(h);
        }
      }
    }
    // Room to spare on the small phone for an Android navigation bar.
    const compact = offerLayout(740);
    expect(compact.mapHeight + offerBodyHeight(compact, { batch: false, details: false, components: 1 })).toBeLessThanOrEqual(740 - 100);
  });

  it('pay details start folded when there is one line, or when opening them would push past the fold', () => {
    expect(offerDetailsOpen(offerLayout(844), { batch: false, components: 3 }, 844)).toBe(true);
    expect(offerDetailsOpen(offerLayout(844), { batch: true, components: 3 }, 844)).toBe(false);
    expect(offerDetailsOpen(offerLayout(844), { batch: false, components: 1 }, 844)).toBe(false);
  });
});

describe('offer summary line (S-1)', () => {
  it('total km and minutes: ride to the kitchen or wait for it, whichever is later, then the trip', () => {
    const s = offerSummary(food(), 'bike', false);
    expect(s.totalKm).toBe(3.4);
    // 0.6 km at 25 km/h = 1 min, but the kitchen needs 9; then 2.8 km = 7 min.
    expect(s.minutes).toBe(9 + rideMinutes(2.8, 'bike'));
    expect(t('partner.offer_summary', { km: '3.4', minutes: s.minutes! })).toBe(`3.4 كم · ~${s.minutes} دقيقة`);
  });

  it('a ready kitchen counts only the ride', () => {
    const s = offerSummary(food({ merchant: { name: 'x', state: 'ready', readyInMin: 0 } }), 'bike', false);
    expect(s.minutes).toBe(rideMinutes(0.6, 'bike') + rideMinutes(2.8, 'bike'));
  });

  it('rides use the vehicle speed and never wait for a kitchen', () => {
    const s = offerSummary(food({ vertical: 'tuktuk', merchant: null, collectIqd: 3_000, distanceToPickupKm: 1.5, tripKm: 4 }), 'tuktuk', true);
    expect(s.totalKm).toBe(5.5);
    expect(s.minutes).toBe(rideMinutes(1.5, 'tuktuk') + rideMinutes(4, 'tuktuk'));
    expect(s.prepaid).toBe(false);
    expect(s.collectIqd).toBe(3_000);
  });

  it('cash to collect, prepaid food, and a ride without cash', () => {
    expect(offerSummary(food(), 'bike', false)).toMatchObject({ collectIqd: 18_000, prepaid: false });
    expect(offerSummary(food({ collectIqd: null }), 'bike', false)).toMatchObject({ collectIqd: null, prepaid: true });
    expect(offerSummary(food({ vertical: 'taxi', collectIqd: null }), 'car', true)).toMatchObject({ collectIqd: null, prepaid: false });
  });

  it('"جنبك" under 100 m instead of "يبعد 0 كم"', () => {
    expect(offerSummary(food({ distanceToPickupKm: 0.04 }), 'bike', false).near).toBe(true);
    expect(offerSummary(food({ distanceToPickupKm: 0.6 }), 'bike', false).near).toBe(false);
    expect(t('partner.offer_near')).toBe('جنبك');
  });

  it('no distances: no summary line; one pay component folds away', () => {
    const s = offerSummary(food({ distanceToPickupKm: null, tripKm: null }), 'bike', false);
    expect(s.totalKm).toBeNull();
    expect(s.minutes).toBeNull();
    expect(s.singleComponent).toBe(true);
    expect(offerSummary(food({ pay: { totalIqd: 1700, components: [{ key: 'delivery', amountIqd: 1000 }, { key: 'batch_bonus', amountIqd: 700 }], takePct: null } }), 'bike', false).singleComponent).toBe(false);
  });

  it('the cash chip says دينار', () => {
    expect(t('partner.offer_cash_chip', { amount: '18,000' })).toBe('كاش 18,000 دينار');
  });
});
