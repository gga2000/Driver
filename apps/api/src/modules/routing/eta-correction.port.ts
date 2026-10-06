import type { EtaBasis, LatLng, VehicleClass } from '@driver/contracts';

/** One leg the ETA is about to quote: where from and to, on what, and how the router estimated it. */
export interface EtaLegQuery {
  from: LatLng;
  to: LatLng;
  vehicle: VehicleClass;
  basis: EtaBasis;
}

/**
 * The learned correction the one ETA multiplies a leg by (maps program f7, spec §5.4). A narrow port so
 * the routing module, which nearly every module imports, depends on nothing: the `eta` module binds the
 * learned implementation app-wide, and anything built without it (unit tests, a bare `new EtaService`)
 * gets `NO_ETA_CORRECTION`, the router's own minutes.
 */
export interface EtaCorrection {
  /** The multiplier for this leg, already clamped; 1 when nothing trustworthy has been learned. */
  factor(leg: EtaLegQuery): Promise<number>;
}

export const ETA_CORRECTION = Symbol('ETA_CORRECTION');

/** Nothing learned: every leg at the router's estimate. */
export const NO_ETA_CORRECTION: EtaCorrection = { factor: async () => 1 };
