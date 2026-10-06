import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { APPROVAL_KIND_AR, APPROVAL_KIND_ROLES } from './approvals.service.js';
import { csvField, roundCollections, roundOrder, roundWindowStart, toCsv } from './finance.service.js';
import { median, yesterdayValues } from './metrics.service.js';

const centroids = new Map(AZIZIYAH_ZONES.map((z) => [z.id, { lat: z.lat, lng: z.lng }] as const));

describe('control room helpers', () => {
  it('the 23:00 round starts at the centre and always drives to the nearest zone next; unknown zones go last', () => {
    const order = roundOrder(['khamas', 'unknown', 'centre', 'zakur', 'street_30'], centroids);
    expect(order[0]).toBe('centre');
    expect(order.at(-1)).toBe('unknown');
    expect(new Set(order)).toEqual(new Set(['khamas', 'unknown', 'centre', 'zakur', 'street_30']));
    // street_30 sits next to the centre; the far khamas comes after the nearer zakur.
    expect(order.indexOf('street_30')).toBe(1);
    expect(order.indexOf('zakur')).toBeLessThan(order.indexOf('khamas'));
    expect(roundOrder([], centroids)).toEqual([]);
  });

  it('CSV: RFC 4180 quoting, a BOM for Excel, CRLF rows', () => {
    expect(csvField('مطعم خالد')).toBe('مطعم خالد');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('قال "هلا"')).toBe('"قال ""هلا"""');
    expect(csvField(null)).toBe('');
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('﻿a,b\r\n1,"x,y"\r\n');
  });

  it("S-K5: tonight's round counts receipts from 18:00 Baghdad, and past midnight it is still last night's", () => {
    expect(roundWindowStart(new Date('2026-10-05T19:30:00Z')).toISOString()).toBe('2026-10-05T15:00:00.000Z'); // 22:30 → 18:00 today
    expect(roundWindowStart(new Date('2026-10-05T22:10:00Z')).toISOString()).toBe('2026-10-05T15:00:00.000Z'); // 01:10 → 18:00 yesterday
    expect(roundWindowStart(new Date('2026-10-06T03:00:00Z')).toISOString()).toBe('2026-10-06T15:00:00.000Z'); // 06:00 → tonight's (later)
  });

  it('S-K5: per courier, only ops-round receipts, summed, with the latest time and reference', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 5, 19, m));
    const line = (to: string, amount: number, memo: string, m: number, type = 'driver_settlement') => ({ type, toAccount: to, amount, memo, occurredAt: at(m) });
    const got = roundCollections([
      line('cash:k1', 20_000, 'ops_round:D-AAAA-0001', 5),
      line('cash:k1', 14_900, 'ops_round:D-AAAA-0002', 9),
      line('cash:k2', 9_000, 'zaincash:D-BBBB-0001', 6),
      line('cash:k3', 5_000, 'ops_round:D-CCCC-0001', 7, 'merchant_paid_by_courier'),
    ]);
    expect([...got.keys()]).toEqual(['k1']);
    expect(got.get('k1')).toEqual({ amountIqd: 34_900, at: at(9), reference: 'D-AAAA-0002' });
  });

  it('S-K6: the tiles as they stood 24 hours ago', () => {
    expect(yesterdayValues({ durations: [30, 40, 20], offers: { accepted: 17, declined: 2, timedOut: 1 }, ordersByNow: 12, seats: 4 })).toEqual({ median_delivery: 30, acceptance: 0.85, orders_day: 12, rajaa_seats: 4 });
    expect(yesterdayValues({ durations: null, offers: null, ordersByNow: 0, seats: null })).toEqual({ median_delivery: null, acceptance: null, orders_day: 0, rajaa_seats: null });
    expect(yesterdayValues({ durations: [], offers: { accepted: 0, declined: 0, timedOut: 0 }, ordersByNow: 3, seats: 0 }).acceptance).toBeNull();
  });

  it('median of delivery minutes', () => {
    expect(median([])).toBeNull();
    expect(median([40, 20, 30])).toBe(30);
    expect(median([20, 30, 40, 50])).toBe(35);
  });

  it('every approval kind has an Arabic name and reviewers among the queue roles', () => {
    for (const [kind, roles] of Object.entries(APPROVAL_KIND_ROLES)) {
      expect(APPROVAL_KIND_AR[kind as keyof typeof APPROVAL_KIND_AR]).toBeTruthy();
      expect(roles.length).toBeGreaterThan(0);
      for (const r of roles) expect(['admin', 'support', 'field_ops']).toContain(r);
    }
    // The platform approval switch for deals stays with admin / support (merchant-admin deals.review).
    expect(APPROVAL_KIND_ROLES.merchant_deal).toEqual(['admin', 'support']);
  });
});
