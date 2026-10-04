import { roundToStep } from '../format';

/** One named price component (platform spec §5: every price is a sum of named, explained parts). */
export interface PriceItem {
  key: string;
  label: string;
  /** IQD; negative for discounts and points. */
  amount: number;
  /** One-line reason (`quote.reason.*`), revealed on tap. */
  reason?: string;
  /** Computed but not charged (metered distance/time before a city enables it). */
  shadow?: boolean;
}

export interface PriceSummary {
  shown: PriceItem[];
  shadow: PriceItem[];
  /** Sum of charged lines before rounding. */
  subtotal: number;
  /** total − change − subtotal; shown as its own line when non-zero so the sum always adds up on screen. */
  rounding: number;
  /** Cash change in the total that goes back to the wallet ("الباقي رصيد"), 0 when none. */
  change: number;
  total: number;
  /** What the total would be with shadow lines charged (partner/console calibration view). */
  shadowTotal: number;
}

/**
 * Splits shown/shadow lines and reconciles the total. When the server's `total` is given it wins
 * (it may also be floored/capped); `change` is the part of it that goes back to the wallet; any
 * other difference is displayed as rounding (legacy orders). Otherwise the subtotal is rounded to
 * `step` (250 IQD by default).
 */
export function summarizePrice(items: readonly PriceItem[], opts: { total?: number; step?: number; change?: number } = {}): PriceSummary {
  const shown = items.filter((i) => !i.shadow);
  const shadow = items.filter((i) => i.shadow);
  const subtotal = shown.reduce((s, i) => s + i.amount, 0);
  const total = opts.total ?? Math.max(0, roundToStep(subtotal, opts.step ?? 250));
  const shadowSum = shadow.reduce((s, i) => s + i.amount, 0);
  // Ali, 2026-10-04: a cash total rounds up to 250 and the remainder is the customer's change, credited
  // to his wallet. It is shown under the total as "الباقي رصيد", never as a line that raises the price.
  const change = Math.max(0, opts.change ?? 0);
  return {
    shown,
    shadow,
    subtotal,
    rounding: total - change - subtotal,
    change,
    total,
    shadowTotal: Math.max(0, roundToStep(subtotal + shadowSum, opts.step ?? 250)),
  };
}
