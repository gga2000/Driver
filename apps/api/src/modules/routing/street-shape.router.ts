import type { LatLng } from '@driver/contracts';
import { buildStreetGraph, streetPathThrough, type LngLat, type StreetGraph } from '@driver/map/pieces/street-route';
import { decodePolyline, encodePolyline } from './polyline.js';
import type { RouteResult, Router, TableResult } from './routing.port.js';
import { STREET_LINES } from './street-data.js';

/** Shapes kept per set of points (rounded to ~11 m), so a tracking screen polling every few seconds costs nothing. */
const CACHE_MAX = 2_000;

let townGraph: StreetGraph | null = null;
/** The town's street graph, built once on first use (~50 ms for Aziziyah). */
export function townStreets(): StreetGraph {
  townGraph ??= buildStreetGraph(STREET_LINES.map((s) => ({ coords: decodePolyline(s).map((p): LngLat => [p.lng, p.lat]) })));
  return townGraph;
}

/**
 * Route lines along the streets (Ali 2026-11-01): when the router underneath has no road shape (the
 * straight-line estimate: no OSRM, or OSRM down), the shape comes from our own map's streets
 * (`street-data.ts`, made by tools/map-tiles/streets.py), routed through the same points in order.
 *
 * Only the line changes. Distance, duration and basis stay the inner router's, so arrival times, the
 * late promise and prices are exactly what they were. Points off the street map, or streets that do not
 * join, keep the inner answer (the apps draw their straight line then).
 */
export class StreetShapeRouter implements Router {
  private readonly cache = new Map<string, string | null>();

  constructor(
    private readonly inner: Router,
    private readonly graph: () => StreetGraph = townStreets,
  ) {}

  table(sources: readonly LatLng[], destinations: readonly LatLng[]): Promise<TableResult> {
    return this.inner.table(sources, destinations);
  }

  async route(points: readonly LatLng[]): Promise<RouteResult> {
    const r = await this.inner.route(points);
    if (r.polyline6 || points.length < 2) return r;
    const polyline6 = this.shape(points);
    return polyline6 ? { ...r, polyline6 } : r;
  }

  private shape(points: readonly LatLng[]): string | null {
    const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      // The rounded key may stand for points a few metres off: the line still ends at these.
      return hit === null ? null : withEnds(hit, points);
    }
    const found = streetPathThrough(this.graph(), points.map((p): LngLat => [p.lng, p.lat]));
    const value = found ? encodePolyline(found.path.map(([lng, lat]) => ({ lat, lng }))) : null;
    this.cache.set(key, value);
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }
}

/** A kept shape with its first and last points moved onto these exact ends. */
function withEnds(polyline6: string, points: readonly LatLng[]): string {
  const line = decodePolyline(polyline6);
  line[0] = points[0]!;
  line[line.length - 1] = points[points.length - 1]!;
  return encodePolyline(line);
}
