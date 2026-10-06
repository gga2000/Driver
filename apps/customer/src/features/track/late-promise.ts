import type { LatePromise, LatePromiseBasis } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

const MIN = 60_000;

/** Where an order stands against the honest-delay promise (audit d-5), for the late banner's bar. */
export interface PromiseBar {
  /** 0 → 1 from the promised time to the threshold; 1 once the credit is posted. */
  progress: number;
  /** Whole minutes past the promised time, capped at the threshold. */
  elapsedMin: number;
  afterMin: number;
  deadlineAt: Date;
  /** What comes back (the delivery fee, or the free-delivery fixed credit) — or what came back, once credited. */
  amountIqd: number;
  basis: LatePromiseBasis;
  credited: boolean;
  /** The server sent its one apology (promised time + `apologyAfterMin`). */
  apologized: boolean;
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
    basis: p.basis,
    credited,
    apologized: Boolean(p.apology),
  };
}

/**
 * The new ETA already lands after the promise's deadline, so the credit is coming either way: say that
 * plainly instead of "if it isn't there by …", which reads as a bet the customer has already won.
 */
export function etaPastDeadline(bar: PromiseBar | null, eta: Date | null | undefined): boolean {
  return Boolean(bar && !bar.credited && eta && eta.getTime() >= bar.deadlineAt.getTime());
}

/**
 * Whether this screen should say "رجعنالك … رصيد" now: the server posted the credit and this device
 * has not told the person about this order yet (once per order per app run).
 */
export function creditToastDue(seen: ReadonlySet<string>, orderId: string, p: LatePromise | null | undefined): boolean {
  return Boolean(p?.credit) && !seen.has(orderId);
}

/**
 * The promise's copy (Ali, 2026-10-06): "أجرة التوصيل ترجعلك" only when the credit is the delivery fee
 * the customer pays; a free-delivery order's fixed credit is said as "رصيد" ("حطينالك"), never as a fee
 * he did not pay.
 */
export function promiseCopy(basis: LatePromiseBasis) {
  const flat = basis === 'flat';
  return {
    line: flat ? 'promise.line_flat' : 'promise.line',
    checkoutHint: flat ? 'promise.checkout_hint_flat' : 'promise.checkout_hint',
    barUntil: flat ? 'promise.bar_until_flat' : 'promise.bar_until',
    barPast: flat ? 'promise.bar_past_flat' : 'promise.bar_past',
    credited: flat ? 'promise.credited_flat' : 'promise.credited',
    toast: flat ? 'promise.toast_flat' : 'promise.toast',
    receiptHint: flat ? 'promise.receipt_hint_flat' : 'promise.receipt_hint',
    noteLateCredit: flat ? 'track.note_late_credit_flat' : 'track.note_late_credit',
  } as const satisfies Record<string, MessageKey>;
}
