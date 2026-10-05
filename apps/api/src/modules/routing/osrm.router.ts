import { z } from 'zod';
import type { LatLng } from '@driver/contracts';
import { RoutingUnavailable, type RouteResult, type Router, type TableResult } from './routing.port.js';

/** OSRM answers a city-sized route in milliseconds; past this the straight line is the better answer. */
export const OSRM_DEFAULT_TIMEOUT_MS = 1_500;

export type OsrmFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

const RouteResponse = z.object({
  code: z.string(),
  routes: z.array(z.object({ distance: z.number(), duration: z.number(), geometry: z.string() })).optional(),
});
const TableResponse = z.object({
  code: z.string(),
  durations: z.array(z.array(z.number().nullable())).optional(),
  distances: z.array(z.array(z.number().nullable())).optional(),
});

/** OSRM's coordinate list: `lng,lat;lng,lat` with 6 decimals (≈ 0.1 m). */
function coords(points: readonly LatLng[]): string {
  return points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
}

/**
 * OSRM's HTTP API (`osrm-routed`, MLD, car profile; deploy/fly/osrm.toml). `route` for a path through
 * points, `table` for many-to-many durations. Any non-`Ok` answer, HTTP error or timeout throws
 * `RoutingUnavailable` — `ResilientRouter` turns that into the straight-line estimate.
 */
export class OsrmRouter implements Router {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = OSRM_DEFAULT_TIMEOUT_MS,
    private readonly fetchImpl: OsrmFetch = (url, init) => fetch(url, init),
  ) {}

  async route(points: readonly LatLng[]): Promise<RouteResult> {
    if (points.length < 2) throw new RoutingUnavailable('a route needs two points');
    const body = RouteResponse.parse(await this.get(`/route/v1/driving/${coords(points)}?overview=full&geometries=polyline6&steps=false`));
    const r = body.routes?.[0];
    if (body.code !== 'Ok' || !r) throw new RoutingUnavailable(`route: ${body.code}`);
    return { distanceM: r.distance, durationS: r.duration, polyline6: r.geometry, basis: 'road' };
  }

  async table(sources: readonly LatLng[], destinations: readonly LatLng[]): Promise<TableResult> {
    const all = [...sources, ...destinations];
    const src = sources.map((_, i) => i).join(';');
    const dst = destinations.map((_, i) => sources.length + i).join(';');
    const body = TableResponse.parse(await this.get(`/table/v1/driving/${coords(all)}?sources=${src}&destinations=${dst}&annotations=duration,distance`));
    if (body.code !== 'Ok' || !body.durations || !body.distances) throw new RoutingUnavailable(`table: ${body.code}`);
    return { durationsS: body.durations, distancesM: body.distances, basis: 'road' };
  }

  private async get(path: string): Promise<unknown> {
    let res: { status: number; json(): Promise<unknown> };
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new RoutingUnavailable((err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message);
    }
    // OSRM answers 400 with a JSON `code` (NoRoute, InvalidQuery…); anything else is the server failing.
    if (res.status !== 200 && res.status !== 400) throw new RoutingUnavailable(`http ${res.status}`);
    return res.json();
  }
}
