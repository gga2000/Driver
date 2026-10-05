import { describe, expect, it } from 'vitest';
import type { SafetyEntry, SafetyIncidentSummary } from '@driver/contracts';
import { ageText, bannerOrder, entryText, mapsUrl, shouldRing, trailPath } from './safety';

const row = (id: string, state: SafetyIncidentSummary['state'], minAgo: number): SafetyIncidentSummary =>
  ({ id, state, raisedAt: new Date(Date.UTC(2026, 9, 5, 18, 0) - minAgo * 60_000), raiser: { personId: 'p', role: 'driver', displayName: 'حيدر ك.', phoneMasked: null } }) as SafetyIncidentSummary;

describe('SOS banner order and alarm', () => {
  it('lists the alerts nobody took first, oldest first; closed ones never show', () => {
    const rows = [row('a', 'acknowledged', 9), row('b', 'open', 1), row('c', 'resolved', 20), row('d', 'open', 4), row('e', 'cancelled', 2)];
    expect(bannerOrder(rows).map((r) => r.id)).toEqual(['d', 'b', 'a']);
  });

  it('rings while an alert is open and not muted; a new alert rings again', () => {
    const rows = [row('a', 'open', 1), row('b', 'acknowledged', 3)];
    expect(shouldRing(rows, new Set())).toBe(true);
    expect(shouldRing(rows, new Set(['a']))).toBe(false);
    expect(shouldRing([...rows, row('c', 'open', 0)], new Set(['a']))).toBe(true);
    expect(shouldRing([row('b', 'acknowledged', 3)], new Set())).toBe(false);
  });

  it('says the age in seconds, then minutes and hours', () => {
    expect(ageText(42_000)).toBe('42 ث');
    expect(ageText(3 * 60_000 + 5_000)).toBe('3 د');
    expect(ageText(65 * 60_000)).toBe('1 س 5 د');
  });
});

describe('SOS incident helpers', () => {
  it('draws the trail north-up inside the box and ends on the last fix', () => {
    const p = trailPath(
      [
        { lat: 32.9, lng: 45.06 },
        { lat: 32.901, lng: 45.06 },
        { lat: 32.901, lng: 45.061 },
      ],
      320,
      150,
    );
    const pts = p.points.split(' ').map((s) => s.split(',').map(Number));
    expect(pts).toHaveLength(3);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(320);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(150);
    }
    expect(pts[1]![1]).toBeLessThan(pts[0]![1]!); // north is up
    expect(pts[2]![0]).toBeGreaterThan(pts[1]![0]!); // east is right
    expect(p.last!.x).toBeCloseTo(pts[2]![0]!, 0);
    expect(p.last!.y).toBeCloseTo(pts[2]![1]!, 0);
    expect(p.spanM).toBeGreaterThan(90);
    expect(trailPath([], 10, 10)).toEqual({ points: '', first: null, last: null, spanM: 0 });
  });

  it('writes the timeline in words and links a fix to maps', () => {
    const e = (kind: SafetyEntry['kind'], data: Record<string, string> = {}, byName: string | null = 'حيدر'): SafetyEntry => ({ id: kind, kind, at: new Date(), byName, note: null, data });
    expect(entryText(e('raised', {}, null), 'زينب ع.')).toBe('زينب ع.: ضغط طوارئ');
    expect(entryText(e('paged', { count: '3' }, null), 'x')).toBe('نبّهنا 3 من الديسباتشر');
    expect(entryText(e('call', { who: 'contact' }), 'x')).toBe('حيدر اتصل برقم الطوارئ');
    expect(entryText(e('acknowledged'), 'x')).toBe('استلمه حيدر');
    expect(mapsUrl({ lat: 32.9095, lng: 45.0635 })).toBe('https://www.google.com/maps/search/?api=1&query=32.909500,45.063500');
  });
});
