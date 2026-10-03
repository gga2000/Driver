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
  /** total − subtotal; shown as its own line when non-zero so the sum always adds up on screen. */
  rounding: number;
  total: number;
  /** What the total would be with shadow lines charged (partner/console calibration view). */
  shadowTotal: number;
}

/**
 * Splits shown/shadow lines and reconciles the total. When the server's `total` is given it wins
 * (it may also be floored/capped) and the difference is displayed as rounding; otherwise the
 * subtotal is rounded to `step` (250 IQD by default).
 */
export function summarizePrice(items: readonly PriceItem[], opts: { total?: number; step?: number } = {}): PriceSummary {
  const shown = items.filter((i) => !i.shadow);
  const shadow = items.filter((i) => i.shadow);
  const subtotal = shown.reduce((s, i) => s + i.amount, 0);
  const total = opts.total ?? Math.max(0, roundToStep(subtotal, opts.step ?? 250));
  const shadowSum = shadow.reduce((s, i) => s + i.amount, 0);
  return {
    shown,
    shadow,
    subtotal,
    rounding: total - subtotal,
    total,
    shadowTotal: Math.max(0, roundToStep(subtotal + shadowSum, opts.step ?? 250)),
  };
}
