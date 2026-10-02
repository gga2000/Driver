import { describe, expect, it } from 'vitest';
import {
  AZIZIYAH_ZONES,
  CITIES,
  DEMO_RESTAURANT,
  DISPATCHER,
  MEETING_POINTS,
  TAXONOMY,
  hexagonWkt,
  pointWkt,
} from '../prisma/seed-data.js';

describe('seed data (plan Step 1)', () => {
  it('seeds the launch city plus the two intercity destinations', () => {
    expect(CITIES.map((c) => c.id)).toEqual(['aziziyah', 'kut', 'baghdad']);
    expect(CITIES.find((c) => c.id === 'aziziyah')?.active).toBe(true);
  });

  it('seeds all 34 Aziziyah zones with tiers and ext ids', () => {
    expect(AZIZIYAH_ZONES).toHaveLength(34);
    for (const z of AZIZIYAH_ZONES) {
      expect(z.extId).toMatch(/^\d{4}$/);
      expect(['centre', 'near', 'mid', 'far', 'edge']).toContain(z.tier);
      expect(z.name_ar.length).toBeGreaterThan(0);
    }
    expect(AZIZIYAH_ZONES.find((z) => z.extId === '5854')?.name_ar).toBe('العزيزية (مركز)');
    expect(AZIZIYAH_ZONES.find((z) => z.extId === '5079')?.tier).toBe('far');
    expect(AZIZIYAH_ZONES.find((z) => z.extId === '5076')?.tier).toBe('edge');
  });

  it('draft polygons are closed WKT hexagons around the centroid', () => {
    const z = AZIZIYAH_ZONES[0]!;
    const wkt = hexagonWkt(z);
    expect(wkt).toMatch(/^POLYGON\(\(.*\)\)$/);
    const pts = wkt.slice('POLYGON(('.length, -2).split(', ');
    expect(pts).toHaveLength(7);
    expect(pts[0]).toBe(pts[6]);
    for (const p of pts) {
      const [lng, lat] = p.split(' ').map(Number) as [number, number];
      expect(Math.abs(lat - z.lat)).toBeLessThan(0.01);
      expect(Math.abs(lng - z.lng)).toBeLessThan(0.01);
    }
    expect(pointWkt({ lat: 32.9, lng: 45.06 })).toBe('POINT(45.060000 32.900000)');
  });

  it('seeds 4 garages (3 in Aziziyah, النهضة in Baghdad) and 6 meeting points on known zones', () => {
    const garages = MEETING_POINTS.filter((m) => m.garage);
    const points = MEETING_POINTS.filter((m) => !m.garage);
    expect(garages).toHaveLength(4);
    expect(points).toHaveLength(6);
    expect(garages.map((g) => g.nameAr)).toEqual(['كراج البوابة ١', 'كراج البوابة ٢', 'كراج السوق', 'كراج النهضة']);
    expect(garages.find((g) => g.nameAr === 'كراج النهضة')?.cityId).toBe('baghdad');
    const zoneKeys = new Set(AZIZIYAH_ZONES.map((z) => z.id));
    for (const m of MEETING_POINTS) if (m.zoneKey) expect(zoneKeys.has(m.zoneKey), m.key).toBe(true);
    expect(new Set(MEETING_POINTS.map((m) => m.key)).size).toBe(MEETING_POINTS.length);
  });

  it('taxonomy parents precede their children and roots exist', () => {
    const seen = new Set<string>();
    for (const n of TAXONOMY) {
      if (n.parent) expect(seen.has(n.parent), `${n.slug} before parent ${n.parent}`).toBe(true);
      seen.add(n.slug);
    }
    expect(TAXONOMY.filter((n) => !n.parent).map((n) => n.slug)).toEqual(['food', 'drinks', 'grocery', 'pharmacy']);
  });

  it('demo restaurant has 10 items with integer prices on known taxonomy nodes', () => {
    expect(DEMO_RESTAURANT.items).toHaveLength(10);
    const slugs = new Set(TAXONOMY.map((n) => n.slug));
    for (const i of DEMO_RESTAURANT.items) {
      expect(Number.isInteger(i.priceIqd) && i.priceIqd > 0).toBe(true);
      expect(slugs.has(i.taxonomy), i.taxonomy).toBe(true);
    }
  });

  it('dispatcher is seeded by E.164 phone (vault only)', () => {
    expect(DISPATCHER.phoneE164).toMatch(/^\+964\d{9,10}$/);
  });
});
