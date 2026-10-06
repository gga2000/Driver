import { Inject, Injectable, Optional } from '@nestjs/common';
import { ROUTE_VEHICLE_FACTOR, type EtaBasis, type LatLng, type VehicleClass } from '@driver/contracts';
import { ETA_CORRECTION, NO_ETA_CORRECTION, type EtaCorrection } from './eta-correction.port.js';
import { ROUTER, type RouteResult, type Router } from './routing.port.js';

export interface EtaMinutes {
  /** Whole minutes, at least one. */
  minutes: number;
  basis: EtaBasis;
}

/** The router's own estimate for a leg, before any learned correction. */
export interface BaseEtaMinutes extends EtaMinutes {
  /** Unrounded minutes (vehicle factor applied): what a finished leg's actual time is compared with. */
  exactMinutes: number;
}

const exactMinutes = (durationS: number, vehicle: VehicleClass): number => (durationS * ROUTE_VEHICLE_FACTOR[vehicle]) / 60;
const wholeMinutes = (exact: number): number => Math.max(1, Math.round(exact));

/**
 * One ETA everywhere (maps program SP4b, f7): every arrival time the customer, the restaurant and the
 * share link see comes from here — routed on real roads when OSRM is configured, the shared straight-line
 * estimate otherwise — times what finished legs taught about that zone pair at this hour (`EtaCorrection`).
 * The basis label stays the router's: a corrected straight line is still `estimated`.
 */
@Injectable()
export class EtaService {
  private readonly correction: EtaCorrection;

  constructor(@Inject(ROUTER) private readonly router: Router, @Optional() @Inject(ETA_CORRECTION) correction?: EtaCorrection) {
    this.correction = correction ?? NO_ETA_CORRECTION;
  }

  /** Minutes for `vehicle` from `from` to `to`, corrected by what this leg's streets taught. */
  async minutes(from: LatLng, to: LatLng, vehicle: VehicleClass): Promise<EtaMinutes> {
    const base = await this.baseMinutes(from, to, vehicle);
    const factor = await this.correction.factor({ from, to, vehicle, basis: base.basis });
    return { minutes: wholeMinutes(base.exactMinutes * factor), basis: base.basis };
  }

  /**
   * The router's minutes with no learned correction. For promises already made (the honest-delay
   * promise is recomputed on every read, so it must not move as the city learns or the hour changes)
   * and for learning itself (a leg is judged against the uncorrected estimate).
   */
  async baseMinutes(from: LatLng, to: LatLng, vehicle: VehicleClass): Promise<BaseEtaMinutes> {
    const r = await this.router.route([from, to]);
    const exact = exactMinutes(r.durationS, vehicle);
    return { minutes: wholeMinutes(exact), exactMinutes: exact, basis: r.basis };
  }

  /** The road through `points` (two or more): its shape for the map, its length and duration (uncorrected). */
  path(points: readonly LatLng[]): Promise<RouteResult> {
    return this.router.route(points);
  }

  /** Minutes from each source to one destination (one `table` call): storefront cards, many kitchens to one door. */
  async fromMany(sources: readonly LatLng[], to: LatLng, vehicle: VehicleClass): Promise<Array<EtaMinutes | null>> {
    if (sources.length === 0) return [];
    const t = await this.router.table(sources, [to]);
    return Promise.all(
      t.durationsS.map(async (row, i) => {
        const s = row[0];
        const from = sources[i];
        if (s === null || s === undefined || from === undefined) return null;
        const factor = await this.correction.factor({ from, to, vehicle, basis: t.basis });
        return { minutes: wholeMinutes(exactMinutes(s, vehicle) * factor), basis: t.basis };
      }),
    );
  }
}
