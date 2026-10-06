import { describe, expect, it } from 'vitest';
import type { EventLogEntry } from '@driver/contracts';
import { replayMarks, thinPoints, trailPurged } from './replay.js';

const ev = (id: string, type: string, min: number, extra: Partial<EventLogEntry> = {}) =>
  ({ id, type, occurredAt: new Date(Date.UTC(2026, 9, 5, 12, min)), location: { lat: 32.9, lng: 45.06 }, quarantined: false, ...extra }) as EventLogEntry;

describe('order replay (maps program o2)', () => {
  it('thins long trails evenly and keeps both ends', () => {
    const pts = Array.from({ length: 10_001 }, (_, i) => i);
    const thin = thinPoints(pts, 3_000);
    expect(thin).toHaveLength(3_000);
    expect(thin[0]).toBe(0);
    expect(thin.at(-1)).toBe(10_000);
    expect(thinPoints([1, 2, 3], 3_000)).toEqual([1, 2, 3]);
  });

  it('marks the moments that matter, once each, in order, never a quarantined replay', () => {
    const marks = replayMarks([
      ev('e3', 'stop.completed', 30),
      ev('e1', 'trip.accepted', 2),
      ev('e2', 'stop.arrived', 12),
      ev('e2', 'stop.arrived', 12),
      ev('e9', 'chat.sent', 5),
      ev('e8', 'stop.arrived', 20, { quarantined: true }),
    ]);
    expect(marks.map((m) => m.id)).toEqual(['e1', 'e2', 'e3']);
    expect(marks[0]).toMatchObject({ type: 'trip.accepted', lat: 32.9, lng: 45.06 });
  });

  it('the path is gone only when nothing was kept and the trip is past retention', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    expect(trailPurged(0, new Date('2026-10-05T00:00:00Z'), now)).toBe(true);
    expect(trailPurged(0, new Date('2026-11-10T00:00:00Z'), now)).toBe(false);
    expect(trailPurged(5, new Date('2026-10-05T00:00:00Z'), now)).toBe(false);
  });
});
