import type { DispatchConfig, DispatchPolicyKind, LatLng, VehicleClass, Vertical } from '@driver/contracts';

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
  /** 0..1: 1 preferred vehicle for the vertical, 0.5 acceptable (see vehicles.ts). Absent = 1. */
  vehicleFit?: number;
  /** Minutes idle in the current zone; feeds the anti-camping decay (review J112). Absent = 0. */
  minutesInZone?: number;
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
  /** Step 5 orchestrator inputs (all optional so the pure `plan()` keeps working without them). */
  pickup?: LatLng;
  dropoffZoneId?: string;
  /** auto_assign: when the merchant says the order is ready. */
  readyAt?: Date;
  /** auto_assign: hot food never waits more than `batchMaxHotWaitMin` from ready. */
  hot?: boolean;
  /** Smallest vehicle that may carry the job (the order cap, review A.16); smaller vehicles are never offered it. */
  minVehicleClass?: VehicleClass | null;
  /** Cash the driver will collect for others (a cash order's total): checked against his cap room. 0 = prepaid. */
  cashIqd?: number;
  /** scheduled: the departure checked for low fill at T−30. */
  departureId?: string;
  /** pre_assigned: vetted substitutes whose stops match the route (caller-filtered). */
  eligibleDriverIds?: string[];
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
