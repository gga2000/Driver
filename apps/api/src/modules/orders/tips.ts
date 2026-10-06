import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AFTER_TIP_MEMO,
  AZIZIYAH_MONEY_RULES,
  DriverError,
  OrderTippedPayload,
  afterTipGroupId,
  type MoneyRules,
  type Order,
  type OrderState,
  type TipOffer,
  type TipOfferReason,
  type TipResult,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { DistributedKeyedLock } from '../../shared/db/advisory-lock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { EventsService } from '../events/index.js';
import { Accounts, LedgerService } from '../ledger/index.js';
import { ORDERS_TRIPS, OrdersService, type OrdersTripsPort } from './orders.service.js';

/** The tip rules in force (`MoneyRules.afterTip`); Aziziyah's unless a test binds others. */
export const TIP_RULES = Symbol('TIP_RULES');

/** The event the notify module turns into «علي كرمك 1,000 دينار» for the driver. */
export const ORDER_TIPPED_EVENT = 'order.tipped';

/** States where the order reached the customer: food delivered (then closed by the rating), a ride completed. */
const TIPPABLE: readonly OrderState[] = ['delivered', 'closed', 'completed'];

const HOUR_MS = 3_600_000;

type Rules = MoneyRules['afterTip'];

/**
 * «تحب تكرم عباس؟» (Ali, 2026-10-06, docs/api/tips.md): the tip after a good rating, all rules here on
 * the server. Offered when the orderer rated the courier/driver ≥ `minRating`, the order reached him
 * (delivered / closed / completed, never disputed or refunded), no tip was given at checkout, a driver
 * carried it and it is within `windowHours` of delivery. Paid only from his own wallet (balance less
 * his open wallet orders, as at checkout): one balanced group `tip:<orderId>` — `tip` customer → the
 * driver's earnings, memo `after_rating`, 100 % to him. One per order: a replay of the same amount
 * returns the tip already given, another amount is `tip_already_given`. Serialised per customer so
 * two tips can't spend the same balance.
 */
@Injectable()
export class OrderTipsService {
  private readonly rules: Rules;

  private readonly lock: DistributedKeyedLock;

  constructor(
    private readonly orders: OrdersService,
    @Inject(ORDERS_TRIPS) private readonly trips: OrdersTripsPort,
    private readonly ledger: LedgerService,
    private readonly events: EventsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() uow?: UnitOfWork,
    @Optional() @Inject(TIP_RULES) rules?: Rules,
  ) {
    this.rules = rules ?? AZIZIYAH_MONEY_RULES.afterTip;
    this.lock = new DistributedKeyedLock(uow, 'orders.tip');
  }

  /** The tip already given on this order, from the ledger (null when none). */
  async given(orderId: string): Promise<{ amountIqd: number; at: Date } | null> {
    const line = (await this.ledger.eventsForGroups([afterTipGroupId(orderId)])).find(
      (e) => e.type === 'tip',
    );
    return line ? { amountIqd: line.amount, at: line.occurredAt } : null;
  }

  /** What his own wallet can spend: the ledger balance less his open wallet orders (charged at close). */
  async walletIqd(customerId: string): Promise<number> {
    const [balance, held] = await Promise.all([
      this.ledger.balance(Accounts.customer(customerId)),
      this.orders.openWalletHoldIqd(customerId),
    ]);
    return balance.amount - held;
  }

  /** Why the prompt does not show for this order now (null: it shows). Pure rules over the order. */
  reasonFor(order: Order, now: Date): TipOfferReason | null {
    if (!TIPPABLE.includes(order.state) || !order.deliveredAt) return 'not_delivered';
    if (order.tipIqd > 0) return 'tipped_at_checkout';
    const score = order.rating?.delivery;
    if (!order.rating || typeof score !== 'number') return 'not_rated';
    if (score < this.rules.minRating) return 'low_rating';
    if (now.getTime() > this.untilAt(order).getTime()) return 'window_closed';
    return null;
  }

  private untilAt(order: Pick<Order, 'deliveredAt'>): Date {
    return new Date((order.deliveredAt?.getTime() ?? 0) + this.rules.windowHours * HOUR_MS);
  }

  async options(customerId: string, orderId: string): Promise<TipOffer> {
    const order = await this.orders.get(orderId);
    if (order.ordererId !== customerId) throw new DriverError('forbidden');
    const [tip, walletIqd] = await Promise.all([this.given(orderId), this.walletIqd(customerId)]);
    let reason = this.reasonFor(order, this.clock.now());
    if (!reason && !tip && !(await this.trips.courierOf(orderId))) reason = 'no_driver';
    const offered = reason === null || tip !== null;
    return {
      orderId,
      offered,
      reason: tip ? null : reason,
      amountsIqd:
        offered && !tip
          ? [...this.rules.amountsIqd].sort((a, b) => a - b).filter((a) => a <= walletIqd)
          : [],
      walletIqd,
      untilAt: offered ? this.untilAt(order) : null,
      tip,
    };
  }

  async tip(customerId: string, input: { orderId: string; amountIqd: number }): Promise<TipResult> {
    if (!this.rules.amountsIqd.includes(input.amountIqd))
      throw new DriverError('tip_amount_invalid');
    return this.lock.run(customerId, async (tx) => {
      const order = await this.orders.get(input.orderId);
      if (order.ordererId !== customerId) throw new DriverError('forbidden');
      const prior = await this.given(order.id);
      if (prior) {
        if (prior.amountIqd !== input.amountIqd) throw new DriverError('tip_already_given');
        return {
          orderId: order.id,
          amountIqd: prior.amountIqd,
          at: prior.at,
          walletIqd: await this.walletIqd(customerId),
        };
      }
      const now = this.clock.now();
      const reason = this.reasonFor(order, now);
      if (reason === 'window_closed') throw new DriverError('tip_window_closed');
      if (reason === 'tipped_at_checkout') throw new DriverError('tip_already_given');
      if (reason) throw new DriverError('tip_not_offered');
      const courier = await this.trips.courierOf(order.id);
      if (!courier) throw new DriverError('tip_not_offered');
      const before = await this.walletIqd(customerId);
      if (before < input.amountIqd) throw new DriverError('wallet_insufficient');
      await this.post(
        {
          orderId: order.id,
          tripId: courier.tripId,
          customerId,
          courierId: courier.courierId,
          amountIqd: input.amountIqd,
          at: now,
        },
        tx,
      );
      return {
        orderId: order.id,
        amountIqd: input.amountIqd,
        at: now,
        walletIqd: before - input.amountIqd,
      };
    });
  }

  /** The balanced group and the driver's push event, in one transaction. */
  private async post(
    t: {
      orderId: string;
      tripId: string;
      customerId: string;
      courierId: string;
      amountIqd: number;
      at: Date;
    },
    tx: Tx | undefined,
  ): Promise<void> {
    await this.ledger.recordAll(
      {
        id: afterTipGroupId(t.orderId),
        kind: 'money',
        occurredAt: t.at,
        refs: { orderId: t.orderId, tripId: t.tripId },
        lines: [
          {
            type: 'tip',
            amount: t.amountIqd,
            fromAccount: Accounts.customer(t.customerId),
            toAccount: Accounts.driver(t.courierId),
            memo: AFTER_TIP_MEMO,
          },
        ],
        controls: [{ account: Accounts.customer(t.customerId), net: -t.amountIqd }],
      },
      tx,
    );
    const payload = OrderTippedPayload.parse({
      customerId: t.customerId,
      courierId: t.courierId,
      tripId: t.tripId,
      amountIqd: t.amountIqd,
    });
    await this.events.emit(
      tx,
      {
        type: ORDER_TIPPED_EVENT,
        actorId: t.customerId,
        occurredAt: t.at,
        orderId: t.orderId,
        tripId: t.tripId,
        idempotencyKey: afterTipGroupId(t.orderId),
        payload,
      },
      // Its own aggregate: a tip changes no order state.
      { name: 'tip', id: t.orderId },
    );
  }
}
