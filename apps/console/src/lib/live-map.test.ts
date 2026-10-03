import { MARKER_COLORS } from '@driver/map';
import { describe, expect, it } from 'vitest';
import { card, pin, stop, trip } from './fixtures';
import { buildLiveGeoJSON, capUsePct, countPins, driverPosition, featureId, markerStateForPin, markerStateForTrip, nextStop } from './live-map';

const A = { lat: 32.905, lng: 45.06 };
const B = { lat: 32.942, lng: 45.085 };

describe('live map GeoJSON', () => {
  it('maps trip states to marker states', () => {
    expect(markerStateForTrip('in_transit')).toBe('on_job');
    expect(markerStateForTrip('offered')).toBe('offered');
    expect(markerStateForTrip('completed')).toBe('offline');
  });

  it('places the driver at the last reached stop, else the first stop', () => {
    const heading = trip({ id: 't1', stops: [stop({ id: 's2', seq: 1, type: 'dropoff', target: B }), stop({ id: 's1', seq: 0, target: A })] });
    expect(driverPosition(heading)).toEqual(A);
    const picked = trip({
      id: 't2',
      stops: [stop({ id: 's1', seq: 0, target: A, state: 'completed', completedAt: new Date() }), stop({ id: 's2', seq: 1, type: 'dropoff', target: B })],
    });
    expect(driverPosition(picked)).toEqual(A);
    expect(nextStop(picked)?.id).toBe('s2');
    expect(driverPosition(trip({ id: 't3' }))).toBeNull();
  });

  it('builds a route line, stop points and one marker per driver', () => {
    const t1 = trip({
      id: 't1',
      courierId: 'd1',
      state: 'in_transit',
      stops: [stop({ id: 's1', seq: 0, target: A, state: 'completed' }), stop({ id: 's2', seq: 1, type: 'dropoff', target: B })],
    });
    const t2 = trip({ id: 't2', courierId: 'd1', state: 'accepted', stops: [stop({ id: 's3', seq: 0, target: B })] });
    const t3 = trip({ id: 't3', state: 'offered', stops: [stop({ id: 's4', seq: 0, target: A }), stop({ id: 's5', seq: 1, target: null })] });
    const live = buildLiveGeoJSON([t1, t2, t3], [card({ tripId: 't3', red: true })]);

    expect(live.trips.features).toHaveLength(1);
    expect(live.trips.features[0]!.geometry.coordinates).toEqual([
      [A.lng, A.lat],
      [B.lng, B.lat],
    ]);
    expect(live.stops.features).toHaveLength(4);
    expect(live.drivers.features).toHaveLength(1);
    const d = live.drivers.features[0]!;
    expect(d.properties).toMatchObject({ driverId: 'd1', tripId: 't1', state: 'on_job', color: MARKER_COLORS.on_job, approx: true });
    expect(d.id).toBe(featureId('d1'));
    const redStop = live.stops.features.find((f) => f.properties.tripId === 't3')!;
    expect(redStop.properties.color).toBe(MARKER_COLORS.over_cap);
  });

  it('with presence pins: real positions and states, no approximate markers from trips', () => {
    const t1 = trip({ id: 't1', courierId: 'd1', state: 'in_transit', stops: [stop({ id: 's1', seq: 0, target: A }), stop({ id: 's2', seq: 1, target: B })] });
    const live = buildLiveGeoJSON([t1], [], [pin({ driverId: 'd1', lat: 32.93, lng: 45.07, state: 'on_job', tripId: 't1' }), pin({ driverId: 'd2', state: 'offline_recent' })]);
    expect(live.drivers.features).toHaveLength(2);
    const [d1, d2] = live.drivers.features;
    expect(d1!.geometry.coordinates).toEqual([45.07, 32.93]);
    expect(d1!.properties).toMatchObject({ driverId: 'd1', tripId: 't1', state: 'on_job', approx: false });
    expect(d2!.properties).toMatchObject({ driverId: 'd2', tripId: '', state: 'offline', color: MARKER_COLORS.offline, approx: false });
    // Trip lines still draw.
    expect(live.trips.features).toHaveLength(1);
  });

  it('an empty pin list is real data: nobody online, no fallback markers', () => {
    const t1 = trip({ id: 't1', courierId: 'd1', state: 'accepted', stops: [stop({ id: 's1', seq: 0, target: A })] });
    expect(buildLiveGeoJSON([t1], [], []).drivers.features).toEqual([]);
    expect(buildLiveGeoJSON([t1], [], null).drivers.features[0]?.properties.approx).toBe(true);
  });

  it('maps pin states, counts them and computes the cap use', () => {
    expect(markerStateForPin('over_cap')).toBe('over_cap');
    expect(markerStateForPin('offline_recent')).toBe('offline');
    expect(countPins([pin({ driverId: 'a' }), pin({ driverId: 'b', state: 'over_cap' }), pin({ driverId: 'c' })])).toEqual({ free: 2, offered: 0, on_job: 0, over_cap: 1, offline_recent: 0 });
    expect(capUsePct({ owedIqd: 30_000, capIqd: 75_000 })).toBe(40);
    expect(capUsePct({ owedIqd: 90_000, capIqd: 75_000 })).toBe(100);
    expect(capUsePct({ owedIqd: 0, capIqd: 0 })).toBe(0);
  });

  it('is empty for no trips', () => {
    const live = buildLiveGeoJSON([]);
    expect(live.drivers.features).toEqual([]);
    expect(live.trips.type).toBe('FeatureCollection');
  });

  it('gives stable non-negative feature ids', () => {
    expect(featureId('abc')).toBe(featureId('abc'));
    expect(featureId('abc')).not.toBe(featureId('abd'));
    expect(featureId('x'.repeat(200))).toBeGreaterThanOrEqual(0);
  });
});
