import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { APPROVAL_KIND_AR, APPROVAL_KIND_ROLES } from './approvals.service.js';
import { csvField, roundOrder, toCsv } from './finance.service.js';
import { median } from './metrics.service.js';

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
