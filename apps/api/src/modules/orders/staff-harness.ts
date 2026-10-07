import { decodeDomainEvent } from '@driver/contracts';
import { LedgerService, PostingService, MerchantCashService } from '../ledger/index.js';
import { CashLimits } from './cash-limits.js';
import { OrdersStaffService, type OrderEventLog, type OrdersStaffPorts } from './orders.staff.js';
import { outcomeRules, type OrderOutcomeRules } from './outcomes.config.js';
import { ordersHarness } from './test-harness.js';

type Patch = Parameters<typeof outcomeRules>[0];

/**
 * The orders harness plus the W3 staff toolkit: a real in-memory ledger (orders' money events are
 * posted into it by `settle()`, as the ledger's outbox subscribers would), the Console audit log as
 * a list, admins by id, and the order event log read from the recorded events.
 */
export function staffHarness(patch: Patch = {}, opts: { ledger: { ledger: LedgerService; posting: PostingService; merchantCash?: MerchantCashService } }) {
  const h = ordersHarness();
  const rules: OrderOutcomeRules = outcomeRules(patch);
  const { ledger, posting } = opts.ledger;
  const audits: Array<{ id: string; action: string; actorId: string; subjectId: string; summaryAr: string; detail: Record<string, unknown> }> = [];
  const admins = new Set<string>(['ali']);
  const eventLog: OrderEventLog = {
    eventsOf: async (orderId) => h.events.events.filter((e) => e.orderId === orderId).map((e) => ({ type: e.type, occurredAt: e.occurredAt, payload: e.payload })),
  };
  const ports: OrdersStaffPorts = {
    ledger: { recordAll: (g, tx) => ledger.recordAll(g, tx), hasGroup: (id) => ledger.hasGroup(id), eventsForOrder: (id) => ledger.eventsForOrder(id) },
    audit: {
      record: async (input) => {
        const row = { id: `au_${audits.length + 1}`, action: input.action, actorId: input.actorId, subjectId: input.subjectId, summaryAr: input.summaryAr, detail: input.detail ?? {} };
        audits.push(row);
        return row;
      },
    },
    roles: { hasRole: async (personId) => admins.has(personId) },
    eventLog,
  };
  const staff = new OrdersStaffService(h.orders, h.repo, h.uow, h.clock, h.trips, h.merchants, rules, ports);
  h.orders.bindPlatformFailure(staff);
  const cashLimits = new CashLimits(h.cashRisk, h.repo, { balanceIqd: async (a) => (await ledger.balance(a)).amount, eventsFor: (a) => ledger.eventsFor(a) }, eventLog, rules);

  let posted = 0;
  /** Posts the orders' money events recorded since the last call (the ledger's subscribers), and runs the platform-failure subscriber. */
  async function settle(): Promise<void> {
    const pending = h.events.events.slice(posted);
    posted = h.events.events.length;
    for (const e of pending) {
      if (e.type === 'order.cash_collected') {
        const p = decodeDomainEvent('order.cash_collected', e.payload);
        if (p.kind === 'order') await posting.orderMoney(p.order);
      } else if (e.type === 'order.closed') {
        const p = decodeDomainEvent('order.closed', e.payload);
        if (p.kind === 'order') await posting.orderClosed(p.order);
        else if (p.kind === 'ride') await posting.ride(p.ride);
      } else if (e.type === 'order.cancelled') {
        await posting.cancellation(decodeDomainEvent('order.cancelled', e.payload));
        await staff.onOrderCancelled(e.payload);
      }
    }
  }

  const balance = async (account: string) => (await ledger.balance(account)).amount;

  /** A food order of c1's carried by d1 to the door (cash unless `wallet`), money posted. */
  async function delivered(opts2: { wallet?: boolean; customer?: string } = {}) {
    const customer = opts2.customer ?? 'c1';
    if (opts2.wallet) h.wallets.set(`customer:${customer}`, 100_000);
    const o = await h.orders.place(customer, h.foodInput(opts2.wallet ? { paymentMethod: 'wallet' } : {}));
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    await h.dropoff(t.id, opts2.wallet ? {} : { cashCollectedIqd: o.totalIqd });
    await settle();
    return { order: await h.orders.get(o.id), trip: t };
  }

  return { ...h, rules, staff, cashLimits, audits, admins, eventLog, ledger, settle, balance, delivered };
}
