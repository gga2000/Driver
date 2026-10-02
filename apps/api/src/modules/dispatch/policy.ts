import type { DispatchConfig, DispatchPolicyKind, Vertical } from '@driver/contracts';

/** A driver candidate as seen by dispatch: position, current load and scoring tier. */
export interface DriverCandidate {
  driverId: string;
  distanceKm: number;
  /** Trips currently assigned (0 = idle). */
  activeTrips: number;
  tier: 'bronze' | 'silver' | 'gold';
  /** Pre-assigned policy: the driver fixed on the route. */
  routeDriverId?: string;
  /** Vetted for substitute auctions on خطوط. */
  vetted?: boolean;
}

export interface DispatchJob {
  tripId: string;
  cityId: string;
  vertical: Vertical;
  zoneId: string;
  /** For scheduled/pre_assigned policies. */
  routeId?: string;
  routeDriverId?: string;
  departureAt?: Date;
}

export interface Wave {
  index: number;
  driverIds: string[];
  /** Seconds this wave stays open before the next one opens. */
  seconds: number;
}

export type DispatchPlan =
  | { kind: 'broadcast'; waves: Wave[]; acceptTimeoutSec: number }
  | { kind: 'assign'; driverId: string; batchWith: string[]; acceptTimeoutSec: number }
  | { kind: 'schedule'; routeId: string; departureAt: Date; needsOpsConfirmation: true }
  | { kind: 'pre_assigned'; driverId: string; acceptTimeoutSec: number }
  | { kind: 'substitute_auction'; driverIds: string[]; acceptTimeoutSec: number }
  | { kind: 'no_drivers' }
  /** "Suggest only" mode: every decision is routed to the console. */
  | { kind: 'suggest'; suggestion: DispatchPlan };

export interface Policy {
  readonly kind: DispatchPolicyKind;
  plan(job: DispatchJob, ranked: DriverCandidate[], config: DispatchConfig): DispatchPlan;
}
