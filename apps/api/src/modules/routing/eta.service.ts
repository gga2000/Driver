import { Inject, Injectable } from '@nestjs/common';
import { ROUTE_VEHICLE_FACTOR, type EtaBasis, type LatLng, type VehicleClass } from '@driver/contracts';
import { ROUTER, type RouteResult, type Router } from './routing.port.js';

export interface EtaMinutes {
  /** Whole minutes, at least one. */
  minutes: number;
  basis: EtaBasis;
}

const toMinutes = (durationS: number, vehicle: VehicleClass): number => Math.max(1, Math.round((durationS * ROUTE_VEHICLE_FACTOR[vehicle]) / 60));

/**
 * One ETA everywhere (maps program SP4b, f7): every arrival time the customer, the restaurant and the
 * share link see comes from here — routed on real roads when OSRM is configured, the shared straight-line
 * estimate otherwise.
 */
@Injectable()
export class EtaService {
  constructor(@Inject(ROUTER) private readonly router: Router) {}

  /** Minutes for `vehicle` from `from` to `to`. */
  async minutes(from: LatLng, to: LatLng, vehicle: VehicleClass): Promise<EtaMinutes> {
    const r = await this.router.route([from, to]);
    return { minutes: toMinutes(r.durationS, vehicle), basis: r.basis };
  }

  /** The road through `points` (two or more): its shape for the map, its length and duration. */
  path(points: readonly LatLng[]): Promise<RouteResult> {
    return this.router.route(points);
  }

  /** Minutes from each source to one destination (one `table` call): storefront cards, many kitchens to one door. */
  async fromMany(sources: readonly LatLng[], to: LatLng, vehicle: VehicleClass): Promise<Array<EtaMinutes | null>> {
    if (sources.length === 0) return [];
    const t = await this.router.table(sources, [to]);
    return t.durationsS.map((row) => {
      const s = row[0];
      return s === null || s === undefined ? null : { minutes: toMinutes(s, vehicle), basis: t.basis };
    });
  }
}
