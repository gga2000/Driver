import type { LatLng } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { RouteResult, Router, TableResult } from './routing.port.js';

/** Resilience settings for the OSRM client (maps program SP4b). */
export const ROUTING_RULES = {
  /** Coordinates are rounded to this many decimals for the cache key (4 ≈ 11 m). */
  cacheDecimals: 4,
  /** Roads don't change by the minute; traffic is not modelled yet. */
  cacheTtlMs: 10 * 60_000,
  cacheMax: 5_000,
  /** This many failures inside `breakerWindowMs` open the breaker for `breakerOpenMs`. */
  breakerFailures: 5,
  breakerWindowMs: 30_000,
  breakerOpenMs: 60_000,
} as const;

type Rules = typeof ROUTING_RULES;

/**
 * OSRM with a safety net: answers are cached on rounded coordinates, failures fall back to the
 * straight-line router (basis `estimated`), and repeated failures open a breaker so a sick OSRM is not
 * asked again for a minute. Never throws for routing reasons.
 */
export class ResilientRouter implements Router {
  private readonly cache = new Map<string, { at: number; value: RouteResult | TableResult }>();
  private failures: number[] = [];
  private openUntil = 0;

  constructor(
    private readonly primary: Router,
    private readonly fallback: Router,
    private readonly clock: Clock,
    private readonly rules: Rules = ROUTING_RULES,
  ) {}

  route(points: readonly LatLng[]): Promise<RouteResult> {
    return this.cached(`r|${this.key(points)}`, () => this.primary.route(points), () => this.fallback.route(points));
  }

  table(sources: readonly LatLng[], destinations: readonly LatLng[]): Promise<TableResult> {
    return this.cached(`t|${this.key(sources)}|${this.key(destinations)}`, () => this.primary.table(sources, destinations), () => this.fallback.table(sources, destinations));
  }

  /** True while the breaker keeps OSRM out (health and logs). */
  get open(): boolean {
    return this.clock.now().getTime() < this.openUntil;
  }

  private key(points: readonly LatLng[]): string {
    const d = this.rules.cacheDecimals;
    return points.map((p) => `${p.lat.toFixed(d)},${p.lng.toFixed(d)}`).join(';');
  }

  private async cached<T extends RouteResult | TableResult>(key: string, primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    const now = this.clock.now().getTime();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < this.rules.cacheTtlMs) return hit.value as T;
    if (now < this.openUntil) return fallback();
    try {
      const value = await primary();
      this.cache.delete(key);
      this.cache.set(key, { at: now, value });
      if (this.cache.size > this.rules.cacheMax) this.cache.delete(this.cache.keys().next().value as string);
      return value;
    } catch {
      // OSRM down, slow or without a route: count it, and answer with the straight-line estimate.
      this.failures = [...this.failures.filter((t) => now - t < this.rules.breakerWindowMs), now];
      if (this.failures.length >= this.rules.breakerFailures) {
        this.openUntil = now + this.rules.breakerOpenMs;
        this.failures = [];
      }
      return fallback();
    }
  }
}
