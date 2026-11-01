import type { LatLng } from '@driver/contracts';
import { buildStreetGraph, streetPathThrough, type LngLat, type StreetGraph } from '@driver/map/pieces/street-route';
import { decodePolyline, encodePolyline } from './polyline.js';
import type { RouteResult } from './routing.port.js';
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
 * Route lines along the streets (Ali 2026-11-01): the shape of a route for the map, along our own map's
 * streets (`street-data.ts`, made by tools/map-tiles/streets.py), through the same points in order.
 * Used only where a line is drawn (`EtaService.path`), never for minutes: arrival times, the late
 * promise, closures' detours and prices never come from here. Points off the street map, or streets
 * that do not join, give null (the apps draw their straight line then).
 */
export class StreetShapes {
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly graph: () => StreetGraph = townStreets) {}

  /**
   * The route with its line along the streets when the router had no road shape of its own (the
   * straight-line estimate, or its bent line around a closure, whose bends are kept as stops).
   * Distance, duration, basis and the closures it avoided stay exactly the router's.
   */
  along(r: RouteResult, points: readonly LatLng[]): RouteResult {
    if (r.basis !== 'estimated') return r;
    let through: readonly LatLng[] = points;
    if (r.polyline6) {
      try {
        through = decodePolyline(r.polyline6);
      } catch {
        return r;
      }
    }
    const polyline6 = this.shape(through);
    return polyline6 ? { ...r, polyline6 } : r;
  }

  /** The street line through `points` in order, polyline6; null when any leg has no street path. */
  shape(points: readonly LatLng[]): string | null {
    if (points.length < 2) return null;
    const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');
    let hit = this.cache.get(key);
    if (hit === undefined) {
      const found = streetPathThrough(this.graph(), points.map((p): LngLat => [p.lng, p.lat]));
      hit = found ? encodePolyline(found.path.map(([lng, lat]) => ({ lat, lng }))) : null;
      this.cache.set(key, hit);
      if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    }
    if (hit === null) return null;
    // The rounded key may stand for points a few metres off: the line still starts and ends at these.
    const line = decodePolyline(hit);
    line[0] = points[0]!;
    line[line.length - 1] = points[points.length - 1]!;
    return encodePolyline(line);
  }
}

/** The one set of street shapes the API keeps (the graph is built once, on the first line drawn). */
export const TOWN_SHAPES = new StreetShapes();
