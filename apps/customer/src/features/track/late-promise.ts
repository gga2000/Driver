import type { LatePromise } from '@driver/contracts';

const MIN = 60_000;

/** Where an order stands against the honest-delay promise (audit d-5), for the late banner's bar. */
export interface PromiseBar {
  /** 0 → 1 from the promised time to the threshold; 1 once the credit is posted. */
  progress: number;
  /** Whole minutes past the promised time, capped at the threshold. */
  elapsedMin: number;
  afterMin: number;
  deadlineAt: Date;
  /** What comes back (the delivery fee) — or what came back, once credited. */
  amountIqd: number;
  credited: boolean;
}

/**
 * The bar fills with the clock from the promised time to the server's threshold (`afterMin`); the
 * credit itself is the server's (`credit`), so a full bar without one says "any second now", never
 * "paid". Null when the order carries no promise.
 */
export function promiseBar(p: LatePromise | null | undefined, now: number): PromiseBar | null {
  if (!p) return null;
  const windowMs = p.afterMin * MIN;
  const start = p.deadlineAt.getTime() - windowMs;
  const elapsed = Math.max(0, now - start);
  const credited = Boolean(p.credit);
  return {
    progress: credited ? 1 : Math.min(1, elapsed / windowMs),
    elapsedMin: Math.min(p.afterMin, Math.floor(elapsed / MIN)),
    afterMin: p.afterMin,
    deadlineAt: p.deadlineAt,
    amountIqd: p.credit?.amountIqd ?? p.creditIqd,
    credited,
  };
}

/**
 * Whether this screen should say "رجعنالك … رصيد" now: the server posted the credit and this device
 * has not told the person about this order yet (once per order per app run).
 */
export function creditToastDue(seen: ReadonlySet<string>, orderId: string, p: LatePromise | null | undefined): boolean {
  return Boolean(p?.credit) && !seen.has(orderId);
}
