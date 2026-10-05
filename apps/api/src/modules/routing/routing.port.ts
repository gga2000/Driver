import type { EtaBasis, LatLng } from '@driver/contracts';

/** A routed path through two or more points. */
export interface RouteResult {
  distanceM: number;
  durationS: number;
  /** Encoded polyline (precision 6) of the road geometry; null for the straight-line estimate. */
  polyline6: string | null;
  basis: EtaBasis;
}

/** Durations and distances from every source to every destination; null where no road connects them. */
export interface TableResult {
  durationsS: Array<Array<number | null>>;
  distancesM: Array<Array<number | null>>;
  basis: EtaBasis;
}

/**
 * Road routing (maps program SP4b, decision D3: our own OSRM). One car profile; vehicles differ by
 * `ROUTE_VEHICLE_FACTOR` in `EtaService`.
 */
export interface Router {
  route(points: readonly LatLng[]): Promise<RouteResult>;
  table(sources: readonly LatLng[], destinations: readonly LatLng[]): Promise<TableResult>;
}

/** The router could not answer (down, slow, no route): callers fall back to the straight-line estimate. */
export class RoutingUnavailable extends Error {
  constructor(reason: string) {
    super(`routing unavailable: ${reason}`);
    this.name = 'RoutingUnavailable';
  }
}

export const ROUTER = Symbol('ROUTER');
