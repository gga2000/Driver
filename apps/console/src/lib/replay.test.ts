import { describe, expect, it } from 'vitest';
import type { OrderReplay } from '@driver/contracts';
import { pathUntil, positionAt, replayPath, replaySpan } from './replay';

const p = (sec: number, lat: number, lng = 45) => ({ lat, lng, at: new Date(sec * 1000), speedKmh: null });
const replay: OrderReplay = {
  orderId: 'o1',
  legs: [
    { tripId: 't2', courierId: 'd2', points: [p(30, 3), p(40, 4)], stops: [] },
    { tripId: 't1', courierId: 'd1', points: [p(0, 0), p(10, 1)], stops: [] },
  ],
  marks: [{ id: 'm', type: 'trip.accepted', at: new Date(-5_000), lat: null, lng: null }],
  trailPurged: false,
};

describe('order replay (maps program o2)', () => {
  it('one time-ordered path across reassigned trips', () => {
    expect(replayPath(replay).map((x) => x.lat)).toEqual([0, 1, 3, 4]);
  });

  it('interpolates between fixes and clamps at the ends', () => {
    const path = replayPath(replay);
    expect(positionAt(path, 5_000)).toEqual({ lat: 0.5, lng: 45 });
    expect(positionAt(path, -1_000)).toEqual({ lat: 0, lng: 45 });
    expect(positionAt(path, 99_000)).toEqual({ lat: 4, lng: 45 });
    expect(positionAt([], 0)).toBeNull();
  });

  it('the driven path ends where he is', () => {
    expect(pathUntil(replayPath(replay), 5_000)).toEqual([[45, 0], [45, 0.5]]);
  });

  it('spans the first moment to the last (marks included)', () => {
    expect(replaySpan(replay)).toEqual({ from: -5_000, to: 40_000 });
    expect(replaySpan({ ...replay, legs: [], marks: [] })).toBeNull();
  });
});
