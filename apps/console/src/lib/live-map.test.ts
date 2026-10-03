import { AZIZIYAH_BOUNDS, buildMapStyle, LAYER, MARKER_COLORS, SOURCE } from '@driver/map';
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

/** Every `['get', name]` a style expression reads. */
function readProps(expr: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(expr)) {
    if (expr[0] === 'get' && typeof expr[1] === 'string') out.add(expr[1]);
    for (const x of expr) readProps(x, out);
  } else if (expr && typeof expr === 'object') {
    for (const x of Object.values(expr)) readProps(x, out);
  }
  return out;
}

describe('live GeoJSON against the @driver/map style', () => {
  const style = buildMapStyle();
  const layersOn = (source: string) => style.layers.filter((l) => 'source' in l && l.source === source);
  const [[west, south], [east, north]] = AZIZIYAH_BOUNDS;
  const inAziziyah = ([lng, lat]: number[]) => lng! > west && lng! < east && lat! > south && lat! < north;

  // A courier half-way through pickup → drop-off, a free driver, one over cap, and an offered (red) ride.
  const t1 = trip({
    id: 't1',
    courierId: 'd1',
    state: 'in_transit',
    stops: [stop({ id: 's1', seq: 0, target: A, state: 'completed' }), stop({ id: 's2', seq: 1, type: 'dropoff', target: B })],
  });
  const t2 = trip({ id: 't2', vertical: 'taxi', state: 'offered', stops: [stop({ id: 's3', seq: 0, target: B }), stop({ id: 's4', seq: 1, type: 'dropoff', target: A })] });
  const live = buildLiveGeoJSON(
    [t1, t2],
    [card({ tripId: 't2', red: true })],
    [
      pin({ driverId: 'd1', lat: 32.921, lng: 45.071, state: 'on_job', tripId: 't1' }),
      pin({ driverId: 'd2', lat: 32.93, lng: 45.05, state: 'free' }),
      pin({ driverId: 'd3', lat: 32.9, lng: 45.065, state: 'over_cap' }),
      pin({ driverId: 'd4', lat: 32.91, lng: 45.08, state: 'offered', tripId: 't2' }),
    ],
  );

  it('fills the style’s runtime geojson sources (the setData targets)', () => {
    for (const id of [SOURCE.trips, SOURCE.stops, SOURCE.drivers]) expect(style.sources[id]?.type).toBe('geojson');
    expect(layersOn(SOURCE.drivers).map((l) => l.id)).toEqual([LAYER.driverHalo, LAYER.drivers]);
    expect(layersOn(SOURCE.trips).map((l) => l.id)).toEqual([LAYER.tripLines]);
    expect(layersOn(SOURCE.stops).map((l) => l.id)).toEqual([LAYER.tripStops]);
  });

  it('writes every coordinate as [lng, lat] inside Aziziyah', () => {
    const d1 = live.drivers.features.find((f) => f.properties.driverId === 'd1')!;
    expect(d1.geometry.coordinates).toEqual([45.071, 32.921]);
    for (const f of live.drivers.features) expect(inAziziyah(f.geometry.coordinates)).toBe(true);
    for (const f of live.stops.features) expect(inAziziyah(f.geometry.coordinates)).toBe(true);
    for (const f of live.trips.features) for (const c of f.geometry.coordinates) expect(inAziziyah(c)).toBe(true);
    expect(live.trips.features.find((f) => f.properties.tripId === 't1')!.geometry.coordinates).toEqual([
      [A.lng, A.lat],
      [B.lng, B.lat],
    ]);
  });

  it('sets every property the live layers read, with numeric ids for feature-state', () => {
    const bySource: Array<[string, Array<{ id?: string | number; properties: object }>]> = [
      [SOURCE.drivers, live.drivers.features],
      [SOURCE.trips, live.trips.features],
      [SOURCE.stops, live.stops.features],
    ];
    for (const [source, features] of bySource) {
      expect(features.length).toBeGreaterThan(0);
      const needed = new Set<string>();
      for (const layer of layersOn(source)) {
        const l = layer as { paint?: unknown; layout?: unknown; filter?: unknown };
        readProps([l.paint, l.layout, l.filter], needed);
      }
      expect(needed.size).toBeGreaterThan(0);
      for (const f of features) {
        expect(typeof f.id).toBe('number');
        for (const prop of needed) expect(f.properties).toHaveProperty(prop);
      }
    }
  });

  it('colours drivers by presence state and red trips with the over-cap red', () => {
    const colour = (id: string) => live.drivers.features.find((f) => f.properties.driverId === id)!.properties.color;
    expect(colour('d1')).toBe(MARKER_COLORS.on_job);
    expect(colour('d2')).toBe(MARKER_COLORS.free);
    expect(colour('d3')).toBe(MARKER_COLORS.over_cap);
    expect(colour('d4')).toBe(MARKER_COLORS.offered);
    const line = (id: string) => live.trips.features.find((f) => f.properties.tripId === id)!.properties;
    expect(line('t1')).toMatchObject({ color: MARKER_COLORS.on_job, red: false, state: 'in_transit' });
    expect(line('t2')).toMatchObject({ color: MARKER_COLORS.over_cap, red: true, vertical: 'taxi' });
  });

  it('draws trips as dashed lines above the zones, drivers above the trips', () => {
    const ids = style.layers.map((l) => l.id);
    const tripLayer = style.layers.find((l) => l.id === LAYER.tripLines)!;
    expect(tripLayer.type).toBe('line');
    expect((tripLayer as { paint?: Record<string, unknown> }).paint?.['line-dasharray']).toEqual([2, 1.5]);
    expect(ids.indexOf(LAYER.tripLines)).toBeGreaterThan(ids.indexOf(LAYER.zoneFill));
    expect(ids.indexOf(LAYER.drivers)).toBeGreaterThan(ids.indexOf(LAYER.tripStops));
    expect(ids.indexOf(LAYER.drivers)).toBeGreaterThan(ids.indexOf(LAYER.tripLines));
  });
});
