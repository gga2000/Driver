import { MARKER_COLORS } from '@driver/map';
import { describe, expect, it } from 'vitest';
import { card, stop, trip } from './fixtures';
import { buildLiveGeoJSON, driverPosition, featureId, markerStateForTrip, nextStop } from './live-map';

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
