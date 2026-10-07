import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import {
  AZIZIYAH_MONEY_RULES,
  baghdadMonth,
  baghdadMonthRange,
  DriverError,
  HOUSEHOLD_RULES,
  householdApproval,
  householdMonthSpend,
  type HouseholdApprovalReason,
  MERCHANT_PREP_EXTENSION,
  latePromiseTerms,
  type LatePromiseBasis,
  PlaceOrderInput,
  cashToHand,
  changeToWalletProblem,
  tenderProblem,
  TERMINAL_ORDER_STATES,
  encodeDomainEvent,
  isDomainEventType,
  orderTicketNumber,
  parseOrderTicket,
  redeemablePoints,
  rideReminderAt,
  rideScheduleProblem,
  sortCargo,
  rideSearchStartsAt,
  smallOrderFeeIqd,
  type CancellationBeneficiary,
  type CancellationFee,
  type ComingOutResult,
  type DeliveryPoint,
  type LatLng,
  type DisputeKind,
  type DomainEventInput,
  type HandoverProof,
  type Order,
  type OrderQuote,
  type OrderRating,
  type OrderSearchPage,
  type OrderState,
  type OrderType,
  type ParticipantShare,
  type RateOrderInput,
  type RideSwitchQuote,
  RATING_RULES,
  COURIER_RATING_WINDOW,
  courierReasonsFor,
  type Trip,
  type TripState,
  type VehicleClass,
  type Vertical,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { startOfLocalDay } from '../../shared/local-time.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { advisoryXactLock } from '../../shared/db/advisory-lock.js';
import { isUniqueViolation } from '../../shared/db/unique-violation.js';
import { KeyedLock } from '../../shared/keyed-lock.js';
import { jobKey, type Queue } from '../../shared/queue.js';
import type { CancellationSubject } from '../pricing/index.js';
import { EtaService } from '../routing/index.js';
import { ORDER_EVENTS, type OrderEventEmitter, type TripEventEnvelope } from './events.adapter.js';
import { assertExpected, serverFees, verticalOf as orderVertical, type QuotePort, type ServerFees } from './fees.js';
import { ORDERS_CONTROLS, THROTTLED_ORDER_TYPES, type OrdersControlsPort } from './controls.port.js';
import { ACTIVE_ORDER_STATES, decodeCursor, encodeCursor, isLate, toSummary } from './history.js';
import { ORDERS_CATALOG, priceLines, type CatalogPort, type CatalogStorefrontView } from './catalog.port.js';
import { MERCHANT_DIRECTORY, type MerchantDirectory, type MerchantProfile } from './merchants.port.js';
import { DISPUTABLE_STATES, MERCHANT_ORDER_TYPES, canOrderTransition, orderEventType, vehicleRequirement } from './order.machine.js';
import { CATERING_ABOVE_IQD, DEFAULT_TIMEZONE, ORDERS_RULES, commissionPctOf } from './orders.config.js';
import {
  DuplicateClientRequest,
  ORDERS_REPOSITORY,
  type DiscountMeta,
  type LineUnavailability,
  type NewLine,
  type OrderAggregate,
  type OrderLineRecord,
  type OrderPatch,
  type OrderRecord,
  type OrderSearchFilter,
  type OrdersRepository,
} from './orders.repository.js';
import { ORDERS_HOUSEHOLDS, type OrdersHouseholdsPort } from './households.port.js';
import { activePauseWindow } from './pause.js';
import { busyExtraMinutes } from './busy.js';
import { SLOT_CAP_RULES, slotFull, type SlotCapRules } from './slot-cap.js';
import { giftProblem, giftView } from './gift.js';
import { startCodeForNewOrder } from './start-code.js';
import { NoPromotions, ORDERS_PROMOTIONS, type MerchantDealQuery, type PromotionsPort, type ResolvedPromotion } from './promotions.port.js';
import { PARTICIPANT_RESOLVER, allocatePoints, assertLineTags, orderPoints, platformRevenueIqd, resolveParticipants, type ParticipantResolver } from './participants.js';
import type { OrdersRidersPort, ResolvedRider } from './riders.js';
import { publicLabel, recipientIds, rememberRecipients, withRecipientLabels } from './recipients.js';

/** A household member as placement reads them (role and limits). */
type HouseholdMember = NonNullable<Awaited<ReturnType<OrdersHouseholdsPort['member']>>>;

/** The lock key of one member's spending on one household wallet (in-process and advisory). */
export function householdSpendKey(householdId: string, personId: string): string {
  return `orders.household_spend:${householdId}:${personId}`;
}

/** The slice of trips the orders module drives (courier release, cancellations, rider completion, settlement). */
export interface OrdersTripsPort {
  activeForOrder(orderId: string): Promise<Trip | null>;
  detachOrder(tripId: string, orderId: string, actorId?: string, reason?: string): Promise<Trip>;
  cancel(tripId: string, by: 'driver' | 'customer' | 'platform', actorId: string, reason: string): Promise<Trip>;
  customerComplete(tripId: string, customerId: string, reason?: string): Promise<Trip>;
  /** «أني نازل» (J-D8): 2 more minutes before "فشل" at this order's door, once. */
  extendUnreachable(tripId: string, orderId: string, customerId: string): Promise<{ extended: boolean; trip: Trip }>;
  /** Who carried the order (for settlement on `closed`); null when no driver ever took it. */
  courierOf(orderId: string): Promise<{ tripId: string; courierId: string; vertical: Vertical } | null>;
}

/**
 * Ledger's new-customer cash rule (decisions §4): the first three cash orders of an account are
 * capped at 25,000 and need the arriving call. Bound to the ledger's `CapsService`.
 */
export interface OrdersCashRiskPort {
  newCustomerCash(customerId: string, orderTotalIqd: number): Promise<{ allowed: boolean; requiresArrivingCall: boolean; priorCashOrders: number }>;
}

export const ORDERS_CASH_RISK = Symbol('ORDERS_CASH_RISK');

/**
 * Wallet payments (UI/UX audit C-04): the payer's wallet balance as the ledger has it (the customer's
 * own, or the household wallet he orders on). `place` subtracts his open wallet orders (charged at
 * close) and refuses an order the rest does not cover (`wallet_insufficient`). Bound to the ledger.
 */
export interface OrdersWalletPort {
  balanceIqd(payer: { customerId: string; householdId: string | null }): Promise<number>;
  /** W-02: the customer's own points balance (points are personal, also on a household order). */
  pointsBalance?(customerId: string): Promise<number>;
}

export const ORDERS_WALLET = Symbol('ORDERS_WALLET');

/**
 * Saved places (maps program SP3d): an order keeps the link to the place it goes to only when the
 * orderer may use it (theirs, or shared by the household), so the courier sees that place's door —
 * and goes to the door couriers' arrivals learned (a3). Null = not theirs, or gone.
 */
export interface OrdersPlacesPort {
  deliveryPlace(personId: string, placeId: string): Promise<{ door: LatLng | null } | null>;
}

export const ORDERS_PLACES = Symbol('ORDERS_PLACES');

/** Invite as a gift (joy g2): the person who invited a customer, or null (the referrals module). */
export interface OrdersReferralsPort {
  referrerOf(personId: string): Promise<string | null>;
}

/** Joy l9: the driver behind one of the rider's favourites, or null when it is not his (the ride-habits module). */
export interface OrdersFavouritesPort {
  driverFor(personId: string, favouriteId: string): Promise<string | null>;
}

/** Pricing as orders uses it: the server quote that fixes an order's fees, and cancellation fees. */
export interface OrdersPricingPort extends QuotePort {
  cancellationFee(subject: CancellationSubject, at: Date, cityId?: string): CancellationFee;
  /** Seconds a ride searches before the customer may cancel free or switch vehicle (city dispatch config). */
  freeCancelAfterSec?(cityId: string, vertical: Vertical): number;
  /** LOAD-01: takes the kept quote the order names, once (false: unknown, expired or already taken). */
  claimQuote?(quoteId: string, at: Date, tx: Tx): Promise<boolean>;
}

/** `DispatchConfig.customerFreeCancelAfterSec`'s default, when the pricing port has no city config. */
const RIDE_FREE_CANCEL_FALLBACK_SEC = 180;
type RideVertical = 'taxi' | 'tuktuk';

export const ORDERS_TRIPS = Symbol('ORDERS_TRIPS');
export const ORDERS_PRICING = Symbol('ORDERS_PRICING');
export const ORDERS_QUEUE = Symbol('ORDERS_QUEUE');

export const ORDER_JOBS = {
  autoReject: 'merchant.autoReject',
  autoClose: 'order.autoClose',
  partialTimeout: 'order.partialTimeout',
  offerToMerchant: 'order.offerToMerchant',
  /** Joy w4: a held household order nobody answered is cancelled free (`HOUSEHOLD_RULES.approvalWaitMin`). */
  payerTimeout: 'order.payerTimeout',
  /** Step 4 (c10): «مشوارك بعد نص ساعة» for a ride booked for later (`rideReminderAt`). */
  rideReminder: 'order.rideReminder',
  readyOverdue: 'merchant.readyOverdue',
  courierRelease: 'merchant.courierRelease',
} as const;

export interface OrderTimerJob {
  orderId: string;
  /** The run the job belongs to (offer time, proposal time, promised-ready time); stale runs are no-ops. */
  refMs?: number;
}

const SYSTEM = 'system';
/** Orders that carry the honest-delay promise (as `promisedArrival` in tracking): their ride is locked at placement. */
const PROMISED_ORDER_TYPES: readonly OrderType[] = ['food', 'grocery_catalog'];
const PRE_PICKUP_COURIER_STATES = ['accepted', 'en_route_to_pickup', 'arrived_pickup'];
/** The participant ref a ride booked for someone else writes its rider under (c9/s3). */
const RIDER_REF = 'rider';
/** Rider names kept per reader and participant (a name never changes once the ride is placed). */
const RIDER_NAME_CACHE_MAX = 2000;

type PlaceInput = z.input<typeof PlaceOrderInput>;

/**
 * Orders (plan Step 4): the commercial object. Merchant acceptance within 90 s (auto-accept
 * merchants skip it; auto-rejects inside a declared pause window do not score), partial accept
 * with 60 s customer approval, scheduled-order offer timing, merchant heartbeat and courier
 * release, cancellation fees from pricing, 2-h auto-close, participant points, the merchant cash
 * account events on cash collection, and the reaction to trip events (`onTripEvent`).
 *
 * Every mutation runs in one unit of work and emits its domain events through the adapter;
 * timers are delayed queue jobs that re-check state when they fire.
 */
/** Orders one ticket-number search reads before it pages (two busy days of a city fit easily). */
export const TICKET_SCAN_LIMIT = 5_000;

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: OrdersRepository,
    @Inject(ORDER_EVENTS) private readonly events: OrderEventEmitter,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ORDERS_QUEUE) private readonly queue: Queue<OrderTimerJob>,
    @Inject(ORDERS_TRIPS) private readonly trips: OrdersTripsPort,
    @Inject(ORDERS_PRICING) private readonly pricing: OrdersPricingPort,
    @Inject(MERCHANT_DIRECTORY) private readonly merchants: MerchantDirectory,
    @Inject(PARTICIPANT_RESOLVER) private readonly participants: ParticipantResolver,
    @Inject(ORDERS_CASH_RISK) private readonly cashRisk: OrdersCashRiskPort,
    @Inject(ORDERS_CATALOG) private readonly catalog: CatalogPort,
    @Optional() @Inject(ORDERS_PROMOTIONS) promotions?: PromotionsPort,
    @Optional() @Inject(ORDERS_CONTROLS) private readonly controls?: OrdersControlsPort,
    @Optional() @Inject(ORDERS_WALLET) private readonly wallet?: OrdersWalletPort,
    @Optional() @Inject(ORDERS_PLACES) private readonly places?: OrdersPlacesPort,
    @Optional() @Inject(ORDERS_HOUSEHOLDS) private readonly households?: OrdersHouseholdsPort,
    /** The one ETA (learned minutes) the honest-delay promise's ride is locked from at placement; absent = no lock. */
    @Optional() private readonly eta?: EtaService,
  ) {
    this.promotions = promotions ?? new NoPromotions();
  }

  private readonly logger = new Logger(OrdersService.name);

  private readonly promotions: PromotionsPort;
  /** One placing at a time per (orderer, client request id) in this instance (no duplicate orders). */
  private readonly placeLock = new KeyedLock();
  /** Joy w4: one household-wallet placing at a time per member in this instance (the budget check). */
  private readonly householdLock = new KeyedLock();
  /** Per-kitchen caps on scheduled slots (J6): off by default; ops (or a test) switch them on. */
  slotCaps: SlotCapRules = SLOT_CAP_RULES;
  /**
   * Invite as a gift (joy g2): who invited the orderer, sent with the closed order so the ledger's
   * referral rule (decisions §1) can pay. Bound by the module (the referrals module owns invitations).
   */
  private referrals: OrdersReferralsPort | null = null;

  bindReferrals(port: OrdersReferralsPort): void {
    this.referrals = port;
  }

  /** Joy l9: who a booked ride's favourite is. Bound by the ride-habits module (it owns favourites). */
  private favourites: OrdersFavouritesPort | null = null;

  bindFavourites(port: OrdersFavouritesPort): void {
    this.favourites = port;
  }

  /**
   * Ride ideas c9/s3: who rides when a ride is booked for someone else, and the name the booker gave
   * them (identity's vault). Bound by the module; without it a ride for someone else is refused.
   */
  private riders: OrdersRidersPort | null = null;
  /** Rider names already read per reader and participant, so a 3-second poll logs one vault read, not one per poll. */
  private readonly riderNameCache = new Map<string, string>();

  bindRiders(port: OrdersRidersPort): void {
    this.riders = port;
  }

  /** How many orders a person has placed (any state): the referrals module asks before a claim. */
  async placedCount(personId: string): Promise<number> {
    return (await this.repo.forPerson(personId)).filter((o) => o.ordererId === personId).length;
  }

  onModuleInit(): void {
    this.queue.process((job) => this.handleTimer(job.name, job.data));
  }

  // ───────────────────────── placing ─────────────────────────

  /**
   * No duplicate orders: with a `clientRequestId` (one per checkout attempt, re-sent on retries) a
   * repeated call answers with the order the first one placed — the same view, nothing charged,
   * reserved or offered twice. Concurrent calls are serialised per key in this instance and, across
   * instances, by an advisory lock in the transaction and the unique (orderer, key) index.
   */
  async place(ordererId: string, raw: PlaceInput): Promise<Order> {
    const input = PlaceOrderInput.parse(raw);
    const key = input.clientRequestId;
    if (!key) return this.placeOnce(ordererId, input);
    const prior = await this.replay(ordererId, input);
    if (prior) return prior;
    try {
      return await this.placeLock.run(`${ordererId}:${key}`, async () => (await this.replay(ordererId, input)) ?? this.placeOnce(ordererId, input));
    } catch (err) {
      if (!(err instanceof DuplicateClientRequest)) throw err;
      const winner = await this.replay(ordererId, input);
      if (winner) return winner;
      throw err.cause ?? err;
    }
  }

  /**
   * A point's saved-place link, kept only when the orderer may use that place (maps program SP3d),
   * with the door learned for it (a3). A place someone else owns, or one deleted since, drops the
   * link; a client's own `door` is never kept; the pin and zone stay as sent.
   */
  private async placeLink(ordererId: string, point: DeliveryPoint | undefined): Promise<DeliveryPoint | undefined> {
    if (!point) return point;
    const base: DeliveryPoint = point.pin ? { zoneKey: point.zoneKey, pin: point.pin } : { zoneKey: point.zoneKey };
    if (!point.placeId || !this.places) return base;
    const place = await this.places.deliveryPlace(ordererId, point.placeId);
    if (!place) return base;
    return { ...base, placeId: point.placeId, ...(place.door ? { door: place.door } : {}) };
  }

  /** The order already placed with this request's key, as `place` answered it; null when none. */
  private async replay(ordererId: string, input: z.output<typeof PlaceOrderInput>, tx?: Tx): Promise<Order | null> {
    if (!input.clientRequestId) return null;
    const prior = await this.repo.findByClientRequest(ordererId, input.clientRequestId, tx);
    if (!prior) return null;
    // A key belongs to one checkout attempt: re-used for a different order it is a client bug, not a retry.
    if (prior.order.type !== input.type || prior.order.merchantOrgId !== (input.merchantOrgId ?? null)) throw new DriverError('invalid_input');
    return this.view(prior.order.id, tx);
  }

  /** `carried`: a ride switched to the other vehicle keeps the rider it was booked for (J-D7 × c9). */
  private async placeOnce(ordererId: string, raw: z.output<typeof PlaceOrderInput>, carried: { rider?: ResolvedRider } = {}): Promise<Order> {
    const input = { ...raw, pickup: await this.placeLink(ordererId, raw.pickup), dropoff: await this.placeLink(ordererId, raw.dropoff) };
    const now = this.clock.now();
    // c9/s3: a ride for someone else is a ride, with one rider (the legacy `participants` rider or this, not both).
    if (input.rider || carried.rider) {
      if (input.type !== 'ride' || input.participants.some((pp) => pp.role === 'rider' || pp.ref === RIDER_REF)) throw new DriverError('invalid_input');
      if (!this.riders) throw new DriverError('internal');
    }
    const preferredDriverId = await this.rideBooking(ordererId, input, now);
    const p = await this.price(ordererId, input, now, { quote: false });
    const { merchantType, profile, newLines, itemsTotal, fees, caps } = p;
    // Launch controls (playbook §3): kill switches and the zone throttle refuse before anything is written.
    await this.controls?.assertOrderAllowed({
      cityId: input.cityId,
      vertical: orderVertical(input.type, input.rideVertical),
      zones: [merchantType ? profile?.location?.zoneKey : input.pickup?.zoneKey, input.dropoff?.zoneKey],
      customerZone: THROTTLED_ORDER_TYPES.includes(input.type) ? (input.dropoff?.zoneKey ?? null) : null,
      merchantOrgId: merchantType ? (input.merchantOrgId ?? null) : null,
      scheduledFor: input.scheduledFor ?? null,
    });
    // J6: a kitchen capped per slot (Ramadan's iftar rush) refuses one order too many for that slot.
    if (merchantType && input.scheduledFor && input.merchantOrgId) {
      const merchantOrgId = input.merchantOrgId;
      if (this.slotCaps.perSlot !== null || merchantOrgId in this.slotCaps.byMerchant) {
        const live = await this.repo.findMany({ merchantOrgId, states: ACTIVE_ORDER_STATES });
        if (slotFull(this.slotCaps, merchantOrgId, input.scheduledFor, live.map((o) => o.scheduledFor))) throw new DriverError('slot_full');
      }
    }
    const participants = await resolveParticipants(input.participants, this.participants);
    assertLineTags(input.type === 'ride' ? [] : input.lines, participants);
    if (input.type === 'ride') assertExpected(input.fareIqd, fees.fareIqd);
    assertExpected(input.deliveryFeeIqd, fees.deliveryFeeIqd);
    assertExpected(input.serviceFeeIqd, fees.serviceFeeIqd);
    // The cart's expected discount (from `orders.quote`): a deal that ended, ran out or changed since
    // is a refresh, never a silent change of what the customer pays.
    const discount = p.discount?.amountIqd ?? 0;
    if (input.discountIqd !== undefined && input.discountIqd !== discount) throw new DriverError(input.promoCode ? 'price_changed' : 'deal_changed');
    // W-02: the points value the checkout showed; a different figure (balance spent elsewhere) is a refresh.
    assertExpected(input.pointsIqd, p.pointsIqd);
    const total = p.totalIqd;
    // "الخردة علينا": the note he says he will pay with is a hint for the courier, checked on the
    // server's own cash total (≥ total, ≤ total + 50,000, in 250s) and only on a cash order.
    if (input.statedTenderIqd !== undefined && (input.paymentMethod !== 'cash' || tenderProblem(input.statedTenderIqd, total, ORDERS_RULES.changeToWallet) !== null)) {
      throw new DriverError('tender_invalid');
    }
    // «عزيمة» (joy g1): a gift goes to a recipient; hidden prices only when the sender pays from his wallet.
    const giftCode = giftProblem({ gift: input.gift, type: input.type, paymentMethod: input.paymentMethod, participantRoles: input.participants.map((pp) => pp.role) });
    if (giftCode) throw new DriverError(giftCode);
    // Decisions §4: a new account's first three cash orders are capped and get the arriving call —
    // on the server-computed total.
    const risk = input.paymentMethod === 'cash' ? await this.cashRisk.newCustomerCash(ordererId, total) : null;
    if (risk && !risk.allowed) throw new DriverError('new_customer_cash_cap');
    // Joy w4: the household wallet — only its payers and orderers, kitchen and shop orders only. Whether
    // the payer is asked is decided inside the transaction below, under the member's lock.
    const member = input.householdOrgId ? await this.householdMember(ordererId, input.householdOrgId, Boolean(merchantType)) : null;
    const spendKey = input.householdOrgId ? householdSpendKey(input.householdOrgId, ordererId) : null;
    // C-04: a wallet order must be covered by what the wallet has left after his open wallet orders.
    if (input.paymentMethod === 'wallet' && this.wallet && total > 0) {
      const available = await this.walletAvailable(ordererId, input.householdOrgId ?? null);
      if (available < total) throw new DriverError('wallet_insufficient');
    }

    // The honest-delay promise's ride, locked now (Ali, 2026-10-07): read before the transaction, it is
    // a routing call and a cached read of the learned corrections, never a write.
    const promisedRideMin = await this.lockPromisedRide(input, profile?.location?.pin ?? null, caps?.minVehicleClass ?? null, now);

    const write = () =>
      this.uow.run(async (tx) => {
        if (input.clientRequestId) {
          // Another API instance placing with the same key commits (or rolls back) before we look.
          await advisoryXactLock(tx, `orders.place:${ordererId}:${input.clientRequestId}`);
          const prior = await this.replay(ordererId, input, tx);
          if (prior) return prior;
        }
        // LOAD-01: one kept quote, one order (a retry of this order was answered by the replay above).
        if (input.quoteId && this.pricing.claimQuote && !(await this.pricing.claimQuote(input.quoteId, now, tx))) throw new DriverError('price_changed');
        // Joy w4: the member's month is read and this order written under one lock per household member
        // (this instance's KeyedLock below, every instance's advisory lock here), so two orders placed
        // together can never both slip under the budget: the second sees the first and is held.
        let askPayer: HouseholdApprovalReason | null = null;
        if (member && spendKey && input.householdOrgId) {
          await advisoryXactLock(tx, spendKey);
          askPayer = await this.householdReason(member, input.householdOrgId, ordererId, total, now, tx);
        }
        // The deal's spend is reserved in this transaction, atomically against its budget cap: two
        // orders can never both spend the last of it (the later one is asked to refresh).
        if (p.discount && p.discount.meta.funder === 'merchant' && discount > 0) {
          if (!(await this.promotions.reserve(p.discount.promotionId, discount, tx))) throw new DriverError('deal_changed');
        }
        // c9/s3: the rider is resolved in this unit of work, so a pseudonymous person made for a typed
        // number is only kept with the order; their name goes to the vault once the participant exists.
        const rider = carried.rider ?? (input.rider ? await this.resolveRider(ordererId, input.rider) : null);
        const agg = await this.repo.create(
          {
            cityId: input.cityId,
            type: input.type,
            ordererId,
            merchantOrgId: input.merchantOrgId ?? null,
            householdOrgId: input.householdOrgId ?? null,
            quoteId: input.quoteId ?? null,
            paymentMethod: input.paymentMethod,
            itemsTotalIqd: itemsTotal,
            deliveryFeeIqd: fees.deliveryFeeIqd,
            serviceFeeIqd: fees.serviceFeeIqd,
            discountIqd: discount,
            promotionId: discount > 0 ? (p.discount?.promotionId ?? null) : null,
            discountMeta: discount > 0 ? (p.discount?.meta ?? null) : null,
            smallOrderFeeIqd: p.smallOrderFee,
            pointsRedeemed: p.pointsRedeemed,
            tipIqd: input.tipIqd,
            totalIqd: total,
            note: input.note ?? null,
            courierNote: input.courierNote?.trim() ? input.courierNote.trim() : null,
            clientRequestId: input.clientRequestId ?? null,
            statedTenderIqd: input.statedTenderIqd ?? null,
            gift: Boolean(input.gift),
            giftHidePrices: Boolean(input.gift?.hidePrices),
            scheduledFor: input.scheduledFor ?? null,
            minVehicleClass: caps?.minVehicleClass ?? null,
            dropoff: input.dropoff ?? null,
            promisedRideMin,
            // s1: a ride for the night starts only with the code the rider reads out.
            startCode: startCodeForNewOrder(input.type, input.scheduledFor ?? now),
            placedAt: now,
            heldForPayer: askPayer !== null,
            familyTable: input.familyTable ?? false,
            preferredDriverId,
            familyPreferred: input.type === 'ride' && input.familyPreferred === true,
            rideCargo: input.type === 'ride' ? sortCargo(input.rideCargo ?? []) : [],
          },
          newLines,
          [
            ...participants.map((pp) => ({ ref: pp.ref, role: pp.role, personId: pp.personId, phoneHash: pp.phoneHash, label: publicLabel(pp), note: pp.note })),
            ...(rider ? [{ ref: RIDER_REF, role: 'rider' as const, personId: rider.personId, phoneHash: rider.phoneHash, label: null, note: null }] : []),
          ],
          tx,
        );
        const order = agg.order;
        const riderParticipant = rider ? agg.participants.find((pp) => pp.role === 'rider') : undefined;
        if (rider && riderParticipant && this.riders) await this.riders.remember(riderParticipant.id, rider, ordererId);
        await rememberRecipients(this.riders, agg.participants, participants, ordererId); // SEC-14: names to the vault
        await this.emit(tx, 'order.placed', ordererId, order, {
          type: order.type,
          cityId: order.cityId,
          merchantOrgId: order.merchantOrgId,
          totalIqd: order.totalIqd,
          itemsTotalIqd: order.itemsTotalIqd,
          paymentMethod: order.paymentMethod,
          minVehicleClass: order.minVehicleClass,
          cateringRequest: caps?.catering ?? false,
          scheduledFor: order.scheduledFor?.toISOString() ?? null,
          participantCount: agg.participants.length,
          ...(rider ? { forSomeoneElse: true } : {}),
          arrivingCallRequired: risk?.requiresArrivingCall ?? false,
          // Rides: what dispatch needs to build the trip and find a driver (`dispatch:ride-request`).
          // Step 4 (o4): door pickup too, so ride habits can offer the same ride the same way.
          ...(order.type === 'ride' ? { ride: { vertical: input.rideVertical ?? 'taxi', pickup: input.pickup ?? null, dropoff: input.dropoff ?? null, quoteId: input.quoteId ?? null, preferDriverId: preferredDriverId, familyPreferred: input.familyPreferred === true, doorPickup: input.options?.doorPickup ?? false } } : {}),
          ...(discount > 0 && p.discount ? { discountIqd: discount, promotionId: p.discount.promotionId, discountFunder: p.discount.meta.funder } : {}),
        });
        for (const l of agg.lines) if (l.participantId) await this.emit(tx, 'line.tagged', ordererId, order, { lineId: l.id, participantId: l.participantId });
        if (caps?.catering) await this.emit(tx, 'order.catering_request', SYSTEM, order, { itemsTotalIqd: itemsTotal, dispatcherCard: true });

        if (askPayer && order.householdOrgId && this.households) {
          // Held: the kitchen sees nothing until the payer says yes; the request commits with the order.
          await this.households.requestApproval({ householdId: order.householdOrgId, orderId: order.id, requestedBy: ordererId, amountIqd: total, reason: askPayer });
          await this.emit(tx, 'order.awaiting_payer', ordererId, order, { householdId: order.householdOrgId, reason: askPayer, totalIqd: total, waitMin: HOUSEHOLD_RULES.approvalWaitMin });
          await this.queue.add(ORDER_JOBS.payerTimeout, { orderId: order.id }, { delayMs: HOUSEHOLD_RULES.approvalWaitMin * 60_000, jobId: jobKey('order', order.id, 'payerTimeout') });
        } else if (merchantType && profile) {
          await this.scheduleOffer(order, profile, now, tx);
        }
        // Step 4 (c10): a ride booked for later reminds its rider half an hour before (a delayed job, so
        // it survives a restart like every order timer); booked closer than that, nothing to remind.
        const remindAt = order.type === 'ride' && order.scheduledFor ? rideReminderAt(order.scheduledFor, now) : null;
        if (remindAt && order.scheduledFor) {
          await this.queue.add(ORDER_JOBS.rideReminder, { orderId: order.id, refMs: order.scheduledFor.getTime() }, { delayMs: remindAt.getTime() - now.getTime(), jobId: jobKey('order', order.id, 'rideReminder') });
        }
        return this.view(order.id, tx);
      });
    return spendKey ? this.householdLock.run(spendKey, write) : write();
  }

  /**
   * Joy J7d / l9 at placement: a ride booked for later is 20 min – 7 days ahead; only such a ride may
   * ask for a favourite, and only one of the orderer's own. Returns the favourite's driver (or null).
   */
  private async rideBooking(ordererId: string, input: z.output<typeof PlaceOrderInput>, now: Date): Promise<string | null> {
    if (input.type === 'ride' && input.scheduledFor && rideScheduleProblem(input.scheduledFor, now)) throw new DriverError('ride_schedule_invalid');
    if (!input.favouriteId) return null;
    if (input.type !== 'ride' || !input.scheduledFor) throw new DriverError('favourite_needs_schedule');
    const driverId = this.favourites ? await this.favourites.driverFor(ordererId, input.favouriteId) : null;
    if (!driverId) throw new DriverError('favourite_not_found');
    return driverId;
  }

  /**
   * Joy w4 at placement: refuses anyone but the household's payers and orderers, and anything but a
   * kitchen or shop order (a driver search can't wait for a yes).
   */
  private async householdMember(ordererId: string, householdId: string, merchantOrder: boolean): Promise<HouseholdMember> {
    const member = this.households ? await this.households.member(householdId, ordererId) : null;
    if (!member || member.role === 'member') throw new DriverError('household_cannot_order');
    if (!merchantOrder) throw new DriverError('household_wallet_food_only');
    return member;
  }

  /**
   * Whether the payer is asked, by the shared rule, on the member's spend on this wallet this Baghdad
   * month — read in `tx`, under the member's lock (see `placeOnce`).
   */
  private async householdReason(member: HouseholdMember, householdId: string, ordererId: string, totalIqd: number, now: Date, tx: Tx): Promise<HouseholdApprovalReason | null> {
    const { from, to } = baghdadMonthRange(baghdadMonth(now));
    const month = await this.repo.householdOrdersBetween(householdId, [], from, to, tx);
    return householdApproval({
      role: member.role,
      orderLimitIqd: member.spendingLimitIqd,
      monthlyBudgetIqd: member.monthlyBudgetIqd,
      monthSpentIqd: householdMonthSpend(month, householdId, ordererId),
      totalIqd,
    });
  }

  /**
   * Joy r6 («عشاك يوصل وياك»): how long before a delivery time a kitchen must hear of a pre-order —
   * its prep (with today's busy extra) and the scheduled lead `scheduleOffer` uses — and where it is.
   */
  async kitchenTiming(merchantOrgId: string): Promise<{ prepMin: number; leadMin: number; pin: LatLng | null } | null> {
    const profile = await this.merchants.profile(merchantOrgId);
    if (!profile) return null;
    return { prepMin: profile.defaultPrepMin + busyExtraMinutes(profile, this.clock.now()), leadMin: ORDERS_RULES.scheduledLeadMin, pin: profile.location?.pin ?? null };
  }

  /** The kitchen sees the order now, or at T − prep − lead for a scheduled one (review A.12). */
  private async scheduleOffer(order: OrderRecord, profile: MerchantProfile, now: Date, tx: Tx): Promise<void> {
    const leadMin = profile.defaultPrepMin + busyExtraMinutes(profile, now) + ORDERS_RULES.scheduledLeadMin;
    const offerAt = order.scheduledFor ? new Date(order.scheduledFor.getTime() - leadMin * 60_000) : now;
    if (offerAt.getTime() <= now.getTime()) await this.offerToMerchant(order, profile, tx);
    else await this.queue.add(ORDER_JOBS.offerToMerchant, { orderId: order.id }, { delayMs: offerAt.getTime() - now.getTime(), jobId: jobKey('order', order.id, 'offer') });
  }

  /**
   * Joy w4: the payer answered a held order. Yes → the kitchen gets it (now, or at its scheduled
   * time); no → cancelled free (`payer_declined`). Anything else (not held, already moved) is a no-op,
   * so a repeated or late answer changes nothing.
   */
  async onPayerDecision(orderId: string, decision: 'approved' | 'declined'): Promise<void> {
    await this.uow.run(async (tx) => {
      const agg = await this.repo.find(orderId, tx);
      if (!agg || !agg.order.heldForPayer || agg.order.state !== 'placed') return;
      await this.settleHeld(agg.order, decision === 'approved' ? 'approved' : 'payer_declined', tx);
    });
  }

  private async settleHeld(order: OrderRecord, outcome: 'approved' | 'payer_declined' | 'payer_no_answer', tx: Tx): Promise<void> {
    const now = this.clock.now();
    if (outcome === 'approved') {
      const released = await this.repo.update(order.id, { heldForPayer: false }, tx);
      await this.emit(tx, 'order.payer_approved', SYSTEM, released, { householdId: order.householdOrgId });
      const profile = released.merchantOrgId ? await this.merchants.profile(released.merchantOrgId) : null;
      if (profile) await this.scheduleOffer(released, profile, now, tx);
      return;
    }
    await this.move(order, 'platform_cancelled', SYSTEM, tx, { cancelledAt: now, cancellationReason: outcome, cancellationFeeIqd: 0 }, this.cancelled(order, { by: 'platform', reason: outcome, free: true, feeIqd: 0 }));
    if (outcome === 'payer_no_answer' && order.householdOrgId) await this.households?.withdraw(order.householdOrgId, order.id, SYSTEM);
  }

  /**
   * The honest-delay promise's kitchen → door ride, locked into the order at placement (Ali,
   * 2026-10-07: "yes learned data"). It is the one ETA's learned minutes — the router's estimate × the
   * correction finished legs taught for this zone pair, vehicle and traffic bucket, clamped 0.7–1.6,
   * factor 1 when nothing is learned — so the promise agrees with the ETA the customer sees, and,
   * stored, the promise and its late-credit deadline never move as the city keeps learning. A
   * scheduled order is quoted for its slot's bucket. Null when the order carries no promise (the
   * kinds `promisedArrival` in tracking promises: food, catalog grocery; both pins known), and when
   * the ETA cannot be read: placing must not fail on an estimate, and tracking then promises on the
   * router's own minutes as it did before the lock.
   */
  private async lockPromisedRide(
    input: { type: OrderType; dropoff?: DeliveryPoint | undefined; scheduledFor?: Date | undefined },
    kitchen: LatLng | null,
    minVehicleClass: VehicleClass | null,
    now: Date,
  ): Promise<number | null> {
    const door = input.dropoff?.pin ?? null;
    if (!this.eta || !PROMISED_ORDER_TYPES.includes(input.type) || !kitchen || !door) return null;
    try {
      return (await this.eta.minutes(kitchen, door, minVehicleClass ?? 'bike', input.scheduledFor ?? now)).minutes;
    } catch (err) {
      this.logger.warn(`promise ride not locked (router minutes on read instead): ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * `orders.quote` — the checkout summary: exactly what `place` would charge for this input now
   * (menu prices, server fees, the merchant's best deal, the rounded total) plus what each line
   * saves and the next deal the cart could unlock. Nothing is stored or reserved.
   */
  async quote(ordererId: string, raw: PlaceInput): Promise<OrderQuote> {
    const input = PlaceOrderInput.parse(raw);
    const now = this.clock.now();
    const p = await this.price(ordererId, input, now, { quote: true });
    const d = p.discount;
    const next = p.merchantType && !d && input.merchantOrgId ? await this.promotions.nextMerchantDeal(dealQuery(input.merchantOrgId, p.newLines, p.itemsTotal, p.fees.deliveryFeeIqd, now)) : null;
    return {
      itemsTotalIqd: p.itemsTotal,
      deliveryFeeIqd: p.fees.deliveryFeeIqd,
      serviceFeeIqd: p.fees.serviceFeeIqd,
      tipIqd: input.tipIqd,
      discountIqd: d?.amountIqd ?? 0,
      smallOrderFeeIqd: p.smallOrderFee,
      smallOrder: p.minOrderIqd > 0 ? { minOrderIqd: p.minOrderIqd, feeIqd: ORDERS_RULES.smallOrder.feeIqd } : null,
      points: p.points,
      pointsIqd: p.pointsIqd,
      totalIqd: p.totalIqd,
      changeIqd: p.changeIqd,
      discount: d ? { promotionId: d.promotionId, amountIqd: d.amountIqd, ...d.meta, ...roundingOf(d.meta, d.amountIqd) } : null,
      lineSavingsIqd: d ? d.lineSavingsIqd : p.newLines.map(() => 0),
      dealLineSavingsIqd: d ? d.dealLineSavingsIqd : p.newLines.map(() => 0),
      roundingIqd: 0,
      nextDeal: next ? { dealId: next.promotionId, label_ar: next.label_ar, label_en: next.label_en, missingIqd: next.missingIqd } : null,
      latePromise: latePromiseOf(input.type, p.fees.deliveryFeeIqd, d),
      // Joy o7: what this order earns when it closes, by the same formula the close posts with.
      pointsEarn: p.merchantType
        ? orderPoints({
            type: input.type,
            platformRevenueIqd: platformRevenueIqd({
              type: input.type,
              totalIqd: p.totalIqd,
              serviceFeeIqd: p.fees.serviceFeeIqd,
              commissionBaseIqd: Math.max(0, p.itemsTotal - (d?.meta.funder === 'merchant' && d.meta.target === 'items' ? d.amountIqd : 0)),
              commissionPct: commissionPctOf(p.profile?.commissionTier ?? ORDERS_RULES.defaultCommissionTier),
            }),
          })
        : 0,
    };
  }

  /**
   * C-04: what a wallet can still pay — its ledger balance less the customer's open wallet orders
   * (the ledger charges a wallet order when it closes, so an open one already spoke for its total).
   */
  /** What his open orders on his own wallet will still take at close (the tip after rating can't spend it). */
  async openWalletHoldIqd(customerId: string): Promise<number> {
    const mine = await this.repo.forPerson(customerId);
    return mine.filter((o) => o.ordererId === customerId && o.paymentMethod === 'wallet' && !o.householdOrgId && !TERMINAL_ORDER_STATES.includes(o.state)).reduce((a, o) => a + o.totalIqd, 0);
  }

  private async walletAvailable(customerId: string, householdId: string | null): Promise<number> {
    if (!this.wallet) return Number.POSITIVE_INFINITY;
    const [balance, mine] = await Promise.all([this.wallet.balanceIqd({ customerId, householdId }), this.repo.forPerson(customerId)]);
    const held = mine
      .filter((o) => o.ordererId === customerId && o.paymentMethod === 'wallet' && (o.householdOrgId ?? null) === householdId && !TERMINAL_ORDER_STATES.includes(o.state))
      .reduce((a, o) => a + o.totalIqd, 0);
    return balance - held;
  }

  /**
   * W-02: the customer's points an order could take — his ledger points balance less the points his
   * open orders already spoke for (the ledger redeems them when each closes), capped by the delivery
   * fee after a free-delivery deal plus the service fee, and by the price. Null when none apply.
   */
  private async pointsOffer(customerId: string, fees: ServerFees, discount: OrderDiscount | null, priceIqd: number): Promise<{ balance: number; usable: number; valueIqd: number } | null> {
    if (!this.wallet?.pointsBalance) return null;
    const [balance, mine] = await Promise.all([this.wallet.pointsBalance(customerId), this.repo.forPerson(customerId)]);
    const held = mine.filter((o) => o.ordererId === customerId && !TERMINAL_ORDER_STATES.includes(o.state)).reduce((a, o) => a + (o.pointsRedeemed ?? 0), 0);
    const available = Math.max(0, balance - held);
    const deliveryDeal = discount?.meta.funder === 'merchant' && discount.meta.target === 'delivery' ? discount.amountIqd : 0;
    const usable = redeemablePoints({ availablePoints: available, serviceFeeIqd: fees.serviceFeeIqd, deliveryFeeIqd: fees.deliveryFeeIqd - deliveryDeal, priceIqd }, ORDERS_RULES.pointValueIqd);
    if (available <= 0 || usable <= 0) return null;
    return { balance: available, usable, valueIqd: usable * ORDERS_RULES.pointValueIqd };
  }

  /**
   * Prices an order the way `place` charges it: lines from the menu (review C2), fees from the server
   * quote (M2 follow-up), the tip cap, the one discount the server grants (merchant deal or a resolved
   * code, exactly as promised), and what the customer pays: cash rounds up to 250 with the change to
   * his wallet, a wallet pays the exact price (Ali, 2026-10-04). `quote` skips the merchant-closed
   * checks (the checkout shows those itself).
   */
  private async price(ordererId: string, input: z.infer<typeof PlaceOrderInput>, now: Date, opts: { quote: boolean }): Promise<Priced> {
    const merchantType = MERCHANT_ORDER_TYPES.includes(input.type);
    if (merchantType && !input.merchantOrgId) throw new DriverError('merchant_required');
    // Review A.11: one merchant per order; a second merchant starts a second order.
    for (const l of input.lines) if (l.merchantOrgId && l.merchantOrgId !== input.merchantOrgId) throw new DriverError('one_merchant_per_order');
    const lines = input.type === 'ride' ? [] : input.lines;
    if ((merchantType || input.type === 'errand') && lines.length === 0) throw new DriverError('order_empty');

    let profile: MerchantProfile | null = null;
    let storefront: CatalogStorefrontView | null = null;
    if (merchantType) {
      profile = await this.merchants.profile(input.merchantOrgId!);
      if (!profile) throw new DriverError('org_not_found');
      storefront = (await this.catalog.storefront?.(input.merchantOrgId!)) ?? null;
      if (!opts.quote) {
        // Backend review 2026-10-04 (apps #10): the server is open exactly when the card says so —
        // opening hours (a scheduled order is checked at its time: opening time itself is fine), then
        // pause windows at that instant, then an early close (now only). Busy mode only adds prep.
        const at = input.scheduledFor ?? now;
        if (storefront && storefront.hours.length > 0 && !activePauseWindow(at, storefront.hours, DEFAULT_TIMEZONE)) throw new DriverError('merchant_closed');
        if (activePauseWindow(at, profile.pauseWindows, DEFAULT_TIMEZONE)) throw new DriverError('merchant_paused');
        // Closed by hand from the Merchant app (early close): refused like a pause window.
        if (!input.scheduledFor && profile.closed) throw new DriverError('merchant_paused');
      }
    }

    // Review C2: every line is priced here from the merchant's menu, never from the client.
    const newLines: NewLine[] = await priceLines(lines, this.catalog, {
      merchantOrgId: merchantType ? input.merchantOrgId! : null,
      merchantOrder: merchantType,
      branchKey: input.branchKey ?? null,
      now: input.scheduledFor ?? now,
    });
    const itemsTotal = newLines.reduce((a, l) => a + lineValue(l), 0);
    const itemCount = newLines.reduce((a, l) => a + l.qty, 0);
    // J-D6 (Ali, 2026-10-05; replaces apps review #11's refusal): below the restaurant minimum — on the
    // menu-priced items before any deal (a deal's own minimum is the deal engine's) — the order goes
    // ahead with the city's small-order fee, fixed here at placement.
    const minOrderIqd = merchantType && storefront ? storefront.minOrderIqd : 0;
    const smallOrderFee = smallOrderFeeIqd(itemsTotal, minOrderIqd, ORDERS_RULES);
    // M2 review follow-up: fees come from a server quote for the order's vertical, zones and options,
    // locked here; what the client sent is only its expectation and must match (`price_changed`).
    const fees = serverFees(this.pricing, {
      cityId: input.cityId,
      type: input.type,
      rideVertical: input.rideVertical,
      pickup: merchantType ? (profile?.location ?? null) : (input.pickup ?? null),
      dropoff: input.dropoff ?? null,
      options: input.options,
      at: input.scheduledFor ?? now,
    });
    // Tip: the customer's choice, capped per order; it goes 100 % to the courier/driver (ledger `tip`).
    if (input.tipIqd > ORDERS_RULES.maxTipIqd) throw new DriverError('tip_above_cap');
    const preTotal = input.type === 'ride' ? fees.fareIqd + input.tipIqd : itemsTotal + fees.deliveryFeeIqd + fees.serviceFeeIqd + smallOrderFee + input.tipIqd;
    const discount = await this.discountFor(ordererId, input, { merchantType, newLines, itemsTotal, fees, preTotal, now });
    const beforePoints = Math.max(0, preTotal - (discount?.amountIqd ?? 0));
    // W-02 / J-D10: points pay the delivery fee (after a free-delivery deal) first, then the service
    // fee; never more than the customer has free (balance less his open orders) or than the price.
    const points = merchantType ? await this.pointsOffer(ordererId, fees, discount, beforePoints) : null;
    const pointsRedeemed = input.usePoints === true && points ? points.usable : 0;
    const pointsIqd = pointsRedeemed * ORDERS_RULES.pointValueIqd;
    const priceIqd = Math.max(0, beforePoints - pointsIqd);
    const { totalIqd, changeIqd } = payable(input.type, input.paymentMethod, priceIqd);
    const caps = merchantType || input.type === 'errand' ? vehicleRequirement(itemsTotal, itemCount) : null;
    return { merchantType, profile, newLines, itemsTotal, fees, discount, minOrderIqd, smallOrderFee, points, pointsRedeemed, pointsIqd, totalIqd, changeIqd, caps };
  }

  /**
   * The order's one discount (domain §11: no stacking, best for the customer wins): the merchant's
   * best live deal (auto-applied) or a promo code the server resolves (a code nothing resolves is
   * `promotion_invalid`). Applied exactly as promised, never more than the order (Ali, 2026-10-04: the
   * total is no longer bent onto a step by trimming the deal — cash rounding is change to the wallet),
   * so the funder pays exactly what the deal promises. Deals are evaluated at the placement instant
   * (clock port, Baghdad days/hours). Rides, errands and parcels take no discount yet.
   */
  private async discountFor(
    customerId: string,
    input: z.infer<typeof PlaceOrderInput>,
    o: { merchantType: boolean; newLines: readonly NewLine[]; itemsTotal: number; fees: ServerFees; preTotal: number; now: Date },
  ): Promise<OrderDiscount | null> {
    const code = await this.promotionFor(customerId, input, { itemsTotalIqd: o.itemsTotal, deliveryFeeIqd: o.fees.deliveryFeeIqd, serviceFeeIqd: o.fees.serviceFeeIqd, at: o.now });
    const deal = o.merchantType && input.merchantOrgId ? await this.promotions.merchantDeal(dealQuery(input.merchantOrgId, o.newLines, o.itemsTotal, o.fees.deliveryFeeIqd, o.now)) : null;
    let chosen: OrderDiscount;
    if (deal && (!code || deal.discountIqd >= code.discountIqd)) {
      chosen = {
        promotionId: deal.promotionId,
        amountIqd: deal.discountIqd,
        lineSavingsIqd: deal.lineSavingsIqd,
        dealLineSavingsIqd: deal.lineSavingsIqd,
        meta: { funder: 'merchant', target: deal.target, type: deal.type, label_ar: deal.label_ar, label_en: deal.label_en },
      };
    } else if (code) {
      chosen = {
        promotionId: code.promotionId,
        amountIqd: code.discountIqd,
        lineSavingsIqd: o.newLines.map(() => 0),
        dealLineSavingsIqd: o.newLines.map(() => 0),
        meta: { funder: 'platform', target: 'order', type: null, label_ar: PLATFORM_PROMO_LABEL.ar, label_en: PLATFORM_PROMO_LABEL.en },
      };
    } else {
      return null;
    }
    const amountIqd = Math.min(chosen.amountIqd, Math.max(0, o.preTotal));
    if (amountIqd <= 0) return null;
    const lineSavingsIqd = chosen.meta.target === 'items' && amountIqd !== chosen.amountIqd ? trimSavings(chosen.lineSavingsIqd, chosen.amountIqd - amountIqd) : chosen.lineSavingsIqd;
    // `dealIqd` on the stored meta is the receipt's deal line; with the exact deal it equals `amountIqd`.
    return { ...chosen, amountIqd, lineSavingsIqd, dealLineSavingsIqd: lineSavingsIqd, meta: { ...chosen.meta, dealIqd: amountIqd } };
  }

  /**
   * A promo code needs a promotion the server resolves (M2 review follow-up). No code → null; a code
   * nothing resolves is refused. Rides, errands and parcels take no promotion yet (their ledger money
   * facts have no promo line).
   */
  private async promotionFor(
    customerId: string,
    input: z.infer<typeof PlaceOrderInput>,
    amounts: { itemsTotalIqd: number; deliveryFeeIqd: number; serviceFeeIqd: number; at: Date },
  ): Promise<ResolvedPromotion | null> {
    if (!input.promoCode) return null;
    if (!MERCHANT_ORDER_TYPES.includes(input.type)) throw new DriverError('promotion_invalid');
    const promo = await this.promotions.resolve({ customerId, cityId: input.cityId, orderType: input.type, code: input.promoCode, ...amounts });
    if (!promo) throw new DriverError('promotion_invalid');
    const ceiling = amounts.itemsTotalIqd + amounts.deliveryFeeIqd + amounts.serviceFeeIqd;
    return { promotionId: promo.promotionId, discountIqd: Math.max(0, Math.min(promo.discountIqd, ceiling)) };
  }

  /**
   * Partial accept with a merchant deal: the same deal re-priced on the lines left (schedule and cap
   * aside — the order already holds its spend), exactly, and never above what the order had. Null
   * when the order has no merchant deal.
   */
  private async reducedDiscount(order: OrderRecord, kept: readonly OrderLineRecord[], keptItemsIqd: number, now: Date): Promise<number | null> {
    const deal = merchantDealOf(order);
    if (!deal || !order.merchantOrgId) return null;
    const again = await this.promotions.reapplyMerchantDeal(deal.promotionId, dealQuery(order.merchantOrgId, kept, keptItemsIqd, order.deliveryFeeIqd, now));
    const preTotal = keptItemsIqd + order.deliveryFeeIqd + order.serviceFeeIqd + order.tipIqd;
    return Math.min(deal.amountIqd, Math.max(0, Math.min(again?.discountIqd ?? 0, preTotal)));
  }

  /**
   * The merchant sees the order (review A.12: scheduled orders arrive at T − prep − 10 min).
   * Auto-accept merchants (domain §2) skip acceptance; everyone else gets the 90-s clock.
   */
  private async offerToMerchant(order: OrderRecord, profile: MerchantProfile, tx: Tx): Promise<void> {
    if (order.merchantOfferedAt || order.state !== 'placed' || order.heldForPayer) return;
    const now = this.clock.now();
    const offered = await this.repo.update(order.id, { merchantOfferedAt: now }, tx);
    const catering = order.itemsTotalIqd > CATERING_ABOVE_IQD;
    await this.emit(tx, 'order.offered_to_merchant', SYSTEM, offered, {
      merchantOrgId: order.merchantOrgId,
      acceptBy: new Date(now.getTime() + ORDERS_RULES.merchantAcceptSec * 1000).toISOString(),
      autoAccept: profile.autoAccept && !catering,
    });
    if (profile.autoAccept && !catering) {
      await this.accept(offered, profile.defaultPrepMin, SYSTEM, tx, { auto: true });
      return;
    }
    await this.queue.add(ORDER_JOBS.autoReject, { orderId: order.id, refMs: now.getTime() }, { delayMs: ORDERS_RULES.merchantAcceptSec * 1000, jobId: jobKey('order', order.id, 'autoReject', now.getTime()) });
  }

  // ───────────────────────── merchant side ─────────────────────────

  /**
   * Merchant accepts with a prep time. Listing unavailable lines opens the partial-accept flow
   * (review A.4) instead: the customer has 60 s to approve the reduced order or cancel free.
   */
  async merchantAccept(actorId: string, input: { orderId: string; prepMinutes: number; unavailableLineIds?: string[] | undefined }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const agg = await this.load(input.orderId, tx);
      const order = agg.order;
      if (!MERCHANT_ORDER_TYPES.includes(order.type) || order.state !== 'placed' || !order.merchantOfferedAt) throw new DriverError('order_state_conflict');
      if (pendingProposal(agg.lines)) throw new DriverError('order_state_conflict');
      const unavailable = [...new Set(input.unavailableLineIds ?? [])];
      if (unavailable.length === 0) {
        await this.accept(order, input.prepMinutes, actorId, tx, { auto: false });
        return this.view(order.id, tx);
      }
      const ids = new Set(agg.lines.map((l) => l.id));
      if (unavailable.some((id) => !ids.has(id)) || unavailable.length >= agg.lines.length) throw new DriverError('partial_accept_invalid');
      const now = this.clock.now();
      const removed = agg.lines.filter((l) => unavailable.includes(l.id)).reduce((a, l) => a + lineValue(l), 0);
      // A merchant deal is re-priced on what is left (it can only shrink); the customer approves that figure.
      const reducedDiscount = await this.reducedDiscount(order, agg.lines.filter((l) => !unavailable.includes(l.id)), order.itemsTotalIqd - removed, now);
      const marker: LineUnavailability = { kind: 'unavailable', state: 'proposed', proposedAt: now.toISOString(), prepMinutes: input.prepMinutes, ...(reducedDiscount !== null ? { reducedDiscountIqd: reducedDiscount } : {}) };
      for (const id of unavailable) await this.repo.updateLine(id, { substitution: marker }, tx);
      const deadline = new Date(now.getTime() + ORDERS_RULES.partialApprovalSec * 1000);
      await this.emit(tx, 'order.partial_proposed', actorId, order, {
        unavailableLineIds: unavailable,
        reducedItemsTotalIqd: order.itemsTotalIqd - removed,
        reducedTotalIqd: reducedTotalOf(order, removed, reducedDiscount),
        deadline: deadline.toISOString(),
        prepMinutes: input.prepMinutes,
      });
      await this.queue.add(ORDER_JOBS.partialTimeout, { orderId: order.id, refMs: now.getTime() }, { delayMs: ORDERS_RULES.partialApprovalSec * 1000, jobId: jobKey('order', order.id, 'partial', now.getTime()) });
      return this.view(order.id, tx);
    });
  }

  /**
   * Merchant rejects. Before acceptance it is a plain rejection (scored); after acceptance it is a
   * late rejection: scoring hit + 500 customer credit funded by the merchant (spec §4).
   */
  async merchantReject(actorId: string, input: { orderId: string; reason: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (!MERCHANT_ORDER_TYPES.includes(order.type)) throw new DriverError('order_state_conflict');
      const late = order.state === 'merchant_accepted' || order.state === 'preparing';
      const now = this.clock.now();
      const next = await this.move(order, 'merchant_rejected', actorId, tx, { cancelledAt: now, cancellationReason: input.reason }, {
        reason: input.reason,
        auto: false,
        scored: true,
        afterAccept: late,
        customerCreditIqd: late ? ORDERS_RULES.merchantLateRejectCreditIqd : 0,
        creditFundedBy: late ? 'merchant' : null,
      });
      await this.releaseTrip(next, 'merchant_rejected');
      return this.view(order.id, tx);
    });
  }

  async markPreparing(actorId: string, input: { orderId: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      await this.move(order, 'preparing', actorId, tx, { preparingAt: this.clock.now() });
      return this.view(order.id, tx);
    });
  }

  async markReady(actorId: string, input: { orderId: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.state === 'ready') return this.view(order.id, tx);
      await this.move(order, 'ready', actorId, tx, { readyAt: this.clock.now() });
      return this.view(order.id, tx);
    });
  }

  /**
   * "+5 د" (Ali, 2026-10-04, M-12): once per order, while accepted or being prepared, the kitchen may
   * push its promised ready time by 5 minutes. The courier timing and the customer's ETA read the new
   * time; the overdue and courier-release checks move with it; `order.prep_extended` tells the
   * customer ("المطعم زاد 5 دقايق"). A second extension is refused (`prep_already_extended`).
   */
  async merchantExtendPrep(actorId: string, input: { orderId: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (!MERCHANT_ORDER_TYPES.includes(order.type) || (order.state !== 'merchant_accepted' && order.state !== 'preparing') || !order.promisedReadyAt) throw new DriverError('order_state_conflict');
      if (order.prepExtendedAt) throw new DriverError('prep_already_extended');
      const now = this.clock.now();
      const minutes = MERCHANT_PREP_EXTENSION.minutes;
      const promisedReadyAt = new Date(order.promisedReadyAt.getTime() + minutes * 60_000);
      const next = await this.repo.updateIf(order.id, order.state, { promisedReadyAt, prepExtendedAt: now }, tx);
      if (!next) throw new DriverError('order_state_conflict');
      // The old checks carry the old promise as their ref and turn into no-ops; these replace them.
      const ref = promisedReadyAt.getTime();
      const untilReady = Math.max(0, ref - now.getTime());
      await this.queue.add(ORDER_JOBS.readyOverdue, { orderId: order.id, refMs: ref }, { delayMs: untilReady + ORDERS_RULES.readyOverdueMin * 60_000, jobId: jobKey('order', order.id, 'readyOverdue', ref) });
      await this.queue.add(ORDER_JOBS.courierRelease, { orderId: order.id, refMs: ref }, { delayMs: untilReady + ORDERS_RULES.courierReleaseMin * 60_000, jobId: jobKey('order', order.id, 'courierRelease', ref) });
      await this.emit(tx, 'order.prep_extended', actorId, next, {
        merchantOrgId: order.merchantOrgId,
        minutes,
        from: order.promisedReadyAt.toISOString(),
        promisedReadyAt: promisedReadyAt.toISOString(),
      });
      return this.view(order.id, tx);
    });
  }

  /**
   * "سلّمته" (UI/UX audit S-M4): the kitchen records handing the order to the courier at the pass.
   * Allowed once the order is ready and its courier is at the counter (or has already confirmed the
   * pickup himself); records `handed_over_at` and `order.handed_over` (with the courier and how long
   * he waited) on the order's history. Idempotent: a second tap returns the order unchanged. No state
   * or money moves: the courier's own pickup does that.
   */
  async merchantHandOver(actorId: string, input: { orderId: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.handedOverAt) return this.view(order.id, tx);
      if (!MERCHANT_ORDER_TYPES.includes(order.type) || !HAND_OVER_STATES.includes(order.state)) throw new DriverError('order_state_conflict');
      const trip = await this.trips.activeForOrder(order.id);
      const courierId = trip?.courierId ?? (await this.trips.courierOf(order.id))?.courierId ?? null;
      if (!courierId) throw new DriverError('order_state_conflict');
      const pickup = trip?.stops.find((s) => s.orderId === order.id && s.type === 'pickup') ?? null;
      const atCounter = order.state === 'picked_up' || pickup?.state === 'arrived' || pickup?.state === 'completed' || (trip ? AT_OR_PAST_PICKUP.includes(trip.state) : false);
      if (!atCounter) throw new DriverError('order_state_conflict');
      const now = this.clock.now();
      const next = await this.repo.updateIf(order.id, order.state, { handedOverAt: now }, tx);
      if (!next) throw new DriverError('order_state_conflict');
      const arrivedAt = pickup?.arrivedAt ?? null;
      await this.emit(tx, 'order.handed_over', actorId, next, {
        merchantOrgId: order.merchantOrgId,
        courierId,
        tripId: trip?.id ?? null,
        at: now.toISOString(),
        waitedSec: arrivedAt ? Math.max(0, Math.round((now.getTime() - arrivedAt.getTime()) / 1000)) : null,
      });
      return this.view(order.id, tx);
    });
  }

  async merchantHeartbeat(merchantOrgId: string): Promise<void> {
    await this.merchants.heartbeat(merchantOrgId, this.clock.now());
  }

  // ───────────────────────── customer side ─────────────────────────

  /** Partial-accept answer (review A.4): approve the reduced order, or cancel free. */
  async respondPartial(actorId: string, input: { orderId: string; approve: boolean }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const agg = await this.load(input.orderId, tx);
      const order = agg.order;
      if (order.ordererId !== actorId) throw new DriverError('forbidden');
      const proposal = pendingProposal(agg.lines);
      const now = this.clock.now();
      if (!proposal || order.state !== 'placed' || now.getTime() > proposal.proposedAt.getTime() + ORDERS_RULES.partialApprovalSec * 1000) {
        throw new DriverError('partial_accept_not_pending');
      }
      if (!input.approve) {
        for (const l of proposal.lines) await this.repo.updateLine(l.id, { substitution: { ...l.substitution!, state: 'restored' } }, tx);
        await this.emit(tx, 'order.partial_declined', actorId, order, { unavailableLineIds: proposal.lines.map((l) => l.id) });
        await this.move(order, 'customer_cancelled', actorId, tx, { cancelledAt: now, cancellationReason: 'partial_declined', cancellationFeeIqd: 0 }, this.cancelled(order, { by: 'customer', reason: 'partial_declined', free: true, feeIqd: 0 }));
        return this.view(order.id, tx);
      }
      for (const l of proposal.lines) await this.repo.updateLine(l.id, { substitution: { ...l.substitution!, state: 'removed' } }, tx);
      const removed = proposal.lines.reduce((a, l) => a + lineValue(l), 0);
      const keptDiscount = proposal.reducedDiscountIqd;
      const deal = merchantDealOf(order);
      if (deal && keptDiscount !== null && keptDiscount < deal.amountIqd) await this.promotions.release(deal.promotionId, deal.amountIqd - keptDiscount, tx);
      const reduced = await this.repo.update(
        order.id,
        {
          itemsTotalIqd: order.itemsTotalIqd - removed,
          totalIqd: reducedTotalOf(order, removed, keptDiscount),
          ...(deal && keptDiscount !== null
            ? {
                discountIqd: keptDiscount,
                // Re-priced on fewer lines: the stored exact saving no longer applies; the receipt shows the kept discount unsplit.
                ...(keptDiscount === 0 ? { promotionId: null, discountMeta: null } : keptDiscount !== order.discountIqd && order.discountMeta ? { discountMeta: withoutDealSplit(order.discountMeta) } : {}),
              }
            : {}),
        },
        tx,
      );
      await this.emit(tx, 'order.partial_approved', actorId, order, { removedLineIds: proposal.lines.map((l) => l.id), removedIqd: removed, itemsTotalIqd: reduced.itemsTotalIqd, totalIqd: reduced.totalIqd });
      await this.accept(reduced, proposal.prepMinutes, actorId, tx, { auto: false, partial: true });
      return this.view(order.id, tx);
    });
  }

  /** Fee the customer would pay to cancel now (dispatch & pricing §4). */
  async cancellationPreview(orderId: string): Promise<CancellationFee> {
    const { order } = await this.load(orderId);
    return (await this.feeFor(order)).fee;
  }

  /**
   * Customer cancellation: free until the merchant accepts (or, scheduled, until it was offered),
   * fee after, never after pickup (that is a dispute). Rides cancel their trip; deliveries are
   * detached from theirs (the courier en route gets 500 of the fee).
   */
  async cancel(actorId: string, input: { orderId: string; reason?: string | undefined }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.ordererId !== actorId) throw new DriverError('forbidden');
      if (order.state === 'customer_cancelled') return this.view(order.id, tx);
      const { fee, trip } = await this.feeFor(order);
      if (!fee.allowed) throw new DriverError(order.state === 'picked_up' ? 'order_cancel_after_pickup' : 'order_state_conflict');
      const now = this.clock.now();
      const reason = input.reason ?? 'customer_request';
      await this.move(
        order,
        'customer_cancelled',
        actorId,
        tx,
        { cancelledAt: now, cancellationReason: reason, cancellationFeeIqd: fee.amountIqd },
        this.cancelled(order, { by: 'customer', reason, free: fee.free, feeIqd: fee.amountIqd, beneficiaries: beneficiariesOf(fee, order, trip), tripId: trip?.id, label_ar: fee.label_ar, reason_ar: fee.reason_ar }),
      );
      if (trip) {
        if (order.type === 'ride') await this.trips.cancel(trip.id, 'customer', actorId, reason);
        else await this.trips.detachOrder(trip.id, order.id, actorId, 'order_cancelled');
      }
      // Joy w4: a held order the orderer cancelled stops asking the payer.
      if (order.heldForPayer && order.householdOrgId) await this.households?.withdraw(order.householdOrgId, order.id, actorId);
      return this.view(order.id, tx);
    });
  }

  /** Domain §9: the customer may open a dispute until `closed`; after that, support only. */
  async openDispute(actorId: string, input: { orderId: string; kind: DisputeKind; note?: string | undefined }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.ordererId !== actorId) throw new DriverError('forbidden');
      if (order.state === 'disputed') return this.view(order.id, tx);
      if (order.state === 'closed' || order.state === 'refunded') throw new DriverError('dispute_window_closed');
      if (!DISPUTABLE_STATES.includes(order.state)) throw new DriverError('order_state_conflict');
      await this.move(order, 'disputed', actorId, tx, {}, { kind: input.kind, note: input.note ?? null, openedBy: 'customer', evidence: await this.evidence(order) });
      return this.view(order.id, tx);
    });
  }

  /**
   * Rating closes the order early (domain §2). With scores (customer app §4 two-tap rating) it also
   * stores them: delivery for the courier/driver, food only on kitchen/shop orders. The first rating
   * stands (a replay returns the order unchanged); an order auto-closed before the customer rated can
   * still take its rating.
   */
  async rate(actorId: string, input: RateOrderInput): Promise<Order> {
    // A double tap racing the first rating (RDB-04): the loser reads the order the winner rated.
    return this.rateOnce(actorId, input).catch(async (err: unknown) => {
      const again = isUniqueViolation(err) || (err instanceof DriverError && err.code === 'order_state_conflict') ? await this.repo.find(input.orderId) : null;
      if (!again?.order.ratedAt || again.order.ordererId !== actorId) throw err;
      return this.view(again.order.id);
    });
  }

  private async rateOnce(actorId: string, input: RateOrderInput): Promise<Order> {
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.ordererId !== actorId) throw new DriverError('forbidden');
      const now = this.clock.now();
      const rating = ratingFrom(order, input, now);
      if (order.rating) return this.view(order.id, tx);
      if (rating && ratingWindowClosed(order, now)) throw new DriverError('rating_window_closed');
      // Rate the courier (before-launch §6): his own row, one per order, for his scorecard and his card.
      if (rating?.delivery) await this.recordCourierRating(order, rating, tx);
      // A closed order still takes its rating; so does one under dispute (the low-rating flow opens
      // the complaint first, audit C-12) — stored without closing it, the case stays with support.
      if (order.state === 'closed' || order.state === 'disputed') {
        if (rating) await this.repo.update(order.id, { rating, ratedAt: order.ratedAt ?? rating.ratedAt }, tx);
        return this.view(order.id, tx);
      }
      if (!DISPUTABLE_STATES.includes(order.state)) throw new DriverError('order_state_conflict');
      const updated = await this.repo.update(order.id, { ratedAt: this.clock.now(), ...(rating ? { rating } : {}) }, tx);
      await this.close(updated, actorId, 'rated', tx);
      return this.view(order.id, tx);
    });
  }

  /**
   * The courier/driver who carried the order gets the delivery score as his own rating row (unique per
   * order: a concurrent second rating fails the insert and its transaction). No driver ever took it
   * (a pickup that never left) → nothing to record.
   */
  private async recordCourierRating(order: OrderRecord, rating: OrderRating, tx: Tx): Promise<void> {
    if (!rating.delivery) return;
    const carrier = await this.trips.courierOf(order.id);
    if (!carrier) return;
    if (await this.repo.courierRatingOf(order.id, tx)) return;
    await this.repo.addCourierRating(
      { orderId: order.id, tripId: carrier.tripId, driverId: carrier.courierId, customerId: order.ordererId, score: rating.delivery, reasons: [...(rating.courierReasons ?? [])], ratedAt: rating.ratedAt },
      tx,
    );
  }

  /**
   * A driver's newest courier ratings (`courier_ratings`, newest first, at most `limit` — the scorecard
   * and the card's public rating read the last `COURIER_RATING_WINDOW`).
   */
  async courierRatings(driverId: string, limit: number = COURIER_RATING_WINDOW): Promise<Array<{ orderId: string; score: number; reasons: string[]; at: Date }>> {
    return (await this.repo.courierRatingsOf(driverId, limit)).map((r) => ({ orderId: r.orderId, score: r.score, reasons: [...r.reasons], at: r.ratedAt }));
  }

  /**
   * Customer-side ride completion (review B.24): the orderer or the rider taps "وصلت" and the ride
   * completes at the locked quote, even with the driver's phone dead.
   */
  async confirmRideArrived(actorId: string, input: { orderId: string }): Promise<Order> {
    return this.uow.run(async (tx) => {
      const agg = await this.load(input.orderId, tx);
      const order = agg.order;
      const isRider = agg.participants.some((p) => p.role === 'rider' && p.personId === actorId);
      if (order.ordererId !== actorId && !isRider) throw new DriverError('forbidden');
      if (order.type !== 'ride') throw new DriverError('order_type_not_supported');
      if (order.state === 'completed') return this.view(order.id, tx);
      if (order.state !== 'matched') throw new DriverError('order_state_conflict');
      const trip = await this.trips.activeForOrder(order.id);
      if (!trip) throw new DriverError('trip_not_found');
      await this.trips.customerComplete(trip.id, actorId);
      await this.completeRide(order, actorId, tx, { by: 'customer', tripId: trip.id });
      return this.view(order.id, tx);
    });
  }

  /**
   * «أني نازل» (joy spec J-D8): the courier is at the door and the unreachable countdown runs; the
   * orderer (or anyone on the order) answers and the courier must wait 2 more minutes, once. Money
   * is untouched: if the customer still never comes, the same unreachable default applies, later.
   */
  async comingOut(actorId: string, input: { orderId: string }): Promise<ComingOutResult> {
    const agg = await this.load(input.orderId);
    const order = agg.order;
    if (order.ordererId !== actorId && !agg.participants.some((p) => p.personId === actorId)) throw new DriverError('forbidden');
    const trip = await this.trips.activeForOrder(order.id);
    if (!trip?.unreachable) throw new DriverError('unreachable_not_active');
    const res = await this.trips.extendUnreachable(trip.id, order.id, actorId);
    const status = res.trip.unreachable;
    if (!status) throw new DriverError('unreachable_not_active');
    return { extended: res.extended, failAllowedAt: status.failAllowedAt };
  }

  /**
   * J-D7: a ride nobody took within the city's free-cancel time (180 s) may switch to the other
   * vehicle. Only the orderer, only while it is still `placed` with no driver on its trip. A ride booked
   * for someone else (c9: one rider whose name the booker gave, in the vault) keeps its rider; one with
   * any other participant does not switch. The pickup and drop-off are the trip's own, so the quote is
   * for exactly the same journey.
   */
  private async switchable(
    actorId: string,
    orderId: string,
  ): Promise<{ order: OrderRecord; to: RideVertical; pickup: DeliveryPoint; dropoff: DeliveryPoint; availableAt: Date; rider: ResolvedRider | null }> {
    const agg = await this.load(orderId);
    const order = agg.order;
    if (order.ordererId !== actorId) throw new DriverError('forbidden');
    const only = agg.participants.length === 1 ? agg.participants[0] : undefined;
    const name = only?.role === 'rider' && only.personId ? (await this.riderNames([only.id], actorId, 'ride_switch'))[only.id] : null;
    const rider = only?.personId && name ? { personId: only.personId, phoneHash: only.phoneHash, name } : null;
    if (order.type !== 'ride' || order.state !== 'placed' || (agg.participants.length > 0 && !rider)) throw new DriverError('ride_switch_unavailable');
    const trip = await this.trips.activeForOrder(order.id);
    const from = trip?.vertical;
    if (!trip || trip.courierId || trip.acceptedAt || (from !== 'taxi' && from !== 'tuktuk')) throw new DriverError('ride_switch_unavailable');
    const afterSec = this.pricing.freeCancelAfterSec?.(order.cityId, from) ?? RIDE_FREE_CANCEL_FALLBACK_SEC;
    const availableAt = new Date(order.placedAt.getTime() + afterSec * 1000);
    if (this.clock.now().getTime() < availableAt.getTime()) throw new DriverError('ride_switch_unavailable');
    const stop = (type: 'pickup' | 'dropoff') => trip.stops.find((s) => s.type === type && s.orderId === order.id);
    const p = stop('pickup');
    const d = stop('dropoff');
    if (!p) throw new DriverError('ride_switch_unavailable');
    const pickup: DeliveryPoint = { zoneKey: p.zoneKey, ...(p.target ? { pin: p.target } : {}) };
    const dropoff: DeliveryPoint = order.dropoff ?? (d ? { zoneKey: d.zoneKey, ...(d.target ? { pin: d.target } : {}) } : pickup);
    return { order, to: from === 'taxi' ? 'tuktuk' : 'taxi', pickup, dropoff, availableAt, rider };
  }

  /** `orders.rideSwitchQuote`: the other vehicle's fare for the same journey, now (nothing stored). */
  async rideSwitchQuote(actorId: string, input: { orderId: string; doorPickup: boolean }): Promise<RideSwitchQuote> {
    const s = await this.switchable(actorId, input.orderId);
    const fees = serverFees(this.pricing, { cityId: s.order.cityId, type: 'ride', rideVertical: s.to, pickup: s.pickup, dropoff: s.dropoff, options: { doorPickup: input.doorPickup }, at: this.clock.now() });
    const { totalIqd } = payable('ride', s.order.paymentMethod, fees.fareIqd + s.order.tipIqd);
    return { vertical: s.to, fareIqd: fees.fareIqd, totalIqd, availableAt: s.availableAt };
  }

  /**
   * `orders.switchRideVehicle`: the customer confirmed the other vehicle at `fareIqd`. One unit of
   * work: the search is cancelled for free (`switched_vehicle`) and the new ride is placed through the
   * normal `place` path (server fare checked again, cash caps, wallet cover). A retry with the same key
   * answers with the ride it already placed.
   */
  async switchRideVehicle(actorId: string, input: { orderId: string; doorPickup: boolean; fareIqd: number; clientRequestId: string }): Promise<Order> {
    const { order: old } = await this.load(input.orderId);
    if (old.ordererId !== actorId) throw new DriverError('forbidden');
    const prior = await this.repo.findByClientRequest(actorId, input.clientRequestId);
    if (prior && prior.order.type === 'ride' && prior.order.id !== old.id) return this.view(prior.order.id);
    const quote = await this.rideSwitchQuote(actorId, input);
    if (quote.fareIqd !== input.fareIqd) throw new DriverError('price_changed');
    const s = await this.switchable(actorId, input.orderId);
    const next = PlaceOrderInput.parse({
      cityId: s.order.cityId,
      type: 'ride',
      rideVertical: s.to,
      fareIqd: input.fareIqd,
      tipIqd: s.order.tipIqd,
      options: { doorPickup: input.doorPickup },
      paymentMethod: s.order.paymentMethod,
      pickup: s.pickup,
      dropoff: s.dropoff,
      ...(s.order.householdOrgId ? { householdOrgId: s.order.householdOrgId } : {}),
      ...(s.order.courierNote ? { courierNote: s.order.courierNote } : {}),
      // Ride step 3 (s6): «عوائل» carries over to the other vehicle.
      ...(s.order.familyPreferred ? { familyPreferred: true } : {}),
      // x5: so do the rider's bags.
      ...(s.order.rideCargo?.length ? { rideCargo: [...s.order.rideCargo] } : {}),
      clientRequestId: input.clientRequestId,
    });
    return this.uow.run(async () => {
      await this.cancel(actorId, { orderId: s.order.id, reason: 'switched_vehicle' });
      // c9: the rider and the name the booker gave them go with the ride to the other vehicle.
      return this.placeOnce(actorId, next, s.rider ? { rider: s.rider } : {});
    });
  }

  // ───────────────────────── trip events ─────────────────────────

  /**
   * Reacts to published trip events (at-least-once, so every branch re-checks state and is a no-op
   * on replay): ride matched on accept; picked up / delivered on stop hand-overs (with the cash
   * collection events of edge-case §3); unreachable failure → dispute with the default outcome;
   * driver cancellation after pickup → dispute (courier pays the food); rider completion.
   */
  async onTripEvent(e: TripEventEnvelope): Promise<void> {
    const p = e.payload;
    const ids = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]) : []);
    switch (e.type) {
      case 'trip.accepted':
        for (const id of ids('orderIds')) await this.whenOrder(id, (o, tx) => (o.type === 'ride' && o.state === 'placed' ? this.move(o, 'matched', e.actorId, tx, {}, { tripId: e.tripId, driverId: e.actorId }) : undefined));
        return;
      case 'stop.completed': {
        if (!e.orderId) return;
        const stopType = p['stopType'];
        if (stopType === 'pickup' || stopType === 'shop') await this.whenOrder(e.orderId, (o, tx) => this.pickedUp(o, e, tx));
        if (stopType === 'dropoff') await this.whenOrder(e.orderId, (o, tx) => this.delivered(o, e, tx));
        return;
      }
      case 'trip.completed':
        for (const id of ids('orderIds')) await this.whenOrder(id, (o, tx) => (o.type === 'ride' && o.state === 'matched' ? this.completeRide(o, e.actorId, tx, { by: String(p['by'] ?? 'driver'), tripId: e.tripId }) : undefined));
        return;
      case 'trip.order_failed':
      case 'trip.failed': {
        const failed = e.type === 'trip.order_failed' ? (e.orderId ? [e.orderId] : []) : ids('orderIds');
        for (const id of failed) await this.whenOrder(id, (o, tx) => this.unreachableDispute(o, e, tx));
        return;
      }
      case 'trip.cancelled':
        await this.onTripCancelled(e);
        return;
      default:
        return;
    }
  }

  // ───────────────────────── reads ─────────────────────────

  async get(orderId: string): Promise<Order> {
    return this.view(orderId);
  }

  async listActive(filter: { cityId?: string | undefined; merchantOrgId?: string | undefined }): Promise<Order[]> {
    // The state filter goes to the query: the honest-delay sweep and the Console poll this every few seconds.
    const live = await this.repo.findMany({ ...(filter.cityId ? { cityId: filter.cityId } : {}), ...(filter.merchantOrgId ? { merchantOrgId: filter.merchantOrgId } : {}), states: ACTIVE_ORDER_STATES });
    return Promise.all(live.map((o) => this.view(o.id)));
  }

  async listForPerson(personId: string): Promise<Order[]> {
    const orders = await this.repo.forPerson(personId);
    return Promise.all(orders.map((o) => this.view(o.id)));
  }

  /**
   * Ride ideas c9/s3: the orders as `accessorId` reads them, a ride he booked for someone else carrying
   * the name he gave its rider (`Order.rider`: «مشوار ماما»). Only the booker's own rides: the rider
   * reads the ride as his own, the driver reads the name through `riderOf`. The first read of each name
   * is a logged vault read.
   */
  async withRiders(input: Order[], accessorId: string, purpose = 'ride_rider_name'): Promise<Order[]> {
    const orders = await this.withRecipients(input, accessorId, 'order_recipient_name', (o) => o.ordererId === accessorId || o.participants.some((p) => p.personId === accessorId));
    const riderOf = (o: Order) => (o.type === 'ride' && o.ordererId === accessorId ? o.participants.find((p) => p.role === 'rider' && p.personId) : undefined);
    const ids = orders.flatMap((o) => riderOf(o)?.id ?? []);
    if (ids.length === 0 || !this.riders) return orders;
    const names = await this.riderNames(ids, accessorId, purpose);
    return orders.map((o) => {
      const p = riderOf(o);
      const name = p ? names[p.id] : null;
      return name ? { ...o, rider: { name } } : o;
    });
  }

  /** SEC-14: recipients' names (vault, logged per reader) on the orders `which` allows; the caller authorises. */
  async withRecipients(orders: Order[], accessorId: string, purpose: string, which: (o: Order) => boolean = () => true): Promise<Order[]> {
    const ids = recipientIds(orders.filter(which));
    return ids.length === 0 || !this.riders ? orders : withRecipientLabels(orders, await this.riderNames(ids, accessorId, purpose));
  }

  /**
   * c9/s3: the rider of a ride booked for someone else — the person and the name the booker gave them —
   * for the driver of the ride and for notify; null for any other order. The read is logged.
   */
  async riderOf(orderId: string, accessorId: string, purpose: string): Promise<{ personId: string; name: string } | null> {
    const agg = await this.repo.find(orderId);
    if (!agg || agg.order.type !== 'ride' || !this.riders) return null;
    const p = agg.participants.find((x) => x.role === 'rider' && x.personId);
    if (!p?.personId) return null;
    const name = (await this.riderNames([p.id], accessorId, purpose))[p.id];
    return name ? { personId: p.personId, name } : null;
  }

  /**
   * c9: the rider the choose screen picked. `recent` is the rider of one of the booker's own earlier
   * rides («آخر من حجزتلهم»): the same person and the name he gave them then; the rest go to the port.
   */
  private async resolveRider(ordererId: string, input: NonNullable<z.output<typeof PlaceOrderInput>['rider']>): Promise<ResolvedRider> {
    if (!this.riders) throw new DriverError('internal');
    if (input.from !== 'recent') return this.riders.resolve(ordererId, input);
    const agg = await this.repo.find(input.orderId);
    const p = agg && agg.order.ordererId === ordererId && agg.order.type === 'ride' ? agg.participants.find((x) => x.role === 'rider' && x.personId) : undefined;
    if (!p?.personId) throw new DriverError('ride_rider_unknown');
    const name = (await this.riders.names([p.id], ordererId, 'ride_rider_again'))[p.id];
    if (!name) throw new DriverError('ride_rider_unknown');
    return { personId: p.personId, phoneHash: p.phoneHash, name };
  }

  private async riderNames(participantIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string | null>> {
    const key = (id: string) => `${accessorId}:${id}`;
    const missing = [...new Set(participantIds)].filter((id) => !this.riderNameCache.has(key(id)));
    if (missing.length > 0 && this.riders) {
      const read = await this.riders.names(missing, accessorId, purpose);
      for (const id of missing) {
        const name = read[id];
        if (!name) continue;
        if (this.riderNameCache.size >= RIDER_NAME_CACHE_MAX) this.riderNameCache.delete(this.riderNameCache.keys().next().value as string);
        this.riderNameCache.set(key(id), name);
      }
    }
    return Object.fromEntries(participantIds.map((id) => [id, this.riderNameCache.get(key(id)) ?? null]));
  }

  /**
   * Wave 2 (merchant money, insights, disputes): a merchant's orders placed in [from, to), any
   * state, oldest first. Authorisation is the caller's (merchantAdmin checks the org scope).
   */
  /**
   * One merchant's orders placed in `[from, to)`, oldest first: one bounded read (index
   * `(merchant_org_id, placed_at)`) with lines and participants, no whole-history scan and no
   * per-order re-read (review 2026-10-04 #11). Callers always pass a range (a day, a week, 30 days).
   */
  async merchantOrders(merchantOrgId: string, range: { from: Date; to: Date }): Promise<Order[]> {
    return (await this.repo.merchantOrdersBetween(merchantOrgId, range.from, range.to)).map(toOrderView);
  }

  /**
   * «منين زبائنك» (maps program r6): the store's delivered orders placed in `[from, to)` per drop-off
   * zone. Counts only, from one grouped read; the merchant module hides the small zones (D7).
   */
  async deliveredByDropoffZone(merchantOrgId: string, range: { from: Date; to: Date }): Promise<Array<{ zoneKey: string | null; orders: number }>> {
    return this.repo.deliveredByDropoffZone(merchantOrgId, range.from, range.to);
  }

  /** Console history: any state, newest first, keyset-paginated by an opaque cursor. */
  async search(input: Omit<OrderSearchFilter, 'after'> & { cursor?: string | undefined; late?: boolean | undefined }): Promise<OrderSearchPage> {
    const { cursor, late, ...filter } = input;
    const ticket = filter.text ? parseOrderTicket(filter.text) : null;
    if (ticket) return this.searchTicket(ticket, { ...filter, text: undefined }, cursor, late);
    if (late) return this.searchLate(filter, cursor);
    const rows = await this.repo.search({ ...filter, after: decodeCursor(cursor), limit: input.limit + 1 });
    const page = rows.slice(0, input.limit);
    const now = this.clock.now();
    return { rows: page.map((o) => toSummary(o, now)), nextCursor: rows.length > input.limit ? encodeCursor(page.at(-1)!) : null };
  }

  /**
   * K-02: "#1284" as the customer, the kitchen and the courier say it. The ticket is derived from the
   * id (FNV, `orderTicketNumber`), so there is no column to index: this is a bounded computed lookup
   * over the city's orders placed since the start of yesterday (Baghdad) — or in `[from, to)` when
   * given — on the `(city_id, placed_at)` index, keeping every match (tickets can collide; the
   * Console shows each with its time and restaurant). Other filters still apply. Pages by the same
   * keyset cursor; a scan that hit its bound continues from where it stopped.
   */
  private async searchTicket(ticket: string, filter: Omit<OrderSearchFilter, 'after'>, cursor: string | undefined, late?: boolean): Promise<OrderSearchPage> {
    const now = this.clock.now();
    const from = filter.from ?? new Date(startOfLocalDay(now).getTime() - 86_400_000);
    const scanned = await this.repo.search({ ...filter, from, after: decodeCursor(cursor), limit: TICKET_SCAN_LIMIT });
    const hits = scanned.filter((o) => orderTicketNumber(o.id) === ticket && (!late || isLate(o, now)));
    const page = hits.slice(0, filter.limit);
    const more = hits.length > filter.limit ? page.at(-1)! : scanned.length === TICKET_SCAN_LIMIT ? scanned.at(-1)! : null;
    return { rows: page.map((o) => toSummary(o, now)), nextCursor: more ? encodeCursor(more) : null };
  }

  /**
   * "متأخرة": active orders behind their promise. Lateness is computed (it moves with the clock), so
   * this is a bounded scan of the active states on the `(city_id, placed_at)` index, newest first,
   * keeping the late ones; it pages by the same keyset cursor and continues where a full scan stopped.
   */
  private async searchLate(filter: Omit<OrderSearchFilter, 'after'>, cursor: string | undefined): Promise<OrderSearchPage> {
    const now = this.clock.now();
    const states = (filter.states && filter.states.length > 0 ? filter.states : ACTIVE_ORDER_STATES).filter((s) => ACTIVE_ORDER_STATES.includes(s));
    if (states.length === 0) return { rows: [], nextCursor: null };
    const scanned = await this.repo.search({ ...filter, states, after: decodeCursor(cursor), limit: TICKET_SCAN_LIMIT });
    const hits = scanned.filter((o) => isLate(o, now));
    const page = hits.slice(0, filter.limit);
    const more = hits.length > filter.limit ? page.at(-1)! : scanned.length === TICKET_SCAN_LIMIT ? scanned.at(-1)! : null;
    return { rows: page.map((o) => toSummary(o, now)), nextCursor: more ? encodeCursor(more) : null };
  }

  /**
   * Active delivery orders per customer (drop-off) zone: what the launch throttle counts and the
   * console's zone gauges show. Rides are not throttled (dispatch handles them).
   */
  async activeByZone(cityId: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const o of await this.repo.findMany({ cityId, states: ACTIVE_ORDER_STATES })) {
      const zone = o.dropoff?.zoneKey;
      if (!zone || !THROTTLED_ORDER_TYPES.includes(o.type)) continue;
      out.set(zone, (out.get(zone) ?? 0) + 1);
    }
    return out;
  }

  /** Placed → delivered minutes of delivery orders delivered in `[from, to)` (launch wall: median delivery). */
  async deliveryDurations(cityId: string, from: Date, to: Date): Promise<number[]> {
    // Bounded read on (city, placed_at): anything delivered in the window was placed at most a day before it.
    const rows = await this.repo.search({ cityId, from: new Date(from.getTime() - 86_400_000), to, limit: 20_000 });
    return rows
      .filter((o) => THROTTLED_ORDER_TYPES.includes(o.type) && o.deliveredAt && o.deliveredAt.getTime() >= from.getTime() && o.deliveredAt.getTime() < to.getTime())
      .map((o) => (o.deliveredAt!.getTime() - o.placedAt.getTime()) / 60_000);
  }

  /** Orders placed per local day in `[from, to)` (launch wall: orders/day), keyed `YYYY-MM-DD` (Baghdad). */
  async placedPerDay(cityId: string, from: Date, to: Date, offsetMin = 180): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const o of await this.repo.search({ cityId, from, to, limit: 20_000 })) {
      const t = o.placedAt.getTime();
      const day = new Date(t + offsetMin * 60_000).toISOString().slice(0, 10);
      out.set(day, (out.get(day) ?? 0) + 1);
    }
    return out;
  }

  /**
   * Orders placed per local clock hour (index 0–23, Baghdad) in `[from, to)`: the Partner app's
   * "tomorrow's busiest window" reads last week's same weekday through this.
   */
  async placedPerHour(cityId: string, from: Date, to: Date, offsetMin = 180): Promise<number[]> {
    const out = new Array<number>(24).fill(0);
    for (const o of await this.repo.search({ cityId, from, to, limit: 20_000 })) {
      const hour = new Date(o.placedAt.getTime() + offsetMin * 60_000).getUTCHours();
      out[hour] = (out[hour] ?? 0) + 1;
    }
    return out;
  }

  /** Right-now bar: orders placed in the last hour, active orders and how many of them are late. */
  async liveStats(cityId: string): Promise<{ ordersLastHour: number; activeOrders: number; lateOrders: number }> {
    const now = this.clock.now();
    const [ordersLastHour, active] = await Promise.all([
      this.repo.countPlacedSince(cityId, new Date(now.getTime() - 60 * 60_000)),
      this.repo.findMany({ cityId, states: ACTIVE_ORDER_STATES }),
    ]);
    return { ordersLastHour, activeOrders: active.length, lateOrders: active.filter((o) => isLate(o, now)).length };
  }

  /** Raw aggregate for authorisation checks in the transport layer. */
  async aggregate(orderId: string): Promise<OrderAggregate> {
    return this.load(orderId);
  }

  /** Joy w4: a household's orders in `[from, to)` — on its wallet, or «للسفرة» orders of these members. */
  householdOrdersBetween(householdId: string, memberIds: readonly string[], from: Date, to: Date): Promise<OrderRecord[]> {
    return this.repo.householdOrdersBetween(householdId, memberIds, from, to);
  }

  /** Joy w6: who had orders served in `[from, to)` (the month-start card's audience). */
  orderersServedBetween(from: Date, to: Date): Promise<string[]> {
    return this.repo.orderersServedBetween(from, to);
  }

  /** Joy w6: the orders a person placed in `[from, to)` with their lines, oldest first. */
  async placedByBetween(personId: string, from: Date, to: Date): Promise<OrderAggregate[]> {
    const mine = (await this.repo.forPerson(personId)).filter((o) => o.ordererId === personId && o.placedAt >= from && o.placedAt < to);
    const out: OrderAggregate[] = [];
    for (const o of mine.sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime() || a.id.localeCompare(b.id))) {
      const agg = await this.repo.find(o.id);
      if (agg) out.push(agg);
    }
    return out;
  }

  // ───────────────────────── timers ─────────────────────────

  async handleTimer(name: string, job: OrderTimerJob): Promise<void> {
    await this.uow.run(async (tx) => {
      const agg = await this.repo.find(job.orderId, tx);
      if (!agg) return;
      const order = agg.order;
      const now = this.clock.now();
      switch (name) {
        case ORDER_JOBS.offerToMerchant: {
          const profile = order.merchantOrgId ? await this.merchants.profile(order.merchantOrgId) : null;
          if (profile) await this.offerToMerchant(order, profile, tx);
          return;
        }
        case ORDER_JOBS.payerTimeout: {
          if (!order.heldForPayer || order.state !== 'placed' || !order.householdOrgId) return;
          // The answer may have landed while its hand-off failed: it stands; silence cancels free.
          const answer = this.households ? await this.households.decision(order.householdOrgId, order.id) : null;
          await this.settleHeld(order, answer === 'approved' ? 'approved' : answer === 'declined' ? 'payer_declined' : 'payer_no_answer', tx);
          return;
        }
        case ORDER_JOBS.autoReject: {
          const offeredAt = order.merchantOfferedAt;
          if (order.state !== 'placed' || !offeredAt || offeredAt.getTime() !== job.refMs || pendingProposal(agg.lines)) return;
          const profile = order.merchantOrgId ? await this.merchants.profile(order.merchantOrgId) : null;
          // Review A.1: an auto-reject inside a declared pause window does not score.
          const pause = profile ? (activePauseWindow(now, profile.pauseWindows, DEFAULT_TIMEZONE) ?? activePauseWindow(offeredAt, profile.pauseWindows, DEFAULT_TIMEZONE)) : null;
          await this.move(order, 'merchant_rejected', SYSTEM, tx, { cancelledAt: now, cancellationReason: 'merchant_timeout' }, {
            reason: 'merchant_timeout',
            auto: true,
            scored: pause === null,
            pauseWindow: pause ? pause.reason ?? `${pause.start}-${pause.end}` : null,
            dispatchAlert: true,
          });
          return;
        }
        case ORDER_JOBS.partialTimeout: {
          const proposal = pendingProposal(agg.lines);
          if (order.state !== 'placed' || !proposal || proposal.proposedAt.getTime() !== job.refMs) return;
          for (const l of proposal.lines) await this.repo.updateLine(l.id, { substitution: { ...l.substitution!, state: 'restored' } }, tx);
          await this.move(order, 'platform_cancelled', SYSTEM, tx, { cancelledAt: now, cancellationReason: 'partial_timeout', cancellationFeeIqd: 0 }, this.cancelled(order, { by: 'platform', reason: 'partial_timeout', free: true, feeIqd: 0 }));
          return;
        }
        case ORDER_JOBS.readyOverdue:
        case ORDER_JOBS.courierRelease: {
          if (!['merchant_accepted', 'preparing'].includes(order.state) || order.promisedReadyAt?.getTime() !== job.refMs || !order.merchantOrgId) return;
          const profile = await this.merchants.profile(order.merchantOrgId);
          const present = profile?.lastHeartbeatAt && now.getTime() - profile.lastHeartbeatAt.getTime() <= ORDERS_RULES.heartbeatStaleMs;
          if (present) return;
          if (name === ORDER_JOBS.readyOverdue) {
            await this.emit(tx, 'order.merchant_unresponsive', SYSTEM, order, { merchantOrgId: order.merchantOrgId, promisedReadyAt: order.promisedReadyAt?.toISOString() ?? null, lastHeartbeatAt: profile?.lastHeartbeatAt?.toISOString() ?? null, dispatcherCard: true, call: true });
            return;
          }
          const trip = await this.trips.activeForOrder(order.id);
          if (!trip?.courierId || !PRE_PICKUP_COURIER_STATES.includes(trip.state)) return;
          await this.trips.detachOrder(trip.id, order.id, SYSTEM, 'merchant_unresponsive');
          await this.emit(tx, 'order.courier_released', SYSTEM, order, {
            tripId: trip.id,
            courierId: trip.courierId,
            merchantOrgId: order.merchantOrgId,
            compensationIqd: ORDERS_RULES.courierReleaseCompensationIqd,
            chargedTo: 'merchant',
          });
          return;
        }
        case ORDER_JOBS.autoClose: {
          if (order.state === 'delivered' || order.state === 'completed') await this.close(order, SYSTEM, 'auto_2h', tx);
          return;
        }
        case ORDER_JOBS.rideReminder: {
          // Only the booking it was set for, still waiting for its search (not cancelled, not taken).
          if (order.type !== 'ride' || order.state !== 'placed' || !order.scheduledFor || order.scheduledFor.getTime() !== job.refMs) return;
          await this.emit(tx, 'order.ride_reminder', SYSTEM, order, { customerId: order.ordererId, scheduledFor: order.scheduledFor.toISOString(), searchAt: rideSearchStartsAt(order.scheduledFor).toISOString() });
          return;
        }
        default:
          return;
      }
    });
  }

  // ───────────────────────── internals ─────────────────────────

  private async load(orderId: string, tx?: Tx): Promise<OrderAggregate> {
    const agg = await this.repo.find(orderId, tx);
    if (!agg) throw new DriverError('order_not_found');
    return agg;
  }

  /** Runs `fn` on the order inside a unit of work; unknown orders (other modules' test data) are ignored. */
  private async whenOrder(orderId: string, fn: (o: OrderRecord, tx: Tx) => Promise<unknown> | undefined): Promise<void> {
    await this.uow.run(async (tx) => {
      const agg = await this.repo.find(orderId, tx);
      if (agg) await fn(agg.order, tx);
    });
  }

  private async accept(order: OrderRecord, pickedPrepMinutes: number, actorId: string, tx: Tx, opts: { auto: boolean; partial?: boolean }): Promise<OrderRecord> {
    const now = this.clock.now();
    const profile = order.merchantOrgId ? await this.merchants.profile(order.merchantOrgId) : null;
    // Busy mode: +10 min on whatever the kitchen picked (or its default), so the promised ready time,
    // the courier's timing and the customer's ETA all carry it.
    const prepMinutes = pickedPrepMinutes + busyExtraMinutes(profile, now);
    const promisedReadyAt = new Date(now.getTime() + prepMinutes * 60_000);
    // Contract `order.accepted`: what dispatch needs to time and route the courier (auto-assign).
    const accepted: Omit<DomainEventInput<'order.accepted'>, 'from' | 'to'> = {
      orderType: order.type,
      cityId: order.cityId,
      merchantOrgId: order.merchantOrgId,
      prepMinutes,
      promisedReadyAt,
      minVehicleClass: order.minVehicleClass,
      auto: opts.auto,
      partial: opts.partial ?? false,
      pickup: profile?.location ?? null,
      dropoff: order.dropoff,
      paymentMethod: order.paymentMethod,
      totalIqd: order.totalIqd,
    };
    const next = await this.move(order, 'merchant_accepted', actorId, tx, { acceptedAt: now, promisedReadyAt }, accepted, opts.auto ? 'order.auto_accepted' : 'order.accepted');
    const ref = promisedReadyAt.getTime();
    await this.queue.add(ORDER_JOBS.readyOverdue, { orderId: order.id, refMs: ref }, { delayMs: (prepMinutes + ORDERS_RULES.readyOverdueMin) * 60_000, jobId: jobKey('order', order.id, 'readyOverdue', ref) });
    await this.queue.add(ORDER_JOBS.courierRelease, { orderId: order.id, refMs: ref }, { delayMs: (prepMinutes + ORDERS_RULES.courierReleaseMin) * 60_000, jobId: jobKey('order', order.id, 'courierRelease', ref) });
    return next;
  }

  private async pickedUp(order: OrderRecord, e: TripEventEnvelope, tx: Tx): Promise<unknown> {
    // Only orders still waiting for the courier move; anything later is a replay.
    const awaiting: readonly OrderState[] = MERCHANT_ORDER_TYPES.includes(order.type) ? ['merchant_accepted', 'preparing', 'ready'] : ['placed'];
    if (order.type === 'ride' || !awaiting.includes(order.state)) return;
    let o = order;
    const now = this.clock.now();
    if (o.state === 'merchant_accepted' || o.state === 'preparing') {
      // The courier has the food: the merchant's "ready" tap is implied.
      o = await this.move(o, 'ready', e.actorId, tx, { readyAt: now }, { implied: true, tripId: e.tripId });
    }
    return this.move(o, 'picked_up', e.actorId, tx, { pickedUpAt: now }, { tripId: e.tripId, courierId: e.actorId });
  }

  private async delivered(order: OrderRecord, e: TripEventEnvelope, tx: Tx): Promise<unknown> {
    const cash = typeof e.payload['cashCollectedIqd'] === 'number' ? (e.payload['cashCollectedIqd'] as number) : null;
    const extra = noChangeExtra(order, cash, e.payload['changeToWalletIqd']);
    if (order.type === 'ride') {
      return order.state === 'matched' ? this.completeRide(order, e.actorId, tx, { by: 'driver', tripId: e.tripId }, cash, extra) : undefined;
    }
    if (order.state !== 'picked_up') return;
    const now = this.clock.now();
    const next = await this.move(order, 'delivered', e.actorId, tx, { deliveredAt: now, ...(extra > 0 ? { changeToWalletIqd: extra } : {}) }, { tripId: e.tripId, courierId: e.actorId });
    if (order.paymentMethod === 'cash') await this.cashCollected(next, { tripId: e.tripId, courierId: e.actorId, vertical: verticalOf(e) }, cash ?? order.totalIqd, tx, extra);
    await this.scheduleClose(next, now);
    return next;
  }

  /**
   * "الخردة علينا": the trips module's check of a drop-off hand-over before the stop is completed
   * (bound at start-up, like dispatch's offer check). A courier with no change may record the
   * customer's whole note with `changeToWalletIqd` = note − cash total: cash orders only, recomputed
   * here, > 0, in 250s, at most the cap (25,000). Cash above the total without it is refused, so every
   * credit beyond the rounding change is named and capped. Null = the hand-over may be recorded.
   */
  /**
   * s1 «رمز المشوار»: the code a ride must start with (trips checks the driver's against it), or null
   * when the order needs none — day rides, every other order, unknown orders.
   */
  async startCodeOf(orderId: string): Promise<string | null> {
    return (await this.repo.find(orderId))?.order.startCode ?? null;
  }

  async handoverProblem(orderId: string, handover: Pick<HandoverProof, 'cashCollectedIqd' | 'changeToWalletIqd'>): Promise<'change_to_wallet_not_cash' | 'change_to_wallet_mismatch' | 'change_to_wallet_above_cap' | null> {
    const extra = handover.changeToWalletIqd;
    const collected = handover.cashCollectedIqd;
    if (extra === undefined && collected === undefined) return null;
    const agg = await this.repo.find(orderId);
    if (!agg) return extra === undefined ? null : 'change_to_wallet_not_cash';
    const order = agg.order;
    if (extra === undefined) return order.paymentMethod === 'cash' && collected !== undefined && collected > order.totalIqd ? 'change_to_wallet_mismatch' : null;
    const problem = changeToWalletProblem({ paymentMethod: order.paymentMethod, totalIqd: order.totalIqd, collectedIqd: collected ?? Number.NaN, changeToWalletIqd: extra }, ORDERS_RULES.changeToWallet);
    if (problem === null) return null;
    if (problem === 'not_cash') return 'change_to_wallet_not_cash';
    if (problem === 'above_cap') return 'change_to_wallet_above_cap';
    return 'change_to_wallet_mismatch';
  }

  /**
   * Edge-case §3 merchant cash account: a cash order creates `merchant_payable` net of commission
   * the moment the courier collects; the courier now holds the merchant's money until settlement.
   * `order.cash_collected` carries the full money fact, so the ledger posts it at once.
   */
  private async cashCollected(order: OrderRecord, courier: Courier, amountIqd: number, tx: Tx, changeToWalletIqd = 0): Promise<void> {
    const fact = await this.moneyFact(order, courier, amountIqd, tx, changeToWalletIqd);
    const collected: DomainEventInput<'order.cash_collected'> = {
      ...fact,
      tripId: courier.tripId,
      courierId: courier.courierId,
      amountIqd,
      expectedIqd: order.totalIqd,
      discrepancyIqd: amountIqd - order.totalIqd,
      changeToWalletIqd,
    };
    await this.emit(tx, 'order.cash_collected', courier.courierId, order, collected);
    if (changeToWalletIqd > 0) {
      // "+7,250 دينار رصيد (الباقي)": the customer app's coin strip and the push (notify).
      const credited: DomainEventInput<'order.change_to_wallet'> = { customerId: order.ordererId, courierId: courier.courierId, tripId: courier.tripId, amountIqd: changeToWalletIqd, collectedIqd: amountIqd, totalIqd: order.totalIqd };
      await this.emit(tx, 'order.change_to_wallet', courier.courierId, order, credited);
    }
    if (!order.merchantOrgId) return;
    const profile = await this.merchants.profile(order.merchantOrgId);
    const tier = profile?.commissionTier ?? ORDERS_RULES.defaultCommissionTier;
    const pct = commissionPctOf(tier);
    const commission = Math.round((commissionBaseOf(order) * pct) / 100);
    const dealIqd = merchantDealOf(order)?.amountIqd ?? 0;
    const accrued: DomainEventInput<'merchant.payable_accrued'> = {
      merchantOrgId: order.merchantOrgId,
      courierId: courier.courierId,
      tripId: courier.tripId,
      grossIqd: order.itemsTotalIqd,
      commissionTier: tier,
      commissionPct: pct,
      commissionIqd: commission,
      dealIqd,
      netIqd: order.itemsTotalIqd - commission - dealIqd,
      heldBy: 'courier',
    };
    await this.emit(tx, 'merchant.payable_accrued', SYSTEM, order, accrued);
  }

  /**
   * The order's money fact as the ledger settles it (contracts `OrderMoneyPayload` /
   * `ErrandMoneyPayload` / `RideMoneyPayload`), from this module's own rows plus the courier who
   * carried it. `cashCollectedIqd` is what the courier actually took (cash collection only).
   * A discount is only ever a resolved promotion (`promotionId`), funded from its budget line.
   */
  private async moneyFact(order: OrderRecord, courier: Courier | null, cashCollectedIqd: number | undefined, tx: Tx, changeToWalletIqd = 0): Promise<MoneyFact> {
    const now = this.clock.now();
    const referredBy = this.referrals ? await this.referrals.referrerOf(order.ordererId) : null;
    const payer = {
      customerId: order.ordererId,
      ...(order.householdOrgId ? { householdId: order.householdOrgId } : {}),
      ...(referredBy ? { referredBy } : {}),
      payment: order.paymentMethod === 'cash' ? ('cash' as const) : ('wallet' as const),
      ...(cashCollectedIqd !== undefined ? { cashCollectedIqd } : {}),
      ...(changeToWalletIqd > 0 && order.paymentMethod === 'cash' ? { changeToWalletIqd } : {}),
    };
    if (order.type === 'food' || order.type === 'grocery_catalog') {
      const agg = (await this.repo.find(order.id, tx))!;
      const profile = order.merchantOrgId ? await this.merchants.profile(order.merchantOrgId) : null;
      return {
        kind: 'order',
        order: {
          orderId: order.id,
          ...(courier ? { tripId: courier.tripId, courierId: courier.courierId } : {}),
          orderType: order.type,
          occurredAt: now,
          ...payer,
          merchantId: order.merchantOrgId ?? '',
          itemsSubtotalIqd: order.itemsTotalIqd,
          commissionTier: profile?.commissionTier ?? ORDERS_RULES.defaultCommissionTier,
          serviceFeeIqd: order.serviceFeeIqd,
          smallOrderFeeIqd: order.smallOrderFeeIqd ?? 0,
          deliveryFeeIqd: order.deliveryFeeIqd,
          tipIqd: order.tipIqd,
          pointsRedeemed: order.pointsRedeemed ?? 0,
          ...moneyDiscount(order),
          participants: participantShares(agg),
        },
      };
    }
    if (order.type === 'errand') {
      return {
        kind: 'errand',
        errand: {
          orderId: order.id,
          ...(courier ? { tripId: courier.tripId } : {}),
          occurredAt: now,
          ...payer,
          shopperId: courier?.courierId ?? '',
          actualCostIqd: order.receiptTotalIqd ?? order.itemsTotalIqd,
          errandFeeIqd: order.deliveryFeeIqd,
          serviceFeeIqd: order.serviceFeeIqd,
          tipIqd: order.tipIqd,
        },
      };
    }
    // Rides and parcels: the driver keeps the fare less the platform take by class (money §3).
    return {
      kind: 'ride',
      ride: {
        tripId: courier?.tripId ?? '',
        orderId: order.id,
        occurredAt: now,
        ...payer,
        driverId: courier?.courierId ?? '',
        takeClass: order.type === 'parcel' ? 'parcel' : courier?.vertical === 'tuktuk' ? 'tuktuk' : 'car',
        fareIqd: order.totalIqd - order.tipIqd,
        tipIqd: order.tipIqd,
      },
    };
  }

  private async completeRide(order: OrderRecord, actorId: string, tx: Tx, payload: Record<string, unknown>, cashCollectedIqd?: number | null, changeToWalletIqd = 0): Promise<OrderRecord> {
    const now = this.clock.now();
    const next = await this.move(order, 'completed', actorId, tx, { deliveredAt: now, ...(changeToWalletIqd > 0 ? { changeToWalletIqd } : {}) }, payload);
    if (order.paymentMethod === 'cash') {
      // The driver took the fare at the door: his cash cap moves now; the money posts once more, idempotently, on closed.
      const courier = await this.trips.courierOf(order.id);
      if (courier) await this.cashCollected(next, courier, cashCollectedIqd ?? order.totalIqd, tx, changeToWalletIqd);
    }
    await this.scheduleClose(next, now);
    return next;
  }

  private async scheduleClose(order: OrderRecord, from: Date): Promise<void> {
    await this.queue.add(ORDER_JOBS.autoClose, { orderId: order.id, refMs: from.getTime() }, { delayMs: ORDERS_RULES.autoCloseMs, jobId: jobKey('order', order.id, 'autoClose') });
  }

  /** `closed`: money settles (ledger subscribes) and points are allocated to participants. */
  private async close(order: OrderRecord, actorId: string, reason: string, tx: Tx): Promise<void> {
    const agg = (await this.repo.find(order.id, tx))!;
    const now = this.clock.now();
    // Money settles on closed (domain §2): the ledger posts the fact (a no-op if cash collection already did).
    // A no-change credit was posted with the cash; the close fact carries the same note so the
    // posting is identical whichever of the two events the ledger sees first.
    const extra = agg.order.paymentMethod === 'cash' ? (agg.order.changeToWalletIqd ?? 0) : 0;
    const fact = await this.moneyFact(agg.order, await this.trips.courierOf(order.id), extra > 0 ? agg.order.totalIqd + extra : undefined, tx, extra);
    const closedPayload: DistributiveOmit<DomainEventInput<'order.closed'>, 'from' | 'to'> = { ...fact, reason, totalIqd: agg.order.totalIqd };
    const closed = await this.move(agg.order, 'closed', actorId, tx, { closedAt: now }, closedPayload);
    const profile = closed.merchantOrgId ? await this.merchants.profile(closed.merchantOrgId) : null;
    const revenue = platformRevenueIqd({
      type: closed.type,
      totalIqd: closed.totalIqd,
      serviceFeeIqd: closed.serviceFeeIqd,
      commissionBaseIqd: commissionBaseOf(closed),
      commissionPct: commissionPctOf(profile?.commissionTier ?? ORDERS_RULES.defaultCommissionTier),
    });
    const basePoints = orderPoints({ type: closed.type, platformRevenueIqd: revenue });
    const allocations = allocatePoints({
      type: closed.type,
      ordererId: closed.ordererId,
      basePoints,
      lines: agg.lines.filter((l) => l.substitution?.state !== 'removed').map((l) => ({ participantId: l.participantId, valueIqd: lineValue(l), pointsEligible: l.pointsEligible })),
      participants: agg.participants.map((p) => ({ id: p.id, role: p.role, personId: p.personId, phoneHash: p.phoneHash })),
    });
    await this.emit(tx, 'order.points_allocated', SYSTEM, closed, { platformRevenueIqd: revenue, basePoints, allocations });
    const expiresAt = new Date(now.getTime() + ORDERS_RULES.pendingPointsTtlDays * 86_400_000).toISOString();
    for (const a of allocations.filter((x) => x.pending)) {
      await this.emit(tx, 'points.pending', SYSTEM, closed, { phoneHash: a.phoneHash, participantId: a.participantId, points: a.points, expiresAt });
    }
  }

  private async unreachableDispute(order: OrderRecord, e: TripEventEnvelope, tx: Tx): Promise<unknown> {
    if (order.state !== 'picked_up' && order.state !== 'matched') return;
    // Domain §2/§9: food — the customer owes the cost; ride — the cancellation fee. Support may override.
    const defaultOutcome = order.type === 'ride' ? 'customer_owes_cancellation_fee' : 'customer_owes_cost';
    return this.move(order, 'disputed', SYSTEM, tx, {}, { kind: 'unreachable', openedBy: 'system', defaultOutcome, tripId: e.tripId, evidence: { ...e.payload, tripId: e.tripId } });
  }

  private async onTripCancelled(e: TripEventEnvelope): Promise<void> {
    const p = e.payload;
    const by = String(p['by'] ?? 'platform');
    const orderIds = Array.isArray(p['orderIds']) ? (p['orderIds'] as string[]) : [];
    const pickedUp = new Set(Array.isArray(p['pickedUpOrderIds']) ? (p['pickedUpOrderIds'] as string[]) : []);
    for (const id of orderIds) {
      await this.whenOrder(id, async (o, tx) => {
        if (TERMINAL_ORDER_STATES.includes(o.state) || o.state === 'disputed') return;
        if (by === 'driver' && o.state === 'picked_up' && pickedUp.has(o.id)) {
          // Spec §9: courier cancels after pickup → courier pays the food cost.
          return this.move(o, 'disputed', SYSTEM, tx, {}, { kind: 'courier_cancelled_after_pickup', openedBy: 'system', defaultOutcome: 'courier_pays_food_cost', tripId: e.tripId, courierId: p['courierId'] ?? null });
        }
        if (o.type === 'ride' && o.state === 'matched') {
          if (by === 'driver') {
            // Spec §4: driver cancel after accept = scoring hit; after arrival also 500 credit to the customer from the driver.
            const arrivedPickupAt = dateOrNull(p['arrivedPickupAt']);
            const fee = this.pricing.cancellationFee(
              { kind: 'trip', by: 'driver', state: arrivedPickupAt ? 'arrived_pickup' : 'en_route_to_pickup', acceptedAt: dateOrNull(p['acceptedAt']), arrivedPickupAt, fareIqd: o.totalIqd },
              e.occurredAt,
              o.cityId,
            );
            await this.emit(tx, 'order.driver_cancelled', e.actorId, o, { tripId: e.tripId, scoringHit: fee.scoringHit, customerCreditIqd: fee.amountIqd, creditFundedBy: fee.amountIqd > 0 ? 'driver' : null });
          }
          // The ride goes back to dispatch.
          return this.move(o, 'placed', SYSTEM, tx, {}, { tripId: e.tripId, reason: `trip_cancelled_by_${by}`, redispatch: true }, 'order.rematch_needed');
        }
        if (by !== 'customer') {
          // Dispatch requests a new courier from this (it used to go nowhere and the order waited forever).
          const profile = o.merchantOrgId ? await this.merchants.profile(o.merchantOrgId) : null;
          const unassigned: DomainEventInput<'order.courier_unassigned'> = {
            tripId: e.tripId,
            by,
            reason: typeof p['reason'] === 'string' ? p['reason'] : null,
            redispatch: true,
            orderType: o.type,
            cityId: o.cityId,
            merchantOrgId: o.merchantOrgId,
            promisedReadyAt: o.promisedReadyAt,
            minVehicleClass: o.minVehicleClass,
            pickup: profile?.location ?? null,
            dropoff: o.dropoff,
            paymentMethod: o.paymentMethod,
            totalIqd: o.totalIqd,
          };
          await this.emit(tx, 'order.courier_unassigned', SYSTEM, o, unassigned);
        }
        return undefined;
      });
    }
  }

  private async releaseTrip(order: OrderRecord, reason: string): Promise<void> {
    const trip = await this.trips.activeForOrder(order.id);
    if (trip) await this.trips.detachOrder(trip.id, order.id, SYSTEM, reason);
  }

  private async feeFor(order: OrderRecord): Promise<{ fee: CancellationFee; trip: Trip | null }> {
    const trip = await this.trips.activeForOrder(order.id);
    const now = this.clock.now();
    if (order.type === 'ride' && trip && trip.acceptedAt) {
      const arrivedPickupAt = trip.stops.find((s) => s.type === 'pickup' && s.arrivedAt)?.arrivedAt ?? null;
      return { fee: this.pricing.cancellationFee({ kind: 'trip', by: 'customer', state: trip.state, acceptedAt: trip.acceptedAt, arrivedPickupAt, fareIqd: order.totalIqd }, now, order.cityId), trip };
    }
    const fee = this.pricing.cancellationFee(
      {
        kind: 'order',
        type: order.type,
        state: order.state,
        itemsTotalIqd: order.itemsTotalIqd,
        deliveryFeeIqd: order.deliveryFeeIqd,
        totalIqd: order.totalIqd,
        scheduledFor: order.scheduledFor,
        merchantOfferedAt: order.merchantOfferedAt,
        courierEnRoute: Boolean(trip?.courierId && PRE_PICKUP_COURIER_STATES.includes(trip.state)),
        courierAssigned: Boolean(trip?.courierId),
        receiptTotalIqd: order.receiptTotalIqd,
      },
      now,
      order.cityId,
    );
    return { fee, trip };
  }

  /** The `order.cancelled` contract fields beyond the transition (`move` adds from/to/cancelledState). */
  private cancelled(
    order: OrderRecord,
    c: { by: 'customer' | 'platform'; reason: string; free: boolean; feeIqd: number; beneficiaries?: CancellationBeneficiary[]; tripId?: string | undefined; label_ar?: string; reason_ar?: string },
  ): Omit<DomainEventInput<'order.cancelled'>, 'from' | 'to' | 'cancelledState'> {
    return {
      orderId: order.id,
      ...(c.tripId ? { tripId: c.tripId } : {}),
      occurredAt: this.clock.now(),
      customerId: order.ordererId,
      ...(order.householdOrgId ? { householdId: order.householdOrgId } : {}),
      by: c.by,
      reason: c.reason,
      free: c.free,
      feeIqd: c.feeIqd,
      beneficiaries: c.beneficiaries ?? [],
      ...(c.label_ar ? { label_ar: c.label_ar } : {}),
      ...(c.reason_ar ? { reason_ar: c.reason_ar } : {}),
    };
  }

  private async evidence(order: OrderRecord): Promise<Record<string, unknown>> {
    return {
      placedAt: order.placedAt.toISOString(),
      acceptedAt: order.acceptedAt?.toISOString() ?? null,
      promisedReadyAt: order.promisedReadyAt?.toISOString() ?? null,
      readyAt: order.readyAt?.toISOString() ?? null,
      pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
    };
  }

  private async move(
    order: OrderRecord,
    to: OrderState,
    actorId: string,
    tx: Tx,
    patch: OrderPatch = {},
    payload: object = {},
    eventType?: string,
  ): Promise<OrderRecord> {
    if (order.state === to) return order;
    if (!canOrderTransition(order.type, order.state, to)) throw new DriverError('order_state_conflict');
    const next = await this.repo.updateIf(order.id, order.state, { ...patch, state: to }, tx);
    if (!next) throw new DriverError('order_state_conflict');
    // The order will not happen: its merchant deal cost nothing, so the deal's budget gets it back.
    const deal = UNDONE_STATES.includes(to) ? merchantDealOf(order) : null;
    if (deal) await this.promotions.release(deal.promotionId, deal.amountIqd, tx);
    await this.emit(tx, eventType ?? orderEventType(to), actorId, next, { from: order.state, to, ...(to.endsWith('_cancelled') ? { cancelledState: to } : {}), ...payload });
    return next;
  }

  /** Cross-module events (contracts `DOMAIN_EVENT_PAYLOADS`) are validated against their shared contract here. */
  private async emit(tx: Tx | undefined, type: string, actorId: string, order: OrderRecord, payload: object): Promise<void> {
    const wire = isDomainEventType(type) ? encodeDomainEvent(type, payload as never) : (payload as Record<string, unknown>);
    await this.events.emit(tx, { type, actorId, occurredAt: this.clock.now(), orderId: order.id, payload: wire }, { name: 'order', id: order.id });
  }

  private async view(orderId: string, tx?: Tx): Promise<Order> {
    return toOrderView(await this.load(orderId, tx));
  }
}

// ───────────────────────── helpers ─────────────────────────

/** The receipt line of a platform promo code (money §5 launch package). */
const PLATFORM_PROMO_LABEL = { ar: 'خصم درايفر', en: 'Driver discount' } as const;

/** "سلّمته" (S-M4) is recorded on a ready order, or right after the courier confirmed the pickup himself. */
const HAND_OVER_STATES: readonly OrderState[] = ['ready', 'picked_up'];
/** Trip states in which the courier is at the counter or already left it with the bag. */
const AT_OR_PAST_PICKUP: readonly TripState[] = ['arrived_pickup', 'in_transit', 'arrived_dropoff', 'completed'];

/** The discount an order carries: promotion, amount after rounding, per-line savings, its receipt line. */
interface OrderDiscount {
  promotionId: string;
  amountIqd: number;
  lineSavingsIqd: number[];
  /** Per line, the deal's exact saving before rounding (sums to `meta.dealIqd`). */
  dealLineSavingsIqd: number[];
  meta: DiscountMeta;
}

/** An order priced as `place` charges it (shared by `place` and `quote`). */
interface Priced {
  merchantType: boolean;
  profile: MerchantProfile | null;
  newLines: NewLine[];
  itemsTotal: number;
  fees: ServerFees;
  discount: OrderDiscount | null;
  /** The restaurant's minimum (0 = none) and the J-D6 small-order fee this basket carries. */
  minOrderIqd: number;
  smallOrderFee: number;
  /** W-02: what the customer's points could do on this order (null = nothing), and what `usePoints` spends. */
  points: { balance: number; usable: number; valueIqd: number } | null;
  pointsRedeemed: number;
  pointsIqd: number;
  /** What the customer pays (cash: the price rounded up to 250; wallet: the price). */
  totalIqd: number;
  /** Cash change above the price, credited to his wallet ("الباقي رصيد"). */
  changeIqd: number;
  caps: ReturnType<typeof vehicleRequirement> | null;
}

/** The basket the deal engine prices: lines in order, with their menu unit price and full line value. */
function dealQuery(merchantOrgId: string, lines: ReadonlyArray<Pick<NewLine, 'catalogItemId' | 'qty' | 'unitPriceIqd' | 'modifiers'>>, itemsTotalIqd: number, deliveryFeeIqd: number, at: Date): MerchantDealQuery {
  return {
    merchantOrgId,
    lines: lines.map((l) => ({ catalogItemId: l.catalogItemId, qty: l.qty, unitPriceIqd: l.unitPriceIqd, lineIqd: lineValue(l) })),
    itemsTotalIqd,
    deliveryFeeIqd,
    at,
  };
}

/** The merchant-funded part of an order's discount by what it comes off (G-87 commission base, ledger lines). */
export function merchantDealOf(order: Pick<OrderRecord, 'discountIqd' | 'promotionId' | 'discountMeta'>): { promotionId: string; target: 'items' | 'delivery'; amountIqd: number } | null {
  if (!order.promotionId || order.discountIqd <= 0 || order.discountMeta?.funder !== 'merchant') return null;
  return { promotionId: order.promotionId, target: order.discountMeta.target === 'delivery' ? 'delivery' : 'items', amountIqd: order.discountIqd };
}

/**
 * The rounding cut (G-88) taken back from the lines that save most first, so each line keeps a
 * round saving ("20 %" lines read 2,800 / 1,000 / 200, not 2,857 / 952 / 191). Sums to the order's discount.
 */
export function trimSavings(savings: readonly number[], cutIqd: number): number[] {
  const out = [...savings];
  let left = cutIqd;
  const order = out.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    const take = Math.min(left, out[i]!);
    out[i] = out[i]! - take;
    left -= take;
  }
  return out;
}

function withoutDealSplit(meta: DiscountMeta): DiscountMeta {
  const rest = { ...meta };
  delete rest.dealIqd;
  delete rest.roundingIqd;
  return rest;
}

/** Commission base (G-87): items at menu prices less a merchant deal on items; free delivery is not in it. */
export function commissionBaseOf(order: Pick<OrderRecord, 'itemsTotalIqd' | 'discountIqd' | 'promotionId' | 'discountMeta'>): number {
  const deal = merchantDealOf(order);
  return Math.max(0, order.itemsTotalIqd - (deal?.target === 'items' ? deal.amountIqd : 0));
}

/** States in which the order did not happen: a merchant deal's reserved spend goes back to its budget. */
const UNDONE_STATES: readonly OrderState[] = ['merchant_rejected', 'customer_cancelled', 'platform_cancelled'];

/** The money fact's discount: a merchant deal (G-87, `promo_funded` from the merchant) or a platform promo. */
function moneyDiscount(order: OrderRecord): { merchantDeal: { promotionId: string; target: 'items' | 'delivery'; amountIqd: number } } | { platformPromo: { promotionId: string; amountIqd: number } } | Record<string, never> {
  const deal = merchantDealOf(order);
  if (deal) return { merchantDeal: deal };
  if (order.promotionId && order.discountIqd > 0) return { platformPromo: { promotionId: order.promotionId, amountIqd: order.discountIqd } };
  return {};
}

/**
 * What the customer pays after a partial accept removes `removedIqd` of items: the price from the parts
 * (the kept discount, or the re-priced deal), then cash rounding as at placement (`payable`).
 */
function reducedTotalOf(order: PricedOrder, removedIqd: number, reducedDiscountIqd: number | null): number {
  const price = Math.max(0, order.itemsTotalIqd - removedIqd + order.deliveryFeeIqd + order.serviceFeeIqd + (order.smallOrderFeeIqd ?? 0) + order.tipIqd - (reducedDiscountIqd ?? order.discountIqd) - pointsIqdOf(order));
  return payable(order.type, order.paymentMethod, price).totalIqd;
}

type PricedOrder = Pick<OrderRecord, 'type' | 'paymentMethod' | 'totalIqd' | 'itemsTotalIqd' | 'deliveryFeeIqd' | 'serviceFeeIqd' | 'tipIqd' | 'discountIqd' | 'smallOrderFeeIqd' | 'pointsRedeemed'>;

/** What the order's points take off its price (100 points = 1,000; the ledger posts the same at close). */
export function pointsIqdOf(order: Pick<OrderRecord, 'pointsRedeemed'>): number {
  return (order.pointsRedeemed ?? 0) * ORDERS_RULES.pointValueIqd;
}

/**
 * What the customer pays for a price (Ali, 2026-10-04): cash rounds **up** to 250 and the remainder is
 * change credited to his wallet when the cash is collected (`cashToHand`, the ledger's
 * `cash_rounding_credit`); a wallet or prepaid order pays the exact price. Rides keep their quoted
 * fare (already on the 250 step) plus tip as is.
 */
export function payable(type: OrderRecord['type'], paymentMethod: OrderRecord['paymentMethod'], priceIqd: number): { totalIqd: number; changeIqd: number } {
  if (type === 'ride' || paymentMethod !== 'cash') return { totalIqd: Math.max(0, priceIqd), changeIqd: 0 };
  const { cashIqd, changeIqd } = cashToHand(priceIqd);
  return { totalIqd: cashIqd, changeIqd };
}

/** The order's price before cash rounding: items + fees + small-order fee + tip − discount − points (rides: the stored total). */
export function orderPriceIqd(order: PricedOrder): number {
  if (order.type === 'ride') return order.totalIqd;
  return Math.max(0, order.itemsTotalIqd + order.deliveryFeeIqd + order.serviceFeeIqd + (order.smallOrderFeeIqd ?? 0) + order.tipIqd - order.discountIqd - pointsIqdOf(order));
}

/** Cash change in the stored total ("الباقي رصيد"): 0 for wallet orders, rides and orders placed before the rule. */
export function changeOf(order: PricedOrder): number {
  if (order.type === 'ride' || order.paymentMethod !== 'cash') return 0;
  return Math.max(0, order.totalIqd - orderPriceIqd(order));
}

/** The order view's discount line; old rows without meta are platform promos. */
function discountView(order: OrderRecord): Order['discount'] {
  if (!order.promotionId || order.discountIqd <= 0) return null;
  const meta: DiscountMeta = order.discountMeta ?? { funder: 'platform', target: 'order', type: null, label_ar: PLATFORM_PROMO_LABEL.ar, label_en: PLATFORM_PROMO_LABEL.en };
  return { promotionId: order.promotionId, amountIqd: order.discountIqd, ...meta, ...roundingOf(meta, order.discountIqd) };
}

/**
 * The receipt split of a rounded discount: the deal's exact saving (`dealIqd`, stored on the meta)
 * and what rounding the total up to the step gave back (`roundingIqd = dealIqd − amountIqd`, the
 * "تقريب" line). Rounding always goes against the deal (G-88, docs/api/deals-and-topup.md), so it is
 * never negative and the funder never pays more than the deal promises. Old rows without `dealIqd`
 * read as unrounded.
 */
export function roundingOf(meta: Pick<DiscountMeta, 'dealIqd'>, amountIqd: number): { dealIqd: number; roundingIqd: number } {
  const dealIqd = Math.max(amountIqd, meta.dealIqd ?? amountIqd);
  return { dealIqd, roundingIqd: dealIqd - amountIqd };
}

/**
 * The stored rating from `orders.rate` input, or null for the plain "close early" call. Food is
 * scored only on kitchen/shop orders; tags or a note need a score to hang on (`invalid_input`).
 */
export function ratingFrom(order: Pick<OrderRecord, 'type'>, input: RateOrderInput, at: Date): OrderRating | null {
  const delivery = input.delivery ?? null;
  const food = input.food ?? null;
  const tags = [...new Set(input.tags ?? [])];
  const courierReasons = [...new Set(input.courierReasons ?? [])];
  const note = input.note?.trim() ? input.note.trim() : null;
  if (food !== null && !MERCHANT_ORDER_TYPES.includes(order.type)) throw new DriverError('invalid_input');
  // Courier reasons hang on the courier score and must be the set offered under it (low / good, ride / delivery).
  if (courierReasons.length > 0) {
    if (delivery === null) throw new DriverError('invalid_input');
    const offered = courierReasonsFor(delivery, order.type === 'ride');
    if (courierReasons.some((r) => !offered.includes(r))) throw new DriverError('invalid_input');
  }
  if (delivery === null && food === null) {
    if (tags.length > 0 || note !== null) throw new DriverError('invalid_input');
    return null;
  }
  return { delivery, food, tags, ...(courierReasons.length > 0 ? { courierReasons } : {}), note, ratedAt: at };
}

/** A scored rating is taken until `RATING_RULES.windowHours` after the order reached the customer. */
export function ratingWindowClosed(order: Pick<OrderRecord, 'deliveredAt'>, now: Date): boolean {
  return order.deliveredAt !== null && now.getTime() > order.deliveredAt.getTime() + RATING_RULES.windowHours * 3_600_000;
}

export function lineValue(l: Pick<OrderLineRecord, 'qty' | 'unitPriceIqd' | 'modifiers'>): number {
  const mods = l.modifiers.reduce((a, m) => a + (typeof m.priceIqd === 'number' ? m.priceIqd : 0), 0);
  return l.qty * (l.unitPriceIqd + mods);
}

function pendingProposal(lines: readonly OrderLineRecord[]): { lines: OrderLineRecord[]; proposedAt: Date; prepMinutes: number; reducedDiscountIqd: number | null } | null {
  const proposed = lines.filter((l) => l.substitution?.kind === 'unavailable' && l.substitution.state === 'proposed');
  if (proposed.length === 0) return null;
  const first = proposed[0]!.substitution!;
  return { lines: proposed, proposedAt: new Date(first.proposedAt), prepMinutes: first.prepMinutes, reducedDiscountIqd: first.reducedDiscountIqd ?? null };
}

interface Courier {
  tripId: string;
  courierId: string;
  vertical: Vertical;
}

/** The kind-tagged money fact shared by `order.cash_collected` and `order.closed`. */
type MoneyFact = DistributiveOmit<DomainEventInput<'order.closed'>, 'from' | 'to' | 'reason' | 'totalIqd'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * The no-change credit a drop-off event carries, re-checked against the order (the trips module
 * checked it before completing the stop; an event that fails here posts no extra rather than
 * retrying forever). 0 when none.
 */
function noChangeExtra(order: OrderRecord, cash: number | null, raw: unknown): number {
  if (typeof raw !== 'number' || raw <= 0 || cash === null) return 0;
  const ok = changeToWalletProblem({ paymentMethod: order.paymentMethod, totalIqd: order.totalIqd, collectedIqd: cash, changeToWalletIqd: raw }, ORDERS_RULES.changeToWallet) === null;
  return ok ? raw : 0;
}

function verticalOf(e: TripEventEnvelope): Vertical {
  const v = e.payload['vertical'];
  return typeof v === 'string' ? (v as Vertical) : 'food';
}

/** Lines tagged to a participant, as the ledger's points split wants them (domain §3); untagged lines are the orderer's. */
function participantShares(agg: OrderAggregate): ParticipantShare[] {
  const byParticipant = new Map<string, number>();
  for (const l of agg.lines) {
    if (!l.participantId || l.substitution?.state === 'removed') continue;
    byParticipant.set(l.participantId, (byParticipant.get(l.participantId) ?? 0) + lineValue(l));
  }
  const out: ParticipantShare[] = [];
  for (const p of agg.participants) {
    const itemsIqd = byParticipant.get(p.id);
    if (!itemsIqd) continue;
    if (p.personId) out.push({ personId: p.personId, itemsIqd });
    else if (p.phoneHash) out.push({ phoneHash: p.phoneHash, itemsIqd });
  }
  return out;
}

/** Pricing's fee splits resolved to who gets the money: the merchant, or the driver on the trip. */
function beneficiariesOf(fee: CancellationFee, order: OrderRecord, trip: Trip | null): CancellationBeneficiary[] {
  return fee.splits.map((s) => {
    if (s.to === 'merchant' && order.merchantOrgId) return { kind: 'merchant' as const, id: order.merchantOrgId, amountIqd: s.amountIqd };
    if ((s.to === 'courier' || s.to === 'driver') && trip?.courierId) return { kind: 'driver' as const, id: trip.courierId, amountIqd: s.amountIqd };
    throw new Error(`cancellation split to ${s.to} has no party on order ${order.id}`);
  });
}

function dateOrNull(v: unknown): Date | null {
  return typeof v === 'string' || v instanceof Date ? new Date(v) : null;
}

export function toOrderView(agg: OrderAggregate): Order {
  const { order, lines, participants } = agg;
  const proposal = pendingProposal(lines);
  const removedValue = proposal ? proposal.lines.reduce((a, l) => a + lineValue(l), 0) : 0;
  return {
    id: order.id,
    cityId: order.cityId,
    type: order.type,
    state: order.state,
    ordererId: order.ordererId,
    merchantOrgId: order.merchantOrgId,
    householdOrgId: order.householdOrgId,
    ...(order.heldForPayer ? { heldForPayer: true } : {}),
    ...(order.familyTable ? { familyTable: true } : {}),
    ...(order.preferredDriverId ? { preferredDriverId: order.preferredDriverId } : {}),
    ...(order.familyPreferred ? { familyPreferred: true } : {}),
    ...(order.rideCargo?.length ? { rideCargo: [...order.rideCargo] } : {}),
    quoteId: order.quoteId,
    paymentMethod: order.paymentMethod,
    itemsTotalIqd: order.itemsTotalIqd,
    deliveryFeeIqd: order.deliveryFeeIqd,
    serviceFeeIqd: order.serviceFeeIqd,
    discountIqd: order.discountIqd,
    tipIqd: order.tipIqd,
    smallOrderFeeIqd: order.smallOrderFeeIqd ?? 0,
    pointsRedeemed: order.pointsRedeemed ?? 0,
    pointsIqd: pointsIqdOf(order),
    totalIqd: order.totalIqd,
    changeIqd: changeOf(order),
    minVehicleClass: order.minVehicleClass,
    cateringRequest: MERCHANT_ORDER_TYPES.includes(order.type) && order.itemsTotalIqd > CATERING_ABOVE_IQD,
    lines: lines.map((l) => ({
      id: l.id,
      catalogItemId: l.catalogItemId,
      freeText: l.freeText,
      qty: l.qty,
      unitPriceIqd: l.unitPriceIqd,
      modifiers: l.modifiers,
      participantId: l.participantId,
      note: l.note,
      pointsEligible: l.pointsEligible,
      availability: l.substitution?.state === 'proposed' ? 'unavailable' : l.substitution?.state === 'removed' ? 'removed' : 'available',
    })),
    participants: participants.map((p) => ({ id: p.id, role: p.role, personId: p.personId, phoneOnly: p.personId === null && p.phoneHash !== null, label: p.label, note: p.note })),
    partial: proposal
      ? {
          unavailableLineIds: proposal.lines.map((l) => l.id),
          proposedAt: proposal.proposedAt,
          deadline: new Date(proposal.proposedAt.getTime() + ORDERS_RULES.partialApprovalSec * 1000),
          reducedItemsTotalIqd: order.itemsTotalIqd - removedValue,
          reducedTotalIqd: reducedTotalOf(order, removedValue, proposal.reducedDiscountIqd),
        }
      : null,
    scheduledFor: order.scheduledFor,
    merchantOfferedAt: order.merchantOfferedAt,
    promisedReadyAt: order.promisedReadyAt,
    prepExtendedAt: order.prepExtendedAt ?? null,
    handedOverAt: order.handedOverAt ?? null,
    placedAt: order.placedAt,
    acceptedAt: order.acceptedAt,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
    pickedUpAt: order.pickedUpAt,
    deliveredAt: order.deliveredAt,
    closedAt: order.closedAt,
    cancelledAt: order.cancelledAt,
    cancellationReason: order.cancellationReason,
    cancellationFeeIqd: order.cancellationFeeIqd,
    refundState: order.refundState,
    note: order.note,
    courierNote: order.courierNote ?? null,
    clientRequestId: order.clientRequestId ?? null,
    rating: order.rating ?? null,
    discount: discountView(order),
    statedTenderIqd: order.statedTenderIqd ?? null,
    changeToWalletIqd: order.changeToWalletIqd ?? null,
    gift: giftView(order),
  };
}

/**
 * Audit d-5: the honest-delay promise checkout shows — every delivery with a promised time (food and
 * catalog grocery): the delivery fee back, or the fixed credit when delivery is free (`latePromiseTerms`).
 */
export function latePromiseOf(
  type: string,
  deliveryFeeIqd: number,
  discount: { meta: { target: string }; amountIqd: number } | null | undefined,
): { afterMin: number; creditIqd: number; basis: LatePromiseBasis } | null {
  if (type !== 'food' && type !== 'grocery_catalog') return null;
  const terms = latePromiseTerms({ deliveryFeeIqd, discount: discount ? { target: discount.meta.target, amountIqd: discount.amountIqd } : null });
  return terms ? { afterMin: AZIZIYAH_MONEY_RULES.latePromise.afterMin, ...terms } : null;
}
