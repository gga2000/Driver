import type { LatLng } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import { CLOSURE_RULES, detourCandidates, runsThrough, touches, type AvoidedClosure, type ClosureRules, type RouteClosure, type RouteClosures } from './closures.js';
import { decodePolyline, encodePolyline } from './polyline.js';
import type { RouteResult, Router, TableResult } from './routing.port.js';

/** A route kept for this long (closures change the key, so a new closure is never served stale). */
const CACHE_TTL_MS = 2 * 60_000;
const CACHE_MAX = 2_000;

/**
 * N20 «شارع مسدود»: every route goes around today's closed streets. OSRM has no way to leave out one
 * street, so when the usual route runs through a closure we ask again with one extra stop beside it (each
 * side, two distances) and keep the quickest answer that stays clear. The straight-line estimate (no
 * OSRM, or OSRM down) goes around the same way, as a bent line, so arrival times count the detour too.
 *
 * A trip that starts or ends on the closed street itself is left as it is (the door is there). `table`
 * (many-to-many durations for ranking kitchens and drivers) is not bent: one closure barely moves those.
 */
export class ClosureAwareRouter implements Router {
  private readonly cache = new Map<string, { at: number; value: RouteResult }>();

  constructor(
    private readonly inner: Router,
    private readonly closures: RouteClosures,
    private readonly clock: Clock,
    private readonly rules: ClosureRules = CLOSURE_RULES,
  ) {}

  table(sources: readonly LatLng[], destinations: readonly LatLng[]): Promise<TableResult> {
    return this.inner.table(sources, destinations);
  }

  async route(points: readonly LatLng[]): Promise<RouteResult> {
    const now = this.clock.now();
    const active = this.closures.active(now);
    if (active.length === 0 || points.length < 2) return this.inner.route(points);
    const key = `${this.closures.version}|${points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')}`;
    const hit = this.cache.get(key);
    if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.value;
    const value = await this.around(points, active);
    this.cache.set(key, { at: now.getTime(), value });
    if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }

  private async around(points: readonly LatLng[], active: readonly RouteClosure[]): Promise<RouteResult> {
    const direct = await this.inner.route(points);
    let current = { points: [...points], result: direct };
    const avoided: AvoidedClosure[] = [];
    for (let round = 0; round < this.rules.maxRounds; round++) {
      const line = this.lineOf(current.points, current.result);
      const blocking = active.find((c) => !avoided.some((a) => a.id === c.id) && !touches(points, c, this.rules) && runsThrough(line, c, this.rules));
      if (!blocking) break;
      const tries = await Promise.all(
        detourCandidates(current.points, blocking, this.rules).map(async (via) => {
          try {
            const r = await this.inner.route(via);
            return { points: via, result: r };
          } catch {
            return null;
          }
        }),
      );
      const clear = tries
        .filter((t): t is { points: LatLng[]; result: RouteResult } => t !== null)
        .filter((t) => !runsThrough(this.lineOf(t.points, t.result), blocking, this.rules))
        .sort((a, b) => a.result.durationS - b.result.durationS)[0];
      // Nothing gets around it (a dead end, the river): keep the route through it.
      if (!clear) break;
      avoided.push({ id: blocking.id, extraS: Math.max(0, Math.round(clear.result.durationS - current.result.durationS)) });
      current = clear;
    }
    if (avoided.length === 0) return direct;
    // The straight-line estimate has no road shape; the bent line through the extra stops is its shape now.
    const polyline6 = current.result.polyline6 ?? encodePolyline(current.points);
    return { ...current.result, polyline6, avoided };
  }

  private lineOf(points: readonly LatLng[], r: RouteResult): readonly LatLng[] {
    if (r.polyline6) {
      try {
        return decodePolyline(r.polyline6);
      } catch {
        return points;
      }
    }
    return points;
  }
}
