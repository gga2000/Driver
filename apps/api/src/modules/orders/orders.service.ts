import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
  DriverError,
  MERCHANT_PREP_EXTENSION,
  PlaceOrderInput,
  cashToHand,
  TERMINAL_ORDER_STATES,
  encodeDomainEvent,
  isDomainEventType,
  orderTicketNumber,
  parseOrderTicket,
  type CancellationBeneficiary,
  type CancellationFee,
  type DisputeKind,
  type DomainEventInput,
  type Order,
  type OrderQuote,
  type OrderRating,
  type OrderSearchPage,
  type OrderState,
  type ParticipantShare,
  type RateOrderInput,
  type Trip,
  type Vertical,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { startOfLocalDay } from '../../shared/local-time.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { advisoryXactLock } from '../../shared/db/advisory-lock.js';
import { KeyedLock } from '../../shared/keyed-lock.js';
import { jobKey, type Queue } from '../../shared/queue.js';
import type { CancellationSubject } from '../pricing/index.js';
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
import { activePauseWindow } from './pause.js';
import { busyExtraMinutes } from './busy.js';
import { NoPromotions, ORDERS_PROMOTIONS, type MerchantDealQuery, type PromotionsPort, type ResolvedPromotion } from './promotions.port.js';
import { PARTICIPANT_RESOLVER, allocatePoints, assertLineTags, orderPoints, resolveParticipants, type ParticipantResolver } from './participants.js';

/** The slice of trips the orders module drives (courier release, cancellations, rider completion, settlement). */
export interface OrdersTripsPort {
  activeForOrder(orderId: string): Promise<Trip | null>;
  detachOrder(tripId: string, orderId: string, actorId?: string, reason?: string): Promise<Trip>;
  cancel(tripId: string, by: 'driver' | 'customer' | 'platform', actorId: string, reason: string): Promise<Trip>;
  customerComplete(tripId: string, customerId: string, reason?: string): Promise<Trip>;
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
}

export const ORDERS_WALLET = Symbol('ORDERS_WALLET');

/** Pricing as orders uses it: the server quote that fixes an order's fees, and cancellation fees. */
export interface OrdersPricingPort extends QuotePort {
  cancellationFee(subject: CancellationSubject, at: Date, cityId?: string): CancellationFee;
}

export const ORDERS_TRIPS = Symbol('ORDERS_TRIPS');
export const ORDERS_PRICING = Symbol('ORDERS_PRICING');
export const ORDERS_QUEUE = Symbol('ORDERS_QUEUE');

export const ORDER_JOBS = {
  autoReject: 'merchant.autoReject',
  autoClose: 'order.autoClose',
  partialTimeout: 'order.partialTimeout',
  offerToMerchant: 'order.offerToMerchant',
  readyOverdue: 'merchant.readyOverdue',
  courierRelease: 'merchant.courierRelease',
} as const;

export interface OrderTimerJob {
  orderId: string;
  /** The run the job belongs to (offer time, proposal time, promised-ready time); stale runs are no-ops. */
  refMs?: number;
}

const SYSTEM = 'system';
const PRE_PICKUP_COURIER_STATES = ['accepted', 'en_route_to_pickup', 'arrived_pickup'];

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
  ) {
    this.promotions = promotions ?? new NoPromotions();
  }

  private readonly promotions: PromotionsPort;
  /** One placing at a time per (orderer, client request id) in this instance (no duplicate orders). */
  private readonly placeLock = new KeyedLock();

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

  /** The order already placed with this request's key, as `place` answered it; null when none. */
  private async replay(ordererId: string, input: z.output<typeof PlaceOrderInput>, tx?: Tx): Promise<Order | null> {
    if (!input.clientRequestId) return null;
    const prior = await this.repo.findByClientRequest(ordererId, input.clientRequestId, tx);
    if (!prior) return null;
    // A key belongs to one checkout attempt: re-used for a different order it is a client bug, not a retry.
    if (prior.order.type !== input.type || prior.order.merchantOrgId !== (input.merchantOrgId ?? null)) throw new DriverError('invalid_input');
    return this.view(prior.order.id, tx);
  }

  private async placeOnce(ordererId: string, input: z.output<typeof PlaceOrderInput>): Promise<Order> {
    const now = this.clock.now();
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
    const participants = await resolveParticipants(input.participants, this.participants);
    assertLineTags(input.type === 'ride' ? [] : input.lines, participants);
    if (input.type === 'ride') assertExpected(input.fareIqd, fees.fareIqd);
    assertExpected(input.deliveryFeeIqd, fees.deliveryFeeIqd);
    assertExpected(input.serviceFeeIqd, fees.serviceFeeIqd);
    // The cart's expected discount (from `orders.quote`): a deal that ended, ran out or changed since
    // is a refresh, never a silent change of what the customer pays.
    const discount = p.discount?.amountIqd ?? 0;
    if (input.discountIqd !== undefined && input.discountIqd !== discount) throw new DriverError(input.promoCode ? 'price_changed' : 'deal_changed');
    const total = p.totalIqd;
    // Decisions §4: a new account's first three cash orders are capped and get the arriving call —
    // on the server-computed total.
    const risk = input.paymentMethod === 'cash' ? await this.cashRisk.newCustomerCash(ordererId, total) : null;
    if (risk && !risk.allowed) throw new DriverError('new_customer_cash_cap');
    // C-04: a wallet order must be covered by what the wallet has left after his open wallet orders.
    if (input.paymentMethod === 'wallet' && this.wallet && total > 0) {
      const available = await this.walletAvailable(ordererId, input.householdOrgId ?? null);
      if (available < total) throw new DriverError('wallet_insufficient');
    }

    return this.uow.run(async (tx) => {
      if (input.clientRequestId) {
        // Another API instance placing with the same key commits (or rolls back) before we look.
        await advisoryXactLock(tx, `orders.place:${ordererId}:${input.clientRequestId}`);
        const prior = await this.replay(ordererId, input, tx);
        if (prior) return prior;
      }
      // The deal's spend is reserved in this transaction, atomically against its budget cap: two
      // orders can never both spend the last of it (the later one is asked to refresh).
      if (p.discount && p.discount.meta.funder === 'merchant' && discount > 0) {
        if (!(await this.promotions.reserve(p.discount.promotionId, discount, tx))) throw new DriverError('deal_changed');
      }
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
          tipIqd: input.tipIqd,
          totalIqd: total,
          note: input.note ?? null,
          courierNote: input.courierNote?.trim() ? input.courierNote.trim() : null,
          clientRequestId: input.clientRequestId ?? null,
          scheduledFor: input.scheduledFor ?? null,
          minVehicleClass: caps?.minVehicleClass ?? null,
          dropoff: input.dropoff ?? null,
          placedAt: now,
        },
        newLines,
        participants.map((pp) => ({ ref: pp.ref, role: pp.role, personId: pp.personId, phoneHash: pp.phoneHash, label: pp.label, note: pp.note })),
        tx,
      );
      const order = agg.order;
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
        arrivingCallRequired: risk?.requiresArrivingCall ?? false,
        // Rides: what dispatch needs to build the trip and find a driver (`dispatch:ride-request`).
        ...(order.type === 'ride' ? { ride: { vertical: input.rideVertical ?? 'taxi', pickup: input.pickup ?? null, dropoff: input.dropoff ?? null, quoteId: input.quoteId ?? null } } : {}),
        ...(discount > 0 && p.discount ? { discountIqd: discount, promotionId: p.discount.promotionId, discountFunder: p.discount.meta.funder } : {}),
      });
      for (const l of agg.lines) if (l.participantId) await this.emit(tx, 'line.tagged', ordererId, order, { lineId: l.id, participantId: l.participantId });
      if (caps?.catering) await this.emit(tx, 'order.catering_request', SYSTEM, order, { itemsTotalIqd: itemsTotal, dispatcherCard: true });

      if (merchantType && profile) {
        const leadMin = profile.defaultPrepMin + busyExtraMinutes(profile, now) + ORDERS_RULES.scheduledLeadMin;
        const offerAt = order.scheduledFor ? new Date(order.scheduledFor.getTime() - leadMin * 60_000) : now;
        if (offerAt.getTime() <= now.getTime()) await this.offerToMerchant(order, profile, tx);
        else await this.queue.add(ORDER_JOBS.offerToMerchant, { orderId: order.id }, { delayMs: offerAt.getTime() - now.getTime(), jobId: jobKey('order', order.id, 'offer') });
      }
      return this.view(order.id, tx);
    });
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
      totalIqd: p.totalIqd,
      changeIqd: p.changeIqd,
      discount: d ? { promotionId: d.promotionId, amountIqd: d.amountIqd, ...d.meta, ...roundingOf(d.meta, d.amountIqd) } : null,
      lineSavingsIqd: d ? d.lineSavingsIqd : p.newLines.map(() => 0),
      dealLineSavingsIqd: d ? d.dealLineSavingsIqd : p.newLines.map(() => 0),
      roundingIqd: 0,
      nextDeal: next ? { dealId: next.promotionId, label_ar: next.label_ar, label_en: next.label_en, missingIqd: next.missingIqd } : null,
    };
  }

  /**
   * C-04: what a wallet can still pay — its ledger balance less the customer's open wallet orders
   * (the ledger charges a wallet order when it closes, so an open one already spoke for its total).
   */
  private async walletAvailable(customerId: string, householdId: string | null): Promise<number> {
    if (!this.wallet) return Number.POSITIVE_INFINITY;
    const [balance, mine] = await Promise.all([this.wallet.balanceIqd({ customerId, householdId }), this.repo.forPerson(customerId)]);
    const held = mine
      .filter((o) => o.ordererId === customerId && o.paymentMethod === 'wallet' && (o.householdOrgId ?? null) === householdId && !TERMINAL_ORDER_STATES.includes(o.state))
      .reduce((a, o) => a + o.totalIqd, 0);
    return balance - held;
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
    // Apps review #11: the restaurant minimum, on the menu-priced items before any deal (a deal's own
    // minimum is checked by the deal engine, separately). The checkout summary shows it instead.
    if (!opts.quote && storefront && storefront.minOrderIqd > 0 && itemsTotal < storefront.minOrderIqd) throw new DriverError('order_below_minimum');
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
    const preTotal = input.type === 'ride' ? fees.fareIqd + input.tipIqd : itemsTotal + fees.deliveryFeeIqd + fees.serviceFeeIqd + input.tipIqd;
    const discount = await this.discountFor(ordererId, input, { merchantType, newLines, itemsTotal, fees, preTotal, now });
    const priceIqd = Math.max(0, preTotal - (discount?.amountIqd ?? 0));
    const { totalIqd, changeIqd } = payable(input.type, input.paymentMethod, priceIqd);
    const caps = merchantType || input.type === 'errand' ? vehicleRequirement(itemsTotal, itemCount) : null;
    return { merchantType, profile, newLines, itemsTotal, fees, discount, totalIqd, changeIqd, caps };
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
    if (order.merchantOfferedAt || order.state !== 'placed') return;
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
    return this.uow.run(async (tx) => {
      const { order } = await this.load(input.orderId, tx);
      if (order.ordererId !== actorId) throw new DriverError('forbidden');
      const rating = ratingFrom(order, input, this.clock.now());
      if (order.rating) return this.view(order.id, tx);
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
    const live = (await this.repo.findMany({ ...(filter.cityId ? { cityId: filter.cityId } : {}), ...(filter.merchantOrgId ? { merchantOrgId: filter.merchantOrgId } : {}) })).filter(
      (o) => !TERMINAL_ORDER_STATES.includes(o.state),
    );
    return Promise.all(live.map((o) => this.view(o.id)));
  }

  async listForPerson(personId: string): Promise<Order[]> {
    const orders = await this.repo.forPerson(personId);
    return Promise.all(orders.map((o) => this.view(o.id)));
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
    if (order.type === 'ride') {
      const cash = typeof e.payload['cashCollectedIqd'] === 'number' ? (e.payload['cashCollectedIqd'] as number) : null;
      return order.state === 'matched' ? this.completeRide(order, e.actorId, tx, { by: 'driver', tripId: e.tripId }, cash) : undefined;
    }
    if (order.state !== 'picked_up') return;
    const now = this.clock.now();
    const next = await this.move(order, 'delivered', e.actorId, tx, { deliveredAt: now }, { tripId: e.tripId, courierId: e.actorId });
    const cash = typeof e.payload['cashCollectedIqd'] === 'number' ? (e.payload['cashCollectedIqd'] as number) : null;
    if (order.paymentMethod === 'cash') await this.cashCollected(next, { tripId: e.tripId, courierId: e.actorId, vertical: verticalOf(e) }, cash ?? order.totalIqd, tx);
    await this.scheduleClose(next, now);
    return next;
  }

  /**
   * Edge-case §3 merchant cash account: a cash order creates `merchant_payable` net of commission
   * the moment the courier collects; the courier now holds the merchant's money until settlement.
   * `order.cash_collected` carries the full money fact, so the ledger posts it at once.
   */
  private async cashCollected(order: OrderRecord, courier: Courier, amountIqd: number, tx: Tx): Promise<void> {
    const fact = await this.moneyFact(order, courier, amountIqd, tx);
    const collected: DomainEventInput<'order.cash_collected'> = {
      ...fact,
      tripId: courier.tripId,
      courierId: courier.courierId,
      amountIqd,
      expectedIqd: order.totalIqd,
      discrepancyIqd: amountIqd - order.totalIqd,
    };
    await this.emit(tx, 'order.cash_collected', courier.courierId, order, collected);
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
  private async moneyFact(order: OrderRecord, courier: Courier | null, cashCollectedIqd: number | undefined, tx: Tx): Promise<MoneyFact> {
    const now = this.clock.now();
    const payer = {
      customerId: order.ordererId,
      ...(order.householdOrgId ? { householdId: order.householdOrgId } : {}),
      payment: order.paymentMethod === 'cash' ? ('cash' as const) : ('wallet' as const),
      ...(cashCollectedIqd !== undefined ? { cashCollectedIqd } : {}),
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
          deliveryFeeIqd: order.deliveryFeeIqd,
          tipIqd: order.tipIqd,
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

  private async completeRide(order: OrderRecord, actorId: string, tx: Tx, payload: Record<string, unknown>, cashCollectedIqd?: number | null): Promise<OrderRecord> {
    const now = this.clock.now();
    const next = await this.move(order, 'completed', actorId, tx, { deliveredAt: now }, payload);
    if (order.paymentMethod === 'cash') {
      // The driver took the fare at the door: his cash cap moves now; the money posts once more, idempotently, on closed.
      const courier = await this.trips.courierOf(order.id);
      if (courier) await this.cashCollected(next, courier, cashCollectedIqd ?? order.totalIqd, tx);
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
    const fact = await this.moneyFact(agg.order, await this.trips.courierOf(order.id), undefined, tx);
    const closedPayload: DistributiveOmit<DomainEventInput<'order.closed'>, 'from' | 'to'> = { ...fact, reason, totalIqd: agg.order.totalIqd };
    const closed = await this.move(agg.order, 'closed', actorId, tx, { closedAt: now }, closedPayload);
    const profile = closed.merchantOrgId ? await this.merchants.profile(closed.merchantOrgId) : null;
    const revenue =
      closed.type === 'ride'
        ? Math.round((closed.totalIqd * ORDERS_RULES.rideTakePct) / 100)
        : closed.serviceFeeIqd + Math.round((commissionBaseOf(closed) * commissionPctOf(profile?.commissionTier ?? ORDERS_RULES.defaultCommissionTier)) / 100);
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
  const price = Math.max(0, order.itemsTotalIqd - removedIqd + order.deliveryFeeIqd + order.serviceFeeIqd + order.tipIqd - (reducedDiscountIqd ?? order.discountIqd));
  return payable(order.type, order.paymentMethod, price).totalIqd;
}

type PricedOrder = Pick<OrderRecord, 'type' | 'paymentMethod' | 'totalIqd' | 'itemsTotalIqd' | 'deliveryFeeIqd' | 'serviceFeeIqd' | 'tipIqd' | 'discountIqd'>;

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

/** The order's price before cash rounding: items + fees + tip − discount (rides: the stored total). */
export function orderPriceIqd(order: PricedOrder): number {
  if (order.type === 'ride') return order.totalIqd;
  return Math.max(0, order.itemsTotalIqd + order.deliveryFeeIqd + order.serviceFeeIqd + order.tipIqd - order.discountIqd);
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
  const note = input.note?.trim() ? input.note.trim() : null;
  if (food !== null && !MERCHANT_ORDER_TYPES.includes(order.type)) throw new DriverError('invalid_input');
  if (delivery === null && food === null) {
    if (tags.length > 0 || note !== null) throw new DriverError('invalid_input');
    return null;
  }
  return { delivery, food, tags, note, ratedAt: at };
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
    quoteId: order.quoteId,
    paymentMethod: order.paymentMethod,
    itemsTotalIqd: order.itemsTotalIqd,
    deliveryFeeIqd: order.deliveryFeeIqd,
    serviceFeeIqd: order.serviceFeeIqd,
    discountIqd: order.discountIqd,
    tipIqd: order.tipIqd,
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
  };
}
