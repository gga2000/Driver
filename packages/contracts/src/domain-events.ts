import { z } from 'zod';
import { CityId, DeliveryPoint, Iqd, Vertical } from './common.js';
import { ComplimentKey } from './order-compliment.js';
import {
  DepartureCancelledPayload,
  DriverCancelledPayload,
  ErrandMoneyPayload,
  LateMeterPayload,
  MerchantSettlementRequestedPayload,
  OrderMoneyPayload,
  RideMoneyPayload,
  SeatMoneyPayload,
  SubscriptionChargePayload,
} from './ledger-io.js';
import { DriverDocumentKind } from './driver-account-io.js';
import { CommissionTier } from './ledger-rules.js';
import { OrderState, OrderType, PaymentMethod, RatingScore } from './order.js';
import { StuckReason } from './order-staff-io.js';
import { StopType, TripState, VehicleClass } from './trip.js';

/**
 * Payloads of the domain events that cross module boundaries (domain §6). ONE schema per event
 * type: the producer builds its payload as `DomainEventInput<type>` and `encodeDomainEvent`
 * validates it before it reaches the outbox; every consumer (ledger, dispatch, orders) parses
 * with `decodeDomainEvent`. A producer that drifts from its consumers fails in its own
 * transaction, never as a failed outbox row.
 *
 * Payloads travel as JSON (Prisma `Json`), so dates are ISO strings on the wire and `Date`s after
 * decoding. The envelope (actor, occurredAt, tripId, orderId) is not part of the payload; where a
 * consumer needs one of those inside the business fact (the ledger's `occurredAt`), the producer
 * puts it in the payload explicitly.
 */

const Transition = <F extends z.ZodTypeAny, T extends z.ZodTypeAny>(from: F, to: T) => ({ from, to });

// ───────────────────────── orders → dispatch ─────────────────────────

/**
 * `order.accepted` / `order.auto_accepted`: the kitchen took the order. Dispatch requests a courier
 * timed to arrive ~2 min before `promisedReadyAt` (spec §3 auto-assign).
 */
export const OrderAcceptedPayload = z.object({
  ...Transition(OrderState, z.literal('merchant_accepted')),
  orderType: OrderType,
  cityId: CityId,
  merchantOrgId: z.string().min(1).nullable(),
  prepMinutes: z.number().int().positive(),
  promisedReadyAt: z.coerce.date(),
  minVehicleClass: VehicleClass.nullable(),
  auto: z.boolean(),
  partial: z.boolean(),
  /** Merchant's location (null when the merchant has none on file: dispatch falls back to the city centre zone). */
  pickup: DeliveryPoint.nullable(),
  /** Customer's delivery point from `orders.place` (null for legacy orders placed without one). */
  dropoff: DeliveryPoint.nullable(),
  paymentMethod: PaymentMethod,
  /** What the courier will collect at the door on a cash order (cap exposure, decisions §3). */
  totalIqd: Iqd.nonnegative(),
});
export type OrderAcceptedPayload = z.infer<typeof OrderAcceptedPayload>;

/**
 * `order.courier_unassigned`: the courier's trip ended before pickup without the order ending (the
 * platform or a dispatcher took the job off an unreachable courier, the courier dropped it, the
 * kitchen's courier was released). With `redispatch`, dispatch requests a new courier the way it
 * did on `order.accepted`, so the payload repeats what dispatch needs for that.
 */
export const OrderCourierUnassignedPayload = z.object({
  tripId: z.string().min(1),
  by: z.string().min(1),
  reason: z.string().nullable(),
  redispatch: z.boolean(),
  orderType: OrderType,
  cityId: CityId,
  merchantOrgId: z.string().min(1).nullable(),
  /** When the kitchen promised the food (null for orders without a kitchen): the new courier is timed to it. */
  promisedReadyAt: z.coerce.date().nullable(),
  minVehicleClass: VehicleClass.nullable(),
  pickup: DeliveryPoint.nullable(),
  dropoff: DeliveryPoint.nullable(),
  paymentMethod: PaymentMethod,
  totalIqd: Iqd.nonnegative(),
});
export type OrderCourierUnassignedPayload = z.infer<typeof OrderCourierUnassignedPayload>;

// ───────────────────────── orders → ledger ─────────────────────────

const CashCollectedCommon = {
  tripId: z.string().min(1),
  courierId: z.string().min(1),
  /** Cash actually handed over at the door. */
  amountIqd: Iqd.nonnegative(),
  expectedIqd: Iqd.nonnegative(),
  discrepancyIqd: Iqd,
  /** "الخردة علينا": of `amountIqd`, what went to the customer's wallet because the courier had no change (0 = none). */
  changeToWalletIqd: Iqd.nonnegative().default(0),
};

/**
 * `order.change_to_wallet` ("الخردة علينا", 2026-10-05): the courier had no change, took the customer's
 * whole note and the rest landed in the customer's wallet (ledger `cash_change_to_wallet`). The
 * customer app shows "+7,250 دينار رصيد (الباقي)" and notify sends the same as a push.
 */
export const OrderChangeToWalletPayload = z.object({
  customerId: z.string().min(1),
  courierId: z.string().min(1),
  tripId: z.string().min(1),
  /** What went to the wallet. */
  amountIqd: Iqd.positive(),
  /** The note he handed over and the order's cash total (amount = collected − total). */
  collectedIqd: Iqd.positive(),
  totalIqd: Iqd.nonnegative(),
});
export type OrderChangeToWalletPayload = z.infer<typeof OrderChangeToWalletPayload>;

/**
 * `order.tipped`: the customer's tip after a 4–5 rating, wallet → driver (`tip:<orderId>`, Ali
 * 2026-10-06). The notify module pushes «علي كرمك 1,000 دينار» to the driver.
 */
export const OrderTippedPayload = z.object({
  customerId: z.string().min(1),
  courierId: z.string().min(1),
  tripId: z.string().min(1),
  amountIqd: Iqd.positive(),
});
export type OrderTippedPayload = z.infer<typeof OrderTippedPayload>;

/**
 * `order.complimented`: the customer's kind words after a 4–5 rating (joy l4, keys from
 * `ComplimentKey`; no money). The notify module pushes «زينب قالتلك: سريع، مؤدب» to the courier.
 */
export const OrderComplimentedPayload = z.object({
  customerId: z.string().min(1),
  courierId: z.string().min(1),
  tripId: z.string().min(1).nullable(),
  keys: z.array(ComplimentKey).min(1),
});
export type OrderComplimentedPayload = z.infer<typeof OrderComplimentedPayload>;

/**
 * `order.cash_collected`: cash is in the courier's (or driver's) hand. The ledger posts the money
 * group at once so the merchant's live balance and the courier's cap move immediately (decisions §3).
 * The nested money fact carries `cashCollectedIqd` = `amountIqd`.
 */
export const OrderCashCollectedPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('order'), order: OrderMoneyPayload, ...CashCollectedCommon }),
  z.object({ kind: z.literal('errand'), errand: ErrandMoneyPayload, ...CashCollectedCommon }),
  z.object({ kind: z.literal('ride'), ride: RideMoneyPayload, ...CashCollectedCommon }),
]);
export type OrderCashCollectedPayload = z.infer<typeof OrderCashCollectedPayload>;

const ClosedCommon = {
  ...Transition(OrderState, z.literal('closed')),
  /** `rated` (customer rated) or `auto_2h` (domain §2). */
  reason: z.string().min(1),
  totalIqd: Iqd.nonnegative(),
};

/** `order.closed`: money settles (if cash collection did not already post it), points on revenue, referral check. */
export const OrderClosedPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('order'), order: OrderMoneyPayload, ...ClosedCommon }),
  z.object({ kind: z.literal('errand'), errand: ErrandMoneyPayload, ...ClosedCommon }),
  z.object({ kind: z.literal('ride'), ride: RideMoneyPayload, ...ClosedCommon }),
]);
export type OrderClosedPayload = z.infer<typeof OrderClosedPayload>;

/** Who receives (part of) a cancellation fee: the wronged party gets 100 % (money §3). */
export const CancellationBeneficiary = z.object({ kind: z.enum(['merchant', 'driver']), id: z.string().min(1), amountIqd: Iqd.positive() });
export type CancellationBeneficiary = z.infer<typeof CancellationBeneficiary>;

/**
 * `order.cancelled` (customer or platform). The fee comes from `pricing.cancellationFee()`; its
 * splits are resolved to concrete beneficiaries (the merchant, the courier en route). A free
 * cancel has fee 0 and no beneficiaries, and posts nothing.
 */
export const OrderCancelledPayload = z
  .object({
    ...Transition(OrderState, z.enum(['customer_cancelled', 'platform_cancelled'])),
    cancelledState: z.enum(['customer_cancelled', 'platform_cancelled']),
    orderId: z.string().min(1),
    tripId: z.string().min(1).optional(),
    occurredAt: z.coerce.date(),
    customerId: z.string().min(1),
    householdId: z.string().min(1).optional(),
    by: z.enum(['customer', 'platform']),
    reason: z.string().min(1),
    free: z.boolean(),
    feeIqd: Iqd.nonnegative(),
    beneficiaries: z.array(CancellationBeneficiary).default([]),
    label_ar: z.string().optional(),
    reason_ar: z.string().optional(),
  })
  .refine((c) => c.beneficiaries.reduce((a, b) => a + b.amountIqd, 0) === c.feeIqd, { message: 'cancellation beneficiaries must add up to the fee', path: ['beneficiaries'] });
export type OrderCancelledPayload = z.infer<typeof OrderCancelledPayload>;

/**
 * `merchant.payable_accrued`: a cash order created the merchant's payable net of commission and a
 * courier now holds it (decisions §3). Informational for the Merchant app; the ledger posts the
 * payable from `order.cash_collected` (same numbers, one posting group).
 */
export const MerchantPayableAccruedPayload = z.object({
  merchantOrgId: z.string().min(1),
  courierId: z.string().min(1),
  tripId: z.string().min(1),
  grossIqd: Iqd.nonnegative(),
  commissionTier: CommissionTier,
  commissionPct: z.number().min(0).max(100),
  commissionIqd: Iqd.nonnegative(),
  /** What the merchant's own deal cost on this order (items discount or free delivery); in `netIqd` already. */
  dealIqd: Iqd.nonnegative().default(0),
  netIqd: Iqd,
  heldBy: z.literal('courier'),
});
export type MerchantPayableAccruedPayload = z.infer<typeof MerchantPayableAccruedPayload>;

// ───────────────────────── trips → orders, dispatch ─────────────────────────

export const TripAcceptedPayload = z.object({
  ...Transition(TripState, z.literal('accepted')),
  driverId: z.string().min(1),
  vehicleClass: VehicleClass,
  orderIds: z.array(z.string().min(1)),
});
export type TripAcceptedPayload = z.infer<typeof TripAcceptedPayload>;

/** `trip.declined` / `trip.timed_out`. `othersPending`: other offers are still open, the trip stays `offered`. */
export const TripOfferOutcomePayload = z.object({
  ...Transition(TripState, TripState),
  driverId: z.string().min(1),
  othersPending: z.boolean().default(false),
  reason: z.string().nullable().optional(),
});
export type TripOfferOutcomePayload = z.infer<typeof TripOfferOutcomePayload>;

export const TripCompletedPayload = z.object({
  ...Transition(TripState, z.literal('completed')),
  by: z.enum(['driver', 'customer', 'system']),
  reason: z.string().min(1),
  orderIds: z.array(z.string().min(1)),
});
export type TripCompletedPayload = z.infer<typeof TripCompletedPayload>;

export const TripCancelledPayload = z.object({
  ...Transition(TripState, z.enum(['driver_cancelled', 'customer_cancelled', 'platform_cancelled'])),
  by: z.enum(['driver', 'customer', 'platform']),
  reason: z.string().min(1),
  courierId: z.string().min(1).nullable(),
  acceptedAt: z.coerce.date().nullable(),
  arrivedPickupAt: z.coerce.date().nullable(),
  orderIds: z.array(z.string().min(1)),
  pickedUpOrderIds: z.array(z.string().min(1)),
});
export type TripCancelledPayload = z.infer<typeof TripCancelledPayload>;

export const StopCompletedPayload = z.object({
  stopId: z.string().min(1),
  stopType: StopType,
  vertical: Vertical,
  /** Cash taken at this stop (cash orders) — feeds the merchant cash account (decisions §3). */
  cashCollectedIqd: Iqd.nonnegative().nullable(),
  /** "الخردة علينا": the part of `cashCollectedIqd` that goes to the customer's wallet (checked by the trips module). */
  changeToWalletIqd: Iqd.positive().nullable().optional(),
  photo: z.boolean(),
  pinOk: z.boolean().nullable(),
  serverReceivedAt: z.coerce.date(),
  /**
   * A delivered drop-off at a customer's saved place with a known arrival fix (maps program a3): the
   * places module learns the door from it. Coordinates of the courier's tap, never the customer's pin.
   */
  door: z.object({ placeId: z.string().min(1), courierId: z.string().min(1), lat: z.number(), lng: z.number(), accuracyM: z.number().min(0) }).optional(),
  /**
   * Only on the drop-off that ends the trip, when the courier's arrival fix is known (maps program
   * SP3, drivers confirm zones): the zones module may ask him whether he is in the zone whose outline
   * holds this point. The courier's own position, never the customer's pin.
   */
  finalDrop: z.object({ cityId: z.string().min(1), lat: z.number(), lng: z.number(), accuracyM: z.number().min(0) }).optional(),
  /** s1 «رمز المشوار»: a night ride's pickup that the rider's code started (absent on every other stop). */
  startCodeChecked: z.literal(true).optional(),
});
export type StopCompletedPayload = z.infer<typeof StopCompletedPayload>;

// ───────────────────────── safety → on-call ─────────────────────────

/** What kind of safety incident pages the desk (SOS today; reports and خطوط alerts later). */
export const SafetyIncidentKind = z.enum(['sos', 'safety_report', 'sweep_alert', 'pin_alert']);
export type SafetyIncidentKind = z.infer<typeof SafetyIncidentKind>;

/**
 * `safety.incident_opened`: a safety incident row has committed. The on-call module (rota,
 * escalation after the first page) reads it; safety's own first page goes out on `sos.raised`.
 */
export const SafetyIncidentOpenedPayload = z.object({
  incidentId: z.string().min(1),
  kind: SafetyIncidentKind,
  cityId: CityId,
  zoneKey: z.string().nullable(),
  orderId: z.string().nullable(),
  rideId: z.string().nullable(),
  tripId: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type SafetyIncidentOpenedPayload = z.infer<typeof SafetyIncidentOpenedPayload>;

/** `safety.incident_acked`: a staff person took the incident (stops the on-call escalation). */
export const SafetyIncidentAckedPayload = z.object({ incidentId: z.string().min(1), byPersonId: z.string().min(1) });
export type SafetyIncidentAckedPayload = z.infer<typeof SafetyIncidentAckedPayload>;

/** `safety.incident_closed`: resolved by staff, or cancelled by the person who pressed (a false alarm). */
export const SafetyIncidentClosedPayload = z.object({
  incidentId: z.string().min(1),
  outcome: z.enum(['safe', 'false_alarm', 'emergency', 'escalated']),
  /** Staff who resolved it; null when the person cancelled it themselves. */
  byPersonId: z.string().nullable(),
});
export type SafetyIncidentClosedPayload = z.infer<typeof SafetyIncidentClosedPayload>;

// ───────────────────────── staff "Today" list (Console) ─────────────────────────

/**
 * `order.rated`: the customer's first scored rating landed, in the rating's own transaction. `stars`
 * is the delivery score (courier/driver), or the food score when he scored only the food.
 */
export const OrderRatedPayload = z.object({ orderId: z.string().min(1), stars: RatingScore, cityId: CityId });
export type OrderRatedPayload = z.infer<typeof OrderRatedPayload>;

/**
 * `courier.cash_over_cap` / `courier.cash_under_cap`: a ledger posting moved a driver across his
 * cash cap (money §4; exactly at the cap counts as over), emitted only on the crossing and in the
 * posting's transaction. `cashIqd` is what counts against the cap after the posting (owed =
 * cash he holds that is not his, net of what the platform owes him); `capIqd` his cap by role and tier.
 */
export const CourierCashCapPayload = z.object({ courierId: z.string().min(1), cashIqd: Iqd.nonnegative(), capIqd: Iqd.positive(), cityId: CityId });
export type CourierCashCapPayload = z.infer<typeof CourierCashCapPayload>;

/** `order.stuck`: the order entered the stuck list (`orders.ops.stuck`), seen by the W3 watchdog. `since` = when its state's clock started. */
export const OrderStuckPayload = z.object({ orderId: z.string().min(1), cityId: CityId, reason: StuckReason, since: z.coerce.date() });
export type OrderStuckPayload = z.infer<typeof OrderStuckPayload>;

/** `order.unstuck`: the order left the stuck list. `by` = who moved it out (the actor of its latest event; `system` for a timer). */
export const OrderUnstuckPayload = z.object({ orderId: z.string().min(1), cityId: CityId, by: z.string().min(1) });
export type OrderUnstuckPayload = z.infer<typeof OrderUnstuckPayload>;

/** `order.merchant_unresponsive`: the kitchen is past its promised time with no heartbeat (dispatcher card, call). `cityId` optional: older events have none. */
export const OrderMerchantUnresponsivePayload = z.object({
  merchantOrgId: z.string().min(1),
  promisedReadyAt: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  dispatcherCard: z.boolean(),
  call: z.boolean(),
  cityId: CityId.optional(),
});
export type OrderMerchantUnresponsivePayload = z.infer<typeof OrderMerchantUnresponsivePayload>;

/** `order.late_apology`: honest-delay step one, the apology with the new time. `cityId` optional: older events have none. */
export const OrderLateApologyPayload = z.object({ customerId: z.string().min(1), promisedAt: z.string().min(1), etaAt: z.string().min(1), cityId: CityId.optional() });
export type OrderLateApologyPayload = z.infer<typeof OrderLateApologyPayload>;

/** `driver.document_submitted`: a driver uploaded a document for review. `cityId` optional: older events have none. */
export const DriverDocumentSubmittedPayload = z.object({ documentId: z.string().min(1), kind: DriverDocumentKind, expiresAt: z.string().nullable(), cityId: CityId.optional() });
export type DriverDocumentSubmittedPayload = z.infer<typeof DriverDocumentSubmittedPayload>;

/** `driver.document_reviewed`: staff approved or rejected a document. `cityId` optional: older events have none. */
export const DriverDocumentReviewedPayload = z.object({ documentId: z.string().min(1), personId: z.string().min(1), kind: DriverDocumentKind, decision: z.enum(['approve', 'reject']), cityId: CityId.optional() });
export type DriverDocumentReviewedPayload = z.infer<typeof DriverDocumentReviewedPayload>;

// ───────────────────────── registry ─────────────────────────

/**
 * Every cross-module event with a contract. Routes events (seats, departures, khat subscriptions)
 * and merchant settlement requests have no producer yet; their schemas are the ledger's, so the
 * producer that lands later is bound by them from day one.
 */
export const DOMAIN_EVENT_PAYLOADS = {
  'order.accepted': OrderAcceptedPayload,
  'order.auto_accepted': OrderAcceptedPayload,
  'order.courier_unassigned': OrderCourierUnassignedPayload,
  'order.cash_collected': OrderCashCollectedPayload,
  'order.change_to_wallet': OrderChangeToWalletPayload,
  'order.tipped': OrderTippedPayload,
  'order.complimented': OrderComplimentedPayload,
  'order.closed': OrderClosedPayload,
  'order.cancelled': OrderCancelledPayload,
  'merchant.payable_accrued': MerchantPayableAccruedPayload,
  'trip.accepted': TripAcceptedPayload,
  'trip.declined': TripOfferOutcomePayload,
  'trip.timed_out': TripOfferOutcomePayload,
  'trip.completed': TripCompletedPayload,
  'trip.cancelled': TripCancelledPayload,
  'stop.completed': StopCompletedPayload,
  'seat.completed': SeatMoneyPayload,
  'seat.no_show': SeatMoneyPayload,
  'seat.late_meter_settled': LateMeterPayload,
  'departure.cancelled': DepartureCancelledPayload,
  'order.driver_cancelled': DriverCancelledPayload,
  'subscription.started': SubscriptionChargePayload,
  'subscription.renewed': SubscriptionChargePayload,
  'subscription.prorated': SubscriptionChargePayload,
  'merchant.settlement_requested': MerchantSettlementRequestedPayload,
  'safety.incident_opened': SafetyIncidentOpenedPayload,
  'safety.incident_acked': SafetyIncidentAckedPayload,
  'safety.incident_closed': SafetyIncidentClosedPayload,
  'order.rated': OrderRatedPayload,
  'courier.cash_over_cap': CourierCashCapPayload,
  'courier.cash_under_cap': CourierCashCapPayload,
  'order.stuck': OrderStuckPayload,
  'order.unstuck': OrderUnstuckPayload,
  'order.merchant_unresponsive': OrderMerchantUnresponsivePayload,
  'order.late_apology': OrderLateApologyPayload,
  'driver.document_submitted': DriverDocumentSubmittedPayload,
  'driver.document_reviewed': DriverDocumentReviewedPayload,
} as const satisfies Record<string, z.ZodTypeAny>;

export type DomainEventType = keyof typeof DOMAIN_EVENT_PAYLOADS;
/** What a producer hands to `encodeDomainEvent` (defaults may be omitted, dates may be `Date`s). */
export type DomainEventInput<T extends DomainEventType> = z.input<(typeof DOMAIN_EVENT_PAYLOADS)[T]>;
/** What a consumer gets from `decodeDomainEvent`. */
export type DomainEventPayload<T extends DomainEventType> = z.output<(typeof DOMAIN_EVENT_PAYLOADS)[T]>;

export function isDomainEventType(type: string): type is DomainEventType {
  return Object.prototype.hasOwnProperty.call(DOMAIN_EVENT_PAYLOADS, type);
}

/**
 * Validates a producer's payload against the contract and returns it as it will travel (JSON:
 * defaults applied, dates as ISO strings). Throws a `ZodError` naming the offending field.
 */
export function encodeDomainEvent<T extends DomainEventType>(type: T, payload: DomainEventInput<T>): Record<string, unknown> {
  const parsed: unknown = DOMAIN_EVENT_PAYLOADS[type].parse(payload);
  return JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
}

/** Parses a delivered payload (extra envelope keys are ignored). */
export function decodeDomainEvent<T extends DomainEventType>(type: T, payload: unknown): DomainEventPayload<T> {
  return DOMAIN_EVENT_PAYLOADS[type].parse(payload) as DomainEventPayload<T>;
}
