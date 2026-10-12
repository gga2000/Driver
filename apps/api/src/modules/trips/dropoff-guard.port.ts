import type { LatLng } from '@driver/contracts';

/**
 * طرود (2026-10-12): a parcel is handed over only with the receiver's code. Before a parcel trip's
 * drop-off is recorded, the module that owns parcels says whether it may complete (the code was
 * verified, staff released it, or this is the trip back after a refusal). Trips knows no parcels:
 * parcels binds the guard at start-up (parcels depends on trips, not the other way round). Unbound,
 * every drop-off completes as before. Read-only: it runs before anything is written.
 */
export type DropoffGuardProblem = 'parcel_pin_not_verified';

export interface DropoffGuardPort {
  /** Null when the drop-off of `orderId` may complete. Asked only for parcel trips' drop-off stops; `target` tells the receiver's door from a hand-back stop. */
  check(orderId: string, stop: { stopId: string; target: LatLng | null }): Promise<DropoffGuardProblem | null>;
}
