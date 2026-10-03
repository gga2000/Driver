import { z } from 'zod';
import { CityId, Iqd, LatLng, Vertical } from './common.js';
import type { Actor } from './identity-io.js';

/**
 * Trip machine (domain §2). `declined`/`timed_out` return to `offered` on the next offer; the
 * cancelled/failed/completed states are terminal. Mirrors the Prisma `TripState` enum.
 */
export const TripState = z.enum([
  'created',
  'offered',
  'accepted',
  'en_route_to_pickup',
  'arrived_pickup',
  'in_transit',
  'arrived_dropoff',
  'completed',
  'declined',
  'timed_out',
  'driver_cancelled',
  'customer_cancelled',
  'platform_cancelled',
  'failed',
]);
export type TripState = z.infer<typeof TripState>;

/** States in which a driver is working the trip (assigned, not finished). */
export const ACTIVE_TRIP_STATES: readonly TripState[] = [
  'accepted',
  'en_route_to_pickup',
  'arrived_pickup',
  'in_transit',
  'arrived_dropoff',
];

/** States from which nothing moves. */
export const TERMINAL_TRIP_STATES: readonly TripState[] = [
  'completed',
  'driver_cancelled',
  'customer_cancelled',
  'platform_cancelled',
  'failed',
];

export const StopType = z.enum(['pickup', 'dropoff', 'wait', 'shop']);
export type StopType = z.infer<typeof StopType>;

export const StopState = z.enum(['pending', 'arrived', 'completed', 'skipped']);
export type StopState = z.infer<typeof StopState>;

/** Mirrors the Prisma `VehicleClass` enum. Order caps per class: edge-case review A.16. */
export const VehicleClass = z.enum(['bike', 'tuktuk', 'car', 'suv', 'van', 'intercity']);
export type VehicleClass = z.infer<typeof VehicleClass>;

/** What the courier hands over at a stop: photo, PIN, cash, khat child tap (edge-case §5). */
export const HandoverProof = z.object({
  photoUrl: z.string().url().optional(),
  pinOk: z.boolean().optional(),
  /** Cash taken from the customer at this stop (cash orders). Feeds the merchant cash account (edge-case §3). */
  cashCollectedIqd: Iqd.min(0).optional(),
  /** خطوط: the named child tapped in (pickup) or out (dropoff). Required on khat stops that carry a child. */
  childTap: z.enum(['in', 'out']).optional(),
  recipientConfirmed: z.boolean().optional(),
  note: z.string().max(500).optional(),
});
export type HandoverProof = z.infer<typeof HandoverProof>;

export const Stop = z.object({
  id: z.string(),
  tripId: z.string(),
  seq: z.number().int().min(0),
  orderId: z.string().nullable(),
  type: StopType,
  state: StopState,
  placeId: z.string().nullable(),
  meetingPointId: z.string().nullable(),
  zoneKey: z.string(),
  /** Where the stop is; the 60 m arrival geofence is drawn around it. */
  target: LatLng.nullable(),
  windowStart: z.coerce.date().nullable(),
  windowEnd: z.coerce.date().nullable(),
  geofenceEnteredAt: z.coerce.date().nullable(),
  /** Server receipt time of the driver's arrival tap (evidence, edge-case §10). */
  arrivedAt: z.coerce.date().nullable(),
  arrivedOutsideGeofence: z.boolean(),
  arrivalDistanceM: z.number().int().nullable(),
  completedAt: z.coerce.date().nullable(),
  skippedAt: z.coerce.date().nullable(),
  skipReason: z.string().nullable(),
  handoverProof: z.record(z.string(), z.unknown()),
  /** خطوط: the child's opaque vault ref (M2 review follow-up); the name only via `trips.runSheet` / identity. */
  childRef: z.string().nullable(),
  childTapInAt: z.coerce.date().nullable(),
  childTapOutAt: z.coerce.date().nullable(),
});
export type Stop = z.infer<typeof Stop>;

/** One attach/detach of an order to a trip (TripOrder history). */
export const TripOrderLink = z.object({
  orderId: z.string(),
  attachedAt: z.coerce.date(),
  detachedAt: z.coerce.date().nullable(),
  reason: z.string().nullable(),
  minVehicleClass: VehicleClass.nullable(),
});
export type TripOrderLink = z.infer<typeof TripOrderLink>;

/** Unreachable-customer protocol status (domain §2): dispatcher at 3:00, "فشل" at 5:00. */
export const UnreachableStatus = z.object({
  stopId: z.string().nullable(),
  startedAt: z.coerce.date(),
  escalatedAt: z.coerce.date().nullable(),
  escalateAt: z.coerce.date(),
  failAllowedAt: z.coerce.date(),
});
export type UnreachableStatus = z.infer<typeof UnreachableStatus>;

export const Trip = z.object({
  id: z.string(),
  cityId: CityId,
  vertical: Vertical,
  state: TripState,
  courierId: z.string().nullable(),
  vehicleId: z.string().nullable(),
  quoteId: z.string().nullable(),
  batchId: z.string().nullable(),
  offeredAt: z.coerce.date().nullable(),
  acceptedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  cancelledAt: z.coerce.date().nullable(),
  cancellationReason: z.string().nullable(),
  unreachable: UnreachableStatus.nullable(),
  stops: z.array(Stop),
  /** Full attach/detach history; `detachedAt: null` rows are the orders currently on the trip. */
  orders: z.array(TripOrderLink),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Trip = z.infer<typeof Trip>;

// ───────────────────────── procedure I/O ─────────────────────────

export const TripIdInput = z.object({ tripId: z.string().min(1) });

/** Device-side evidence carried by driver taps (edge-case §10): wall time + monotonic uptime + retry key. */
const DeviceStamp = {
  occurredAt: z.coerce.date().optional(),
  deviceUptimeMs: z.number().int().min(0).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
};

// M2 review follow-up: there is no public trips.accept / trips.decline. A driver answers an offer
// through `dispatch.respond` (offer id + accept), the single path that checks his open offer, cap,
// current job and the first-accept lock; dispatch then drives the trip internally.

export const ReportPositionInput = z.object({
  /** Omitted: applies to every active trip of the driver. */
  tripId: z.string().optional(),
  pin: LatLng,
  at: z.coerce.date(),
  speedKmh: z.number().min(0).optional(),
  bearing: z.number().min(0).max(360).optional(),
  accuracyM: z.number().min(0).optional(),
});
export type ReportPositionInput = z.infer<typeof ReportPositionInput>;

export const ReportPositionOutput = z.object({
  /** Stops whose 60 m geofence the driver is inside: the "وصلت" button is armed for these. */
  armed: z.array(z.object({ tripId: z.string(), stopId: z.string(), distanceM: z.number().int() })),
});
export type ReportPositionOutput = z.infer<typeof ReportPositionOutput>;

export const ArriveStopInput = z.object({ tripId: z.string().min(1), stopId: z.string().min(1), pin: LatLng.optional(), ...DeviceStamp });
export type ArriveStopInput = z.infer<typeof ArriveStopInput>;

export const CompleteStopInput = z.object({ tripId: z.string().min(1), stopId: z.string().min(1), handover: HandoverProof.default({}), ...DeviceStamp });
export type CompleteStopInput = z.infer<typeof CompleteStopInput>;

export const SkipStopInput = z.object({ tripId: z.string().min(1), stopId: z.string().min(1), reason: z.string().min(1).max(200), ...DeviceStamp });
export type SkipStopInput = z.infer<typeof SkipStopInput>;

export const StartUnreachableInput = z.object({ tripId: z.string().min(1), stopId: z.string().min(1), ...DeviceStamp });
export type StartUnreachableInput = z.infer<typeof StartUnreachableInput>;

export const FailTripInput = z.object({ tripId: z.string().min(1), reason: z.string().max(200).optional() });
export type FailTripInput = z.infer<typeof FailTripInput>;

export const CancelTripInput = z.object({ tripId: z.string().min(1), reason: z.string().min(1).max(200) });
export type CancelTripInput = z.infer<typeof CancelTripInput>;

export const ActiveTripsInput = z.object({ cityId: CityId });

/** What the API supplies to the trips router (implemented by `modules/trips`). */
/**
 * The driver's run sheet (M2 review follow-up): his trip's stops with each child's name, read from the
 * identity vault through identity's port for this driver only, every read logged in VaultAccessLog.
 */
export const RunSheet = z.object({
  tripId: z.string(),
  stops: z.array(
    z.object({
      stopId: z.string(),
      seq: z.number().int(),
      type: z.string(),
      zoneKey: z.string(),
      state: z.string(),
      childRef: z.string().nullable(),
      childName: z.string().nullable(),
    }),
  ),
});
export type RunSheet = z.infer<typeof RunSheet>;

export interface TripsPort {
  get(actor: Actor, input: { tripId: string }): Promise<Trip>;
  mine(actor: Actor): Promise<Trip[]>;
  board(actor: Actor, input: { cityId: string }): Promise<Trip[]>;
  runSheet(actor: Actor, input: { tripId: string }): Promise<RunSheet>;
  reportPosition(actor: Actor, input: ReportPositionInput): Promise<ReportPositionOutput>;
  arrive(actor: Actor, input: ArriveStopInput): Promise<Trip>;
  completeStop(actor: Actor, input: CompleteStopInput): Promise<Trip>;
  skipStop(actor: Actor, input: SkipStopInput): Promise<Trip>;
  startUnreachable(actor: Actor, input: StartUnreachableInput): Promise<Trip>;
  fail(actor: Actor, input: FailTripInput): Promise<Trip>;
  cancel(actor: Actor, input: CancelTripInput): Promise<Trip>;
}
