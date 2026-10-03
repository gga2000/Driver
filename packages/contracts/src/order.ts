import { z } from 'zod';
import { CityId, DeliveryPoint, Iqd } from './common.js';
import type { Actor } from './identity-io.js';
import { Participant, ParticipantInput } from './participant.js';
import { VehicleClass } from './trip.js';

/** Mirrors the Prisma `OrderType` enum. Seat and subscription orders belong to routes (Steps 5–7). */
export const OrderType = z.enum(['food', 'grocery_catalog', 'errand', 'parcel', 'ride', 'seat', 'subscription']);
export type OrderType = z.infer<typeof OrderType>;

/** Types `orders.place` accepts in M2 Step 4. */
export const PlaceableOrderType = z.enum(['food', 'grocery_catalog', 'errand', 'parcel', 'ride']);
export type PlaceableOrderType = z.infer<typeof PlaceableOrderType>;

/** Order machine (domain §2). `matched`/`completed` are the ride path. Mirrors the Prisma enum. */
export const OrderState = z.enum([
  'placed',
  'merchant_accepted',
  'preparing',
  'ready',
  'picked_up',
  'delivered',
  'closed',
  'matched',
  'completed',
  'merchant_rejected',
  'customer_cancelled',
  'platform_cancelled',
  'refunded',
  'disputed',
  'failed',
]);
export type OrderState = z.infer<typeof OrderState>;

export const TERMINAL_ORDER_STATES: readonly OrderState[] = ['closed', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'failed'];

export const PaymentMethod = z.enum(['cash', 'wallet', 'prepaid']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const RefundState = z.enum(['none', 'requested', 'credited', 'cash_refunded', 'denied']);
export type RefundState = z.infer<typeof RefundState>;

export const OrderLineInput = z
  .object({
    catalogItemId: z.string().optional(),
    freeText: z.string().max(300).optional(),
    qty: z.number().int().min(1).max(99),
    /**
     * Catalog lines are priced by the server from the merchant's menu (review C2); a price sent here
     * is only the cart's expectation and must equal the menu price or the order is refused with
     * `price_changed`. Errand/parcel free-text lines carry the customer's estimate here.
     */
    unitPriceIqd: Iqd.min(0).optional(),
    /** Chosen modifiers by id; name and price are filled in from the menu (a sent price must match). */
    modifiers: z.array(z.object({ groupId: z.string(), modifierId: z.string(), nameAr: z.string().optional(), priceIqd: Iqd.optional() })).default([]),
    /** Tags the line to a participant by its client `ref` (domain §3). */
    participantRef: z.string().optional(),
    note: z.string().max(300).optional(),
    pointsEligible: z.boolean().default(true),
    /** Merchant the item came from; every line must match the order's merchant (edge-case review A.11). */
    merchantOrgId: z.string().optional(),
  })
  .refine((l) => Boolean(l.catalogItemId ?? l.freeText), { message: 'a line needs a catalog item or free text' });
export type OrderLineInput = z.input<typeof OrderLineInput>;

export const PlaceOrderInput = z.object({
  cityId: CityId,
  type: PlaceableOrderType,
  merchantOrgId: z.string().optional(),
  /** The merchant branch whose menu overrides (price/availability) apply; the main menu when absent. */
  branchKey: z.string().max(64).optional(),
  householdOrgId: z.string().optional(),
  quoteId: z.string().optional(),
  lines: z.array(OrderLineInput).default([]),
  participants: z.array(ParticipantInput).max(20).default([]),
  /**
   * Fees are the server's (M2 review follow-up): the API quotes the order with `PricingService` for
   * its vertical, zones and options and locks that quote at placement. A value sent here is only the
   * cart's expectation: it must equal the server's or the order is refused with `price_changed`.
   */
  deliveryFeeIqd: Iqd.min(0).optional(),
  serviceFeeIqd: Iqd.min(0).optional(),
  /**
   * Discounts come only from a server-validated promotion (`promoCode`). Without one that resolves the
   * discount is 0; a value sent here must equal the promotion's (`price_changed`), and a discount with no
   * promotion behind it is refused (`promotion_invalid`).
   */
  discountIqd: Iqd.min(0).optional(),
  promoCode: z.string().min(1).max(40).optional(),
  /** The customer's tip: 100 % to the courier/driver, capped per order (config, default 10,000 → `tip_above_cap`). */
  tipIqd: Iqd.min(0).default(0),
  /** Rides: the fare the customer was shown; must equal the server's quote (`price_changed`). */
  fareIqd: Iqd.min(0).optional(),
  /** Rides: which city ride vertical is quoted (car taxi by default). */
  rideVertical: z.enum(['taxi', 'tuktuk']).optional(),
  /** Quote options the customer chose: door pickup (rides/errands/parcels), street hand-over (deliveries, −250). */
  options: z.object({ doorPickup: z.boolean().optional(), streetHandover: z.boolean().optional() }).optional(),
  paymentMethod: PaymentMethod.default('cash'),
  /** Where the trip starts for rides, errands and parcels (merchant orders start at the merchant's place). */
  pickup: DeliveryPoint.optional(),
  /** Where the courier delivers (the customer's saved place: zone key + pin). Dispatch builds the courier trip from it. */
  dropoff: DeliveryPoint.optional(),
  /** Scheduled orders are offered to the merchant at T − prep − 10 min (edge-case review A.12). */
  scheduledFor: z.coerce.date().optional(),
  note: z.string().max(500).optional(),
});
export type PlaceOrderInput = z.input<typeof PlaceOrderInput>;

/** Partial-accept proposal (edge-case review A.4): customer has 60 s to approve the reduced order. */
export const PartialProposal = z.object({
  unavailableLineIds: z.array(z.string()),
  proposedAt: z.coerce.date(),
  deadline: z.coerce.date(),
  reducedItemsTotalIqd: Iqd,
  reducedTotalIqd: Iqd,
});
export type PartialProposal = z.infer<typeof PartialProposal>;

export const OrderLine = z.object({
  id: z.string(),
  catalogItemId: z.string().nullable(),
  freeText: z.string().nullable(),
  qty: z.number().int(),
  unitPriceIqd: Iqd,
  modifiers: z.array(z.unknown()),
  participantId: z.string().nullable(),
  note: z.string().nullable(),
  pointsEligible: z.boolean(),
  /** `unavailable` while a partial-accept proposal is open; `removed` once the customer approved it. */
  availability: z.enum(['available', 'unavailable', 'removed']),
});
export type OrderLine = z.infer<typeof OrderLine>;

export const Order = z.object({
  id: z.string(),
  cityId: CityId,
  type: OrderType,
  state: OrderState,
  ordererId: z.string(),
  merchantOrgId: z.string().nullable(),
  householdOrgId: z.string().nullable(),
  quoteId: z.string().nullable(),
  paymentMethod: PaymentMethod,
  itemsTotalIqd: Iqd,
  deliveryFeeIqd: Iqd,
  serviceFeeIqd: Iqd,
  discountIqd: Iqd,
  tipIqd: Iqd,
  totalIqd: Iqd,
  /** Smallest vehicle class that may carry this order (bike ≤ 25,000 / 6 items, tuktuk ≤ 60,000, else car). */
  minVehicleClass: VehicleClass.nullable(),
  /** Above 100,000 the order is a dispatcher-handled catering request. */
  cateringRequest: z.boolean(),
  lines: z.array(OrderLine),
  participants: z.array(Participant),
  partial: PartialProposal.nullable(),
  scheduledFor: z.coerce.date().nullable(),
  merchantOfferedAt: z.coerce.date().nullable(),
  promisedReadyAt: z.coerce.date().nullable(),
  placedAt: z.coerce.date(),
  acceptedAt: z.coerce.date().nullable(),
  preparingAt: z.coerce.date().nullable(),
  readyAt: z.coerce.date().nullable(),
  pickedUpAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  cancelledAt: z.coerce.date().nullable(),
  cancellationReason: z.string().nullable(),
  cancellationFeeIqd: Iqd,
  refundState: RefundState,
  note: z.string().nullable(),
});
export type Order = z.infer<typeof Order>;

/** Who ends up with a cancellation fee (dispatch & pricing spec §4). */
export const FeeParty = z.enum(['customer', 'driver', 'courier', 'merchant', 'platform']);
export type FeeParty = z.infer<typeof FeeParty>;

export const CancellationFee = z.object({
  /** False when cancelling is not allowed at all (food after pickup → open a dispute instead). */
  allowed: z.boolean(),
  free: z.boolean(),
  amountIqd: Iqd.min(0),
  payer: z.enum(['customer', 'driver', 'merchant', 'none']),
  splits: z.array(z.object({ to: FeeParty, amountIqd: Iqd.min(0) })),
  /** Driver cancellations carry a scoring hit even when no money moves. */
  scoringHit: z.boolean(),
  label_ar: z.string(),
  label_en: z.string(),
  /** One-line reason printed on the receipt (spec §4). */
  reason_ar: z.string(),
});
export type CancellationFee = z.infer<typeof CancellationFee>;

export const DisputeKind = z.enum(['cold_or_late', 'missing_item', 'wrong_item', 'not_delivered', 'ride_fare', 'other']);
export type DisputeKind = z.infer<typeof DisputeKind>;

// ───────────────────────── procedure I/O ─────────────────────────

export const OrderIdInput = z.object({ orderId: z.string().min(1) });
export const MerchantAcceptInput = z.object({
  orderId: z.string().min(1),
  prepMinutes: z.number().int().min(1).max(240),
  /** Lines the kitchen cannot make: opens the 60-s partial-accept approval instead of accepting. */
  unavailableLineIds: z.array(z.string()).default([]),
});
export type MerchantAcceptInput = z.input<typeof MerchantAcceptInput>;
export const MerchantRejectInput = z.object({ orderId: z.string().min(1), reason: z.string().min(1).max(200) });
export type MerchantRejectInput = z.infer<typeof MerchantRejectInput>;
export const RespondPartialInput = z.object({ orderId: z.string().min(1), approve: z.boolean() });
export type RespondPartialInput = z.infer<typeof RespondPartialInput>;
export const CancelOrderInput = z.object({ orderId: z.string().min(1), reason: z.string().max(200).optional() });
export type CancelOrderInput = z.infer<typeof CancelOrderInput>;
export const OpenDisputeInput = z.object({ orderId: z.string().min(1), kind: DisputeKind, note: z.string().max(1000).optional() });
export type OpenDisputeInput = z.infer<typeof OpenDisputeInput>;
export const ListActiveOrdersInput = z.object({ cityId: CityId.optional(), merchantOrgId: z.string().optional() });
export type ListActiveOrdersInput = z.infer<typeof ListActiveOrdersInput>;
export const MerchantHeartbeatInput = z.object({ merchantOrgId: z.string().min(1) });

/** What the API supplies to the orders router (implemented by `modules/orders`). */
export interface OrdersPort {
  place(actor: Actor, input: z.infer<typeof PlaceOrderInput>): Promise<Order>;
  get(actor: Actor, input: { orderId: string }): Promise<Order>;
  mine(actor: Actor): Promise<Order[]>;
  listActive(actor: Actor, input: ListActiveOrdersInput): Promise<Order[]>;
  cancellationPreview(actor: Actor, input: { orderId: string }): Promise<CancellationFee>;
  cancel(actor: Actor, input: CancelOrderInput): Promise<Order>;
  respondPartial(actor: Actor, input: RespondPartialInput): Promise<Order>;
  openDispute(actor: Actor, input: OpenDisputeInput): Promise<Order>;
  rate(actor: Actor, input: { orderId: string }): Promise<Order>;
  confirmRideArrived(actor: Actor, input: { orderId: string }): Promise<Order>;
  merchantAccept(actor: Actor, input: z.infer<typeof MerchantAcceptInput>): Promise<Order>;
  merchantReject(actor: Actor, input: MerchantRejectInput): Promise<Order>;
  markPreparing(actor: Actor, input: { orderId: string }): Promise<Order>;
  markReady(actor: Actor, input: { orderId: string }): Promise<Order>;
  merchantHeartbeat(actor: Actor, input: { merchantOrgId: string }): Promise<{ ok: true }>;
}
