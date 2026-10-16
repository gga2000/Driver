import type { BoardCard, DriverPin, DriverPinState, Stop, Trip, TripState, VehicleClass, Vertical } from '@driver/contracts';
import { MARKER_COLORS, MARKER_STATES, type MarkerState } from '@driver/map';
import { columnOf } from './board';
import { pickupOf, vehicleFit, waitTone, type WaitTone } from './dispatch';
import type { FeatureCollection, LineString, Point } from 'geojson';

/**
 * The drag payload of a queue card (dispatch): drop it on a driver marker to pick that driver. Lives
 * here, not in the map canvas, so the queue can use it without pulling MapLibre into the first load.
 */
export const TRIP_DRAG_TYPE = 'application/x-driver-trip';

/**
 * Turns the polled trips, board cards and live driver pins into the three runtime GeoJSON sources
 * of the live map.
 *
 * Driver markers come from `dispatch.drivers` (presence: real positions and states). Only when that
 * feed is unavailable (no data yet, or the call failed) are drivers placed at the last stop they
 * reached, flagged `approx`.
 */

const OFFER_TRIP_STATES: ReadonlySet<TripState> = new Set(['created', 'offered', 'declined', 'timed_out']);
const WORKING_TRIP_STATES: ReadonlySet<TripState> = new Set(['accepted', 'en_route_to_pickup', 'arrived_pickup', 'in_transit', 'arrived_dropoff']);

export function markerStateForTrip(state: TripState): MarkerState {
  if (WORKING_TRIP_STATES.has(state)) return 'on_job';
  if (OFFER_TRIP_STATES.has(state)) return 'offered';
  return 'offline';
}

type Pin = { lat: number; lng: number };
const stopsWithPins = (trip: Trip) => [...trip.stops].sort((a, b) => a.seq - b.seq).filter((s): s is Stop & { target: Pin } => s.target !== null);

/** Best-known driver position for a trip: last reached stop, else the first stop. */
export function driverPosition(trip: Trip): Pin | null {
  const stops = stopsWithPins(trip);
  if (stops.length === 0) return null;
  const reached = stops.filter((s) => s.arrivedAt !== null || s.completedAt !== null || s.state === 'arrived' || s.state === 'completed');
  return (reached.at(-1) ?? stops[0]!).target;
}

/** The stop the driver is working towards (first pending), or null when all are done. */
export function nextStop(trip: Trip): Stop | null {
  return [...trip.stops].sort((a, b) => a.seq - b.seq).find((s) => s.state === 'pending' || s.state === 'arrived') ?? null;
}

/** Presence state → marker colour bucket (recently offline shares the offline grey). */
export function markerStateForPin(state: DriverPinState): MarkerState {
  return state === 'offline_recent' ? 'offline' : state;
}

export interface DriverMarkerProps {
  kind: 'driver';
  driverId: string;
  /** The trip he is on or offered; '' when free. */
  tripId: string;
  state: MarkerState;
  color: string;
  approx: boolean;
  /** From presence; null for approximate markers. */
  vehicle?: VehicleClass | null;
  /** Degrees from north (maps program o1); null when unknown. */
  heading?: number | null;
  /** His last fix (ms); the pin fades after `FLEET_RULES.quietMs`. */
  seenAt?: number | null;
}

export interface TripLineProps {
  kind: 'trip';
  tripId: string;
  state: TripState;
  vertical: string;
  color: string;
  red: boolean;
}

export interface TripStopProps {
  kind: 'stop';
  tripId: string;
  stopId: string;
  type: Stop['type'];
  seq: number;
  color: string;
}

export interface LiveGeoJSON {
  trips: FeatureCollection<LineString, TripLineProps>;
  stops: FeatureCollection<Point, TripStopProps>;
  drivers: FeatureCollection<Point, DriverMarkerProps>;
}

/** Stable numeric feature id from a string id (MapLibre feature-state needs numbers or numeric strings). */
export function featureId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * `pins` null/undefined = the presence feed is unavailable: fall back to approximate markers.
 * An empty array is real data (nobody online) and draws no driver.
 */
export function buildLiveGeoJSON(trips: readonly Trip[], cards: readonly BoardCard[] = [], pins?: readonly DriverPin[] | null): LiveGeoJSON {
  const redTrips = new Set(cards.filter((c) => c.red).map((c) => c.tripId));
  const lines: LiveGeoJSON['trips']['features'] = [];
  const stops: LiveGeoJSON['stops']['features'] = [];
  const drivers: LiveGeoJSON['drivers']['features'] = [];
  const seenDrivers = new Set<string>();

  for (const trip of trips) {
    const state = markerStateForTrip(trip.state);
    const red = redTrips.has(trip.id);
    const color = red ? MARKER_COLORS.over_cap : MARKER_COLORS[state];
    const pinned = stopsWithPins(trip);
    if (pinned.length >= 2) {
      lines.push({
        type: 'Feature',
        id: featureId(trip.id),
        geometry: { type: 'LineString', coordinates: pinned.map((s) => [s.target.lng, s.target.lat]) },
        properties: { kind: 'trip', tripId: trip.id, state: trip.state, vertical: trip.vertical, color, red },
      });
    }
    for (const s of pinned) {
      stops.push({
        type: 'Feature',
        id: featureId(s.id),
        geometry: { type: 'Point', coordinates: [s.target.lng, s.target.lat] },
        properties: { kind: 'stop', tripId: trip.id, stopId: s.id, type: s.type, seq: s.seq, color },
      });
    }
    if (!pins && trip.courierId && !seenDrivers.has(trip.courierId)) {
      const pos = driverPosition(trip);
      if (pos) {
        seenDrivers.add(trip.courierId);
        drivers.push({
          type: 'Feature',
          id: featureId(trip.courierId),
          geometry: { type: 'Point', coordinates: [pos.lng, pos.lat] },
          properties: { kind: 'driver', driverId: trip.courierId, tripId: trip.id, state, color: MARKER_COLORS[state], approx: true },
        });
      }
    }
  }

  for (const pin of pins ?? []) {
    const state = markerStateForPin(pin.state);
    drivers.push({
      type: 'Feature',
      id: featureId(pin.driverId),
      geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
      properties: { kind: 'driver', driverId: pin.driverId, tripId: pin.tripId ?? '', state, color: MARKER_COLORS[state], approx: false, vehicle: pin.vehicleClass, heading: pin.heading, seenAt: pin.lastSeenAt.getTime() },
    });
  }

  return {
    trips: { type: 'FeatureCollection', features: lines },
    stops: { type: 'FeatureCollection', features: stops },
    drivers: { type: 'FeatureCollection', features: drivers },
  };
}

/** Share of the cash cap used, 0–100 (over cap clamps to 100). */
export function capUsePct(pin: Pick<DriverPin, 'owedIqd' | 'capIqd'>): number {
  if (pin.capIqd <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((pin.owedIqd / pin.capIqd) * 100)));
}

// ───────────────────────── filters (map page) ─────────────────────────

export interface MapFilter {
  /** Empty = every vertical. */
  verticals: ReadonlySet<Vertical>;
  /** Empty = every state. */
  states: ReadonlySet<MarkerState>;
}

export const NO_FILTER: MapFilter = { verticals: new Set(), states: new Set() };

/**
 * Applies the map filters. A vertical keeps its trips and stops, the drivers on those trips, and the
 * drivers without a trip whose vehicle could take that kind of job (a free bike stays for food, not
 * for taxi). A state keeps the drivers in it; routes stay unless a vertical hides them.
 */
export function filterLive(live: LiveGeoJSON, f: MapFilter): LiveGeoJSON {
  if (f.verticals.size === 0 && f.states.size === 0) return live;
  const tripVertical = new Map(live.trips.features.map((x) => [x.properties.tripId, x.properties.vertical as Vertical]));
  const keepTrip = (tripId: string) => f.verticals.size === 0 || f.verticals.has(tripVertical.get(tripId) as Vertical);
  const keepDriver = (p: DriverMarkerProps) => {
    if (f.states.size > 0 && !f.states.has(p.state)) return false;
    if (f.verticals.size === 0) return true;
    const v = p.tripId ? tripVertical.get(p.tripId) : undefined;
    if (v) return f.verticals.has(v);
    return !p.vehicle || [...f.verticals].some((vert) => vehicleFit(vert, p.vehicle!) > 0);
  };
  return {
    trips: { type: 'FeatureCollection', features: live.trips.features.filter((x) => keepTrip(x.properties.tripId)) },
    stops: { type: 'FeatureCollection', features: live.stops.features.filter((x) => keepTrip(x.properties.tripId) || !tripVertical.has(x.properties.tripId)) },
    drivers: { type: 'FeatureCollection', features: live.drivers.features.filter((x) => keepDriver(x.properties)) },
  };
}

/** Driver markers per state (after the vertical filter), for the state chips. */
export function countMarkers(live: LiveGeoJSON): Record<MarkerState, number> {
  const out = Object.fromEntries(MARKER_STATES.map((s) => [s, 0])) as Record<MarkerState, number>;
  for (const d of live.drivers.features) out[d.properties.state] += 1;
  return out;
}

// ───────────────────────── order tags (waiting orders at their pickup) ─────────────────────────

export interface OrderTag {
  /** Stable key of the pickup spot. */
  key: string;
  /** Waiting trips at this spot, most urgent first; the first one is selected on click. */
  tripIds: string[];
  lng: number;
  lat: number;
  tone: WaitTone;
}

const TONE_RANK: Record<WaitTone, number> = { bad: 0, warn: 1, neutral: 2 };

/**
 * Cards still without a driver, pinned at their pickup (the restaurant). Orders waiting at the same
 * spot share one tag ("#2009 +3"), so a busy kitchen doesn't stack ten tags on top of each other.
 */
export function orderTags(cards: readonly BoardCard[], trips: ReadonlyMap<string, Trip>, tick = 0): OrderTag[] {
  const groups = new Map<string, OrderTag & { worst: number; oldest: number }>();
  const waiting = cards.filter((c) => {
    const col = columnOf(c);
    return col !== null && col !== 'assigned';
  });
  for (const c of waiting) {
    const at = pickupOf(trips.get(c.tripId));
    if (!at) continue;
    const key = `${at.lat.toFixed(4)},${at.lng.toFixed(4)}`;
    const tone = waitTone(c, c.elapsedSec + tick);
    const g = groups.get(key);
    const rank = TONE_RANK[tone] * 1e7 - c.elapsedSec;
    if (!g) {
      groups.set(key, { key, tripIds: [c.tripId], lng: at.lng, lat: at.lat, tone, worst: rank, oldest: c.elapsedSec });
      continue;
    }
    g.tripIds.push(c.tripId);
    if (TONE_RANK[tone] < TONE_RANK[g.tone]) g.tone = tone;
    if (rank < g.worst) {
      g.worst = rank;
      g.tripIds = [c.tripId, ...g.tripIds.filter((id) => id !== c.tripId)];
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.worst - b.worst)
    .map(({ key, tripIds, lng, lat, tone }) => ({ key, tripIds, lng, lat, tone }));
}

/** Counts per presence state, for the map legend. */
export function countPins(pins: readonly DriverPin[]): Record<DriverPinState, number> {
  const out: Record<DriverPinState, number> = { free: 0, offered: 0, on_job: 0, over_cap: 0, offline_recent: 0 };
  for (const p of pins) out[p.state] += 1;
  return out;
}
