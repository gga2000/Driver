import { DriverError, TERMINAL_ORDER_STATES, type CashStanding, type LedgerEvent, type OrderState } from '@driver/contracts';
import type { OrdersRepository, OrderRecord } from './orders.repository.js';
import type { OrdersCashRiskPort } from './orders.service.js';
import type { OrderEventLog } from './orders.staff.js';
import type { OrderOutcomeRules } from './outcomes.config.js';

/** The ledger reads the cash limits need: the customer's wallet balance and its lines. */
export interface CashLimitsLedgerPort {
  balanceIqd(account: string): Promise<number>;
  eventsFor(account: string): Promise<LedgerEvent[]>;
}

export const CASH_LIMITS = Symbol('CASH_LIMITS');

const FINISHED: readonly OrderState[] = ['delivered', 'completed', 'closed'];
const NOT_OPEN: readonly OrderState[] = ['delivered', 'completed', 'disputed'];

/**
 * W3 cash limits (SEC-10 / M-4, THIN-01 / M-3), wrapped around the ledger's new-customer cash rule
 * (`OrdersCashRiskPort`, decisions §4) so `orders.place` checks them without a change of its own:
 *  - open cash orders at once: 1 for an account with fewer than 3 completed orders, 2 after
 *    (`OPEN_CASH_CAP`); a complaint under review does not count as open;
 *  - after a «ما جاوب بالباب» the next order is paid from the wallet (`PREPAY_AFTER_NO_ANSWER`);
 *  - unpaid cancellation fees: shown always; with `CASH_DEBT_BLOCK`, 2 unpaid fees or more than
 *    5,000 owed stop cash orders until he pays by wallet or at an agent.
 * Every switch is off by default: then this only reads, and the decisions §4 rule is unchanged.
 */
export class CashLimits implements OrdersCashRiskPort {
  constructor(
    private readonly base: OrdersCashRiskPort,
    private readonly repo: Pick<OrdersRepository, 'forPerson'>,
    private readonly ledger: CashLimitsLedgerPort,
    private readonly eventLog: OrderEventLog,
    private readonly rules: OrderOutcomeRules,
  ) {}

  async newCustomerCash(customerId: string, orderTotalIqd: number): Promise<{ allowed: boolean; requiresArrivingCall: boolean; priorCashOrders: number }> {
    const s = await this.standing(customerId);
    if (s.blockedBy) throw new DriverError(s.blockedBy);
    return this.base.newCustomerCash(customerId, orderTotalIqd);
  }

  async standing(customerId: string): Promise<CashStanding> {
    const mine = (await this.repo.forPerson(customerId)).filter((o) => o.ordererId === customerId);
    // Open = not yet at his door: delivered (closing in 2 h) and complaints under review do not count.
    const openCashOrders = mine.filter((o) => o.paymentMethod === 'cash' && !TERMINAL_ORDER_STATES.includes(o.state) && !NOT_OPEN.includes(o.state)).length;
    const completed = mine.filter((o) => FINISHED.includes(o.state)).length;
    const oc = this.rules.openCash;
    const openCashLimit = oc.enabled ? (completed < oc.newAccountBelowCompleted ? oc.newAccountMax : oc.regularMax) : null;
    const { owedIqd, unpaidFees } = await this.debt(customerId);
    let blockedBy: CashStanding['blockedBy'] = null;
    if (oc.prepayAfterNoAnswer && (await this.lastWasNoAnswer(mine))) blockedBy = 'prepay_required';
    else if (this.rules.cashDebt.block && (unpaidFees >= this.rules.cashDebt.maxUnpaidFees || owedIqd > this.rules.cashDebt.maxOwedIqd)) blockedBy = 'cash_debt_blocked';
    else if (openCashLimit !== null && openCashOrders >= openCashLimit) blockedBy = 'open_cash_orders_cap';
    return { owedIqd, unpaidFees, openCashOrders, openCashLimit, cashAllowed: blockedBy === null, blockedBy };
  }

  /**
   * What he owes (a negative wallet) and how many cancellation fees make it up: walking his wallet's
   * lines oldest first, the count restarts each time the balance is back at 0 or above.
   */
  private async debt(customerId: string): Promise<{ owedIqd: number; unpaidFees: number }> {
    const account = `customer:${customerId}`;
    const balance = await this.ledger.balanceIqd(account);
    if (balance >= 0) return { owedIqd: 0, unpaidFees: 0 };
    const lines = [...(await this.ledger.eventsFor(account))].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    let running = 0;
    let fees = new Set<string>();
    for (const e of lines) {
      if (e.toAccount === account) running += e.amount;
      if (e.fromAccount === account) running -= e.amount;
      if (running >= 0) fees = new Set();
      else if (e.type === 'cancellation_fee' && e.fromAccount === account) fees.add(e.orderId ?? e.id);
    }
    return { owedIqd: -balance, unpaidFees: fees.size };
  }

  /** His latest finished order ended with him not answering at the door (`unreachable`, or failed). */
  private async lastWasNoAnswer(mine: readonly OrderRecord[]): Promise<boolean> {
    const done = mine.filter((o) => TERMINAL_ORDER_STATES.includes(o.state) || o.state === 'disputed').sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime());
    const last = done[0];
    if (!last || !last.pickedUpAt || last.deliveredAt) return false;
    if (last.state === 'failed') return true;
    return (await this.eventLog.eventsOf(last.id)).some((e) => (e.type === 'order.disputed' && e.payload['kind'] === 'unreachable') || e.type === 'order.failed');
  }
}
