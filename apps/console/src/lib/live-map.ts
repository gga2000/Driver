import type { BoardCard, Stop, Trip, TripState } from '@driver/contracts';
import { MARKER_COLORS, type MarkerState } from '@driver/map';
import type { FeatureCollection, LineString, Point } from 'geojson';

/**
 * Turns the polled trips (+ board cards) into the three runtime GeoJSON sources of the live map.
 *
 * The API has no driver-position feed yet (`reportPosition` is write-only), so a driver's marker is
 * placed at the last stop he reached, or at the first stop while he is heading there, and flagged
 * `approx`. When a presence procedure lands, only `driverPosition` changes.
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

export interface DriverMarkerProps {
  kind: 'driver';
  driverId: string;
  tripId: string;
  state: MarkerState;
  color: string;
  approx: boolean;
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

export function buildLiveGeoJSON(trips: readonly Trip[], cards: readonly BoardCard[] = []): LiveGeoJSON {
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
    if (trip.courierId && !seenDrivers.has(trip.courierId)) {
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

  return {
    trips: { type: 'FeatureCollection', features: lines },
    stops: { type: 'FeatureCollection', features: stops },
    drivers: { type: 'FeatureCollection', features: drivers },
  };
}
