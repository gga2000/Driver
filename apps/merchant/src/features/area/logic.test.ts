import { describe, expect, it } from 'vitest';
import type { DeliveryAreaZone } from '@driver/contracts';
import { color } from '@driver/design-tokens';
import { M_PER_DEG_LAT, metresPerDegLng, SVG_FIT_PADDING_PX } from '@driver/map';
import {
  bandColor,
  CUSTOMER_HEAT,
  customerFills,
  customerLevel,
  customerRows,
  FEE_RAMP,
  feeShade,
  fitZoneMap,
  legendRows,
  mapPoints,
  PAUSED_FILL,
  pausedCount,
  selectedZone,
  sharePercent,
  UNPRICED_FILL,
  zoneName,
  zoneRows,
} from './logic';

const zone = (key: string, patch: Partial<DeliveryAreaZone> = {}): DeliveryAreaZone => ({
  key,
  name_ar: key,
  name_en: key.toUpperCase(),
  tier: 'near',
  placement: 'draft',
  ring: [
    { lat: 32.9, lng: 45.06 },
    { lat: 32.91, lng: 45.06 },
    { lat: 32.91, lng: 45.07 },
  ],
  centre: { lat: 32.905, lng: 45.065 },
  feeIqd: 500,
  band: 0,
  service: 'open',
  kitchen: false,
  ...patch,
});

describe('fee bands and legend', () => {
  it('spreads bands over the whole ramp, cheapest lightest, colours only from design tokens', () => {
    expect(bandColor(0, 4)).toBe(FEE_RAMP[0]);
    expect(bandColor(3, 4)).toBe(FEE_RAMP[FEE_RAMP.length - 1]);
    expect(bandColor(0, 2)).toBe(color.primary[200]);
    expect(bandColor(1, 2)).toBe(color.primary[700]);
    expect(bandColor(0, 1)).toBe(FEE_RAMP[2]); // one fee: mid orange
    // Each band darker than the one before.
    const four = [0, 1, 2, 3].map((b) => FEE_RAMP.indexOf(bandColor(b, 4)));
    expect(four).toEqual([...four].sort((a, b) => a - b));
    expect(new Set(four).size).toBe(4);
    // More bands than colours: still a ramp colour, never undefined.
    expect(FEE_RAMP).toContain(bandColor(9, 10));
    for (const c of FEE_RAMP) expect(Object.values(color.primary)).toContain(c);
  });

  it('legend rows follow the server bands in order with their map colour', () => {
    const rows = legendRows({ bands: [{ feeIqd: 500, zones: 9 }, { feeIqd: 1000, zones: 13 }, { feeIqd: 1500, zones: 9 }, { feeIqd: 2000, zones: 3 }] });
    expect(rows.map((r) => [r.feeIqd, r.zones])).toEqual([[500, 9], [1000, 13], [1500, 9], [2000, 3]]);
    expect(rows.map((r) => r.color)).toEqual([0, 1, 2, 3].map((b) => bandColor(b, 4)));
    expect(legendRows({ bands: [] })).toEqual([]);
  });

  it('paints paused zones dashed and unpriced zones neutral', () => {
    expect(feeShade({ band: 1, service: 'open' }, 3)).toEqual({ fill: bandColor(1, 3), dashed: false });
    expect(feeShade({ band: 1, service: 'paused' }, 3)).toEqual({ fill: PAUSED_FILL, dashed: true });
    expect(feeShade({ band: null, service: 'no_price' }, 3)).toEqual({ fill: UNPRICED_FILL, dashed: false });
    expect(pausedCount([zone('a', { service: 'paused' }), zone('b'), zone('c', { service: 'paused' })])).toBe(2);
  });
});

describe('zone list and selection', () => {
  it('kitchen first, then cheapest, then by name; unpriced last', () => {
    const rows = zoneRows([
      zone('ج', { feeIqd: 1000 }),
      zone('ب', { feeIqd: 500 }),
      zone('د', { feeIqd: null, band: null, service: 'no_price' }),
      zone('أ', { feeIqd: 500 }),
      zone('ه', { feeIqd: 500, kitchen: true }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['ه', 'أ', 'ب', 'ج', 'د']);
  });

  it('shows the tapped zone, else the kitchen’s, else nothing', () => {
    const zones = [zone('a'), zone('k', { kitchen: true })];
    expect(selectedZone(zones, 'a')?.key).toBe('a');
    expect(selectedZone(zones, null)?.key).toBe('k');
    expect(selectedZone(zones, 'gone')?.key).toBe('k');
    expect(selectedZone([zone('a')], null)).toBeNull();
  });

  it('names follow the app language', () => {
    expect(zoneName({ name_ar: 'زاكور', name_en: 'Zakur' }, 'ar-IQ')).toBe('زاكور');
    expect(zoneName({ name_ar: 'زاكور', name_en: 'Zakur' }, 'en')).toBe('Zakur');
  });

  it('fits outlines, centres of zones without one, and the kitchen', () => {
    const pts = mapPoints([zone('a'), zone('b', { ring: [] })], { lat: 1, lng: 2 });
    expect(pts).toHaveLength(3 + 1 + 1);
    expect(pts).toContainEqual({ lat: 32.905, lng: 45.065 });
    expect(pts.at(-1)).toEqual({ lat: 1, lng: 2 });
  });
});

describe('where my customers are', () => {
  const data = {
    totalOrders: 40,
    zones: [
      { key: 'hashimi', name_ar: 'الهاشمي', name_en: 'Al-Hashimi', orders: 5 },
      { key: 'zakur', name_ar: 'زاكور', name_en: 'Zakur', orders: 20 },
      { key: 'deir', name_ar: 'الدير', name_en: 'Al-Deir', orders: 11 },
    ],
  };

  it('ranks most orders first, shares of every delivered order (other included)', () => {
    const rows = customerRows(data);
    expect(rows.map((r) => [r.key, r.orders, sharePercent(r.share)])).toEqual([
      ['zakur', 20, 50],
      ['deir', 11, 28],
      ['hashimi', 5, 13],
    ]);
    expect(rows.map((r) => r.level)).toEqual([4, 3, 1]);
  });

  it('shades by level on the brand ramp; unnamed zones get no shade', () => {
    const fills = customerFills(customerRows(data));
    expect(fills.get('zakur')).toBe(CUSTOMER_HEAT[4]);
    expect(fills.get('hashimi')).toBe(CUSTOMER_HEAT[1]);
    expect(fills.has('khamas')).toBe(false);
  });

  it('levels are quartiles of the busiest zone; tiny shares still read 1%', () => {
    expect([1, 2, 3, 4].map((n) => customerLevel(n, 4))).toEqual([1, 2, 3, 4]);
    expect(customerLevel(5, 0)).toBe(1);
    expect(sharePercent(0)).toBe(0);
    expect(sharePercent(0.002)).toBe(1);
    expect(customerRows({ zones: [], totalOrders: 3 })).toEqual([]);
  });
});

describe('fitZoneMap', () => {
  // A town about 1.9 km east–west and 3.3 km north–south around Aziziyah's latitude.
  const town = [
    { lat: 32.89, lng: 45.05 },
    { lat: 32.92, lng: 45.07 },
  ];
  const hugs = (p: ReturnType<typeof fitZoneMap>) => {
    expect(p.x(45.05)).toBeCloseTo(SVG_FIT_PADDING_PX, 0);
    expect(p.x(45.07)).toBeCloseTo(p.width - SVG_FIT_PADDING_PX, 0);
    expect(p.y(32.92)).toBeCloseTo(SVG_FIT_PADDING_PX, 0);
    expect(p.y(32.89)).toBeCloseTo(p.height - SVG_FIT_PADDING_PX, 0);
  };

  it('frames the zones tightly: their own shape, only the fit padding around them', () => {
    const p = fitZoneMap(town, 600);
    expect(p.width).toBe(600);
    // Taller than the panel-shaped limit (1.25) would allow: the town is ~1.75 times taller than wide.
    expect(p.height).toBeGreaterThan(600 * 1.25);
    hugs(p);
  });

  it('keeps the whole map inside the height it is given, narrower and still to scale', () => {
    const p = fitZoneMap(town, 600, 500);
    expect(p.height).toBeLessThanOrEqual(500);
    expect(p.height).toBeGreaterThan(495);
    expect(p.width).toBeLessThan(600);
    hugs(p);
    // A kilometre east is as long as a kilometre north (cos(latitude) on longitude).
    const kmEast = p.x(45.05 + 1000 / metresPerDegLng(32.905)) - p.x(45.05);
    const kmNorth = p.y(32.89) - p.y(32.89 + 1000 / M_PER_DEG_LAT);
    expect(kmEast).toBeCloseTo(kmNorth, 0);
  });

  it('stays full width when the map already fits the height', () => {
    expect(fitZoneMap(town, 300, 2000).width).toBe(300);
  });

  it('never exceeds the height across many sizes (rounding)', () => {
    for (let h = 150; h < 900; h += 37) expect(fitZoneMap(town, 1000, h).height).toBeLessThanOrEqual(h);
  });
});
