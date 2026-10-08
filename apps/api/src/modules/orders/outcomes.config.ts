/**
 * W3 "staff way-out and money outcomes": every money outcome Ali has not decided yet (plan §5.1,
 * M-1 … M-4, M-10) sits behind its own switch, **off by default**. The numbers are the plan's
 * recommended values, so switching one on is the only change Ali has to approve. Nothing here
 * changes an existing amount or who is paid; with every switch off the money is what it was.
 *
 * Each switch reads an environment variable (`on` / `true` / `1` switches it on), so a deployment
 * turns one on without a code change. Tests pass their own `OrderOutcomeRules`. A rule Ali has decided
 * (c6 remake pay, M-3 owed fees on the next order) is on by default and its variable switches it off.
 */
export const DISPUTE_OUTCOMES = ['stands', 'refund_full', 'refund_partial', 'redelivery', 'void'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

/** Who pays the kitchen for food already cooked when the platform failed and the customer cancelled free (M-2). */
export type CookedFoodPayer = 'platform' | 'merchant';

export interface OrderOutcomeRules {
  /** M-1 (NTF-01): ending a complaint. */
  disputes: {
    /**
     * The outcomes staff may apply (`DISPUTE_OUTCOMES`). Empty = `orders.ops.resolveDispute` is refused
     * with `money_rule_off`, except `void`, which moves no money and is always allowed. Recommended: all of them (env `DISPUTE_OUTCOMES=stands,refund_full,…` or `all`).
     */
    outcomes: readonly DisputeOutcome[];
    /** A refund above this needs the escalation owner (admin); support decides up to it (recommended 25,000). */
    agentLimitIqd: number;
    /** The deadline watchdog (env `DISPUTE_AUTO_OUTCOME`): off by default. */
    auto: { enabled: boolean; escalateAfterH: number; standsAfterH: number };
  };
  /** M-2 (NTF-11): when we fail, the customer cancels free. */
  platformFailure: {
    /** env `PLATFORM_FAILURE_FREE_CANCEL`. Off: the normal cancellation fee applies (today's rule). */
    freeCancel: boolean;
    /** env `PLATFORM_FAILURE_FOOD_PAYER` (`platform` | `merchant`): who carries food already cooked. */
    cookedFoodPayer: CookedFoodPayer;
    /** Ready food with no courier for this long is a failure (dispatch ran out of couriers). */
    noCourierAfterMin: number;
    /** The kitchen silent this long past its promised ready time (no heartbeat) is a failure. */
    kitchenSilentAfterMin: number;
    /** A ride driver who accepted and has not reached the pickup this long after is a failure. */
    driverNoShowAfterMin: number;
  };
  /** M-3 (THIN-01): a cash customer's unpaid cancellation fees. */
  cashDebt: {
    /** env `CASH_DEBT_BLOCK`: refuse cash orders past the limits below. Off: owed money is shown, never blocks. */
    block: boolean;
    maxUnpaidFees: number;
    maxOwedIqd: number;
    /**
     * env `CASH_DEBT_COLLECT` («ينضاف لطلبك الجاي»): what he owes (in whole 250s) is added to the cash he
     * hands over on his next food or shop order, locked on the order when it is placed and settled
     * back onto his wallet (`debt_settled`) when the courier takes the cash. Off: it stays owed.
     * Ali switched it ON on 2026-10-08 ("yes", 16:39Z); `CASH_DEBT_COLLECT=off` stops it.
     */
    collectOnNext: boolean;
  };
  /** M-4 (SEC-10): how many cash orders one account may have open at once. */
  openCash: {
    /** env `OPEN_CASH_CAP`. */
    enabled: boolean;
    /** Accounts with fewer completed orders than this are new. */
    newAccountBelowCompleted: number;
    newAccountMax: number;
    regularMax: number;
    /** env `PREPAY_AFTER_NO_ANSWER`: after a «ما جاوب بالباب» the next order must be paid from the wallet. */
    prepayAfterNoAnswer: boolean;
  };
  /** M-10 (NTF-13): the courier disappeared with the food. */
  courierLost: {
    /** env `COURIER_LOST_REFUND`: the order ends at once with nothing charged and the kitchen paid by the platform. */
    refund: boolean;
    /** env `COURIER_LOST_CHARGE`: after ops confirms, the food cost goes on the courier's cash account. */
    chargeCourier: boolean;
  };
  /**
   * c6 (Ali's shop pick, 2026-10-08): the food was ready and no courier reached the pass within
   * `afterReadyMin` of «جاهز», so the kitchen remakes it and Driver pays the first batch (items at menu
   * price, once per order, `order:<id>:remake`). Ali switched it ON on 2026-10-08 ("yes", 14:18Z);
   * env `MERCHANT_REMAKE_PAY=off` turns it off without a code change.
   */
  remake: { pay: boolean; afterReadyMin: number };
  /** M-13 (THIN-12): env `AGENT_CASH_ACCOUNTS`: an agent's top-up cash sits on his own `cash:` account until handed in. */
  agentCashAccounts: boolean;
}

/** The plan's recommended values with every switch off. */
export const DEFAULT_ORDER_OUTCOME_RULES: OrderOutcomeRules = {
  disputes: { outcomes: [], agentLimitIqd: 25_000, auto: { enabled: false, escalateAfterH: 48, standsAfterH: 72 } },
  platformFailure: { freeCancel: false, cookedFoodPayer: 'platform', noCourierAfterMin: 15, kitchenSilentAfterMin: 10, driverNoShowAfterMin: 15 },
  cashDebt: { block: false, maxUnpaidFees: 2, maxOwedIqd: 5_000, collectOnNext: true },
  openCash: { enabled: false, newAccountBelowCompleted: 3, newAccountMax: 1, regularMax: 2, prepayAfterNoAnswer: false },
  courierLost: { refund: false, chargeCourier: false },
  remake: { pay: true, afterReadyMin: 10 },
  agentCashAccounts: false,
};

export const ORDER_OUTCOME_RULES = Symbol('ORDER_OUTCOME_RULES');

function off(v: string | undefined): boolean {
  return v !== undefined && ['off', 'false', '0', 'no'].includes(v.trim().toLowerCase());
}

function on(v: string | undefined): boolean {
  return v !== undefined && ['on', 'true', '1', 'yes'].includes(v.trim().toLowerCase());
}

/** The switches from the environment; anything unset or unknown stays at the default (off). */
export function outcomeRulesFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): OrderOutcomeRules {
  const d = DEFAULT_ORDER_OUTCOME_RULES;
  const raw = env['DISPUTE_OUTCOMES']?.trim().toLowerCase() ?? '';
  const outcomes = raw === 'all' ? [...DISPUTE_OUTCOMES] : raw.split(',').map((s) => s.trim()).filter((s): s is DisputeOutcome => (DISPUTE_OUTCOMES as readonly string[]).includes(s));
  const payer = env['PLATFORM_FAILURE_FOOD_PAYER']?.trim().toLowerCase();
  return {
    disputes: { ...d.disputes, outcomes, auto: { ...d.disputes.auto, enabled: on(env['DISPUTE_AUTO_OUTCOME']) } },
    platformFailure: { ...d.platformFailure, freeCancel: on(env['PLATFORM_FAILURE_FREE_CANCEL']), cookedFoodPayer: payer === 'merchant' ? 'merchant' : 'platform' },
    cashDebt: { ...d.cashDebt, block: on(env['CASH_DEBT_BLOCK']), collectOnNext: !off(env['CASH_DEBT_COLLECT']) },
    openCash: { ...d.openCash, enabled: on(env['OPEN_CASH_CAP']), prepayAfterNoAnswer: on(env['PREPAY_AFTER_NO_ANSWER']) },
    courierLost: { refund: on(env['COURIER_LOST_REFUND']), chargeCourier: on(env['COURIER_LOST_CHARGE']) },
    remake: { ...d.remake, pay: !off(env['MERCHANT_REMAKE_PAY']) },
    agentCashAccounts: on(env['AGENT_CASH_ACCOUNTS']),
  };
}

/** A copy of the defaults with some switches changed (tests and the simulator). */
export function outcomeRules(patch: { [K in keyof OrderOutcomeRules]?: OrderOutcomeRules[K] extends object ? Partial<OrderOutcomeRules[K]> : OrderOutcomeRules[K] } = {}): OrderOutcomeRules {
  const d = DEFAULT_ORDER_OUTCOME_RULES;
  return {
    disputes: { ...d.disputes, ...patch.disputes },
    platformFailure: { ...d.platformFailure, ...patch.platformFailure },
    cashDebt: { ...d.cashDebt, ...patch.cashDebt },
    openCash: { ...d.openCash, ...patch.openCash },
    courierLost: { ...d.courierLost, ...patch.courierLost },
    remake: { ...d.remake, ...patch.remake },
    agentCashAccounts: patch.agentCashAccounts ?? d.agentCashAccounts,
  };
}
