import { haversineM, ROAD_FACTOR, TOWN_SPEED_KMH, type LatLng } from '@driver/contracts';
import type { RouteResult, Router, TableResult } from './routing.port.js';

/** Straight line × road factor at car speed: the shared estimate when OSRM is absent or failing. */
function leg(a: LatLng, b: LatLng): { distanceM: number; durationS: number } {
  const distanceM = haversineM(a, b) * ROAD_FACTOR;
  return { distanceM, durationS: distanceM / ((TOWN_SPEED_KMH.car * 1000) / 3600) };
}

/**
 * The fallback router (and the only one without `OSRM_URL`): the same straight-line × 1.4 formula
 * `travelMinutes` uses, so every app agrees when there is no road data. Always basis `estimated`.
 */
export class StraightLineRouter implements Router {
  async route(points: readonly LatLng[]): Promise<RouteResult> {
    let distanceM = 0;
    let durationS = 0;
    for (let i = 1; i < points.length; i++) {
      const l = leg(points[i - 1]!, points[i]!);
      distanceM += l.distanceM;
      durationS += l.durationS;
    }
    return { distanceM, durationS, polyline6: null, basis: 'estimated' };
  }

  async table(sources: readonly LatLng[], destinations: readonly LatLng[]): Promise<TableResult> {
    const legs = sources.map((s) => destinations.map((d) => leg(s, d)));
    return { durationsS: legs.map((r) => r.map((l) => l.durationS)), distancesM: legs.map((r) => r.map((l) => l.distanceM)), basis: 'estimated' };
  }
}
