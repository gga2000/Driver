import type { MenuItem } from '@driver/contracts';
import type { CartState } from './cart';
import type { MinOrderProgress } from './min-order';
import { upsellItems } from './upsell';

/**
 * The basket's one hint (after-order design b3, Ali 2026-10-07): a single strip above the button
 * instead of up to five. The order of importance:
 * 1. below the restaurant's minimum: how much is missing (and the small-order fee that lets it go now);
 * 2. close to a restaurant deal: how much more unlocks it;
 * 3. a deal already applied: which one (deals never stack; the server picked the one that saves most);
 * 4. the points this order earns.
 * Every figure is the server's (`orders.quote`) or the restaurant card's; this only picks one.
 */
export type BasketHint =
  | { kind: 'min'; progress: MinOrderProgress; minOrderIqd: number; feeIqd: number }
  | { kind: 'deal_unlock'; missingIqd: number; label: string }
  | { kind: 'deal_applied'; label: string | null; savingIqd: number }
  | { kind: 'points'; points: number; grouped: boolean };

export interface BasketHintInput {
  progress: MinOrderProgress | null;
  minOrderIqd: number;
  smallOrderFeeIqd: number;
  nextDeal: { missingIqd: number; label: string } | null;
  applied: { label: string | null; savingIqd: number } | null;
  pointsEarn: number | null | undefined;
  grouped: boolean;
}

export function pickHint(i: BasketHintInput): BasketHint | null {
  if (i.progress && i.progress.shortIqd > 0) return { kind: 'min', progress: i.progress, minOrderIqd: i.minOrderIqd, feeIqd: i.smallOrderFeeIqd };
  if (i.nextDeal && !i.applied && i.nextDeal.missingIqd > 0) return { kind: 'deal_unlock', missingIqd: i.nextDeal.missingIqd, label: i.nextDeal.label };
  if (i.applied && i.applied.savingIqd > 0) return { kind: 'deal_applied', label: i.applied.label, savingIqd: i.applied.savingIqd };
  if (i.pointsEarn && i.pointsEarn > 0) return { kind: 'points', points: i.pointsEarn, grouped: i.grouped };
  return null;
}

/** At most three same-kitchen dishes, shown only when one of them closes the gap the hint names. */
export const BASKET_UPSELL_MAX = 3;

/**
 * «ضيف من نفس المطبخ» only when it helps (b6): the gap to the minimum, else to a deal not yet applied;
 * only dishes that close it in one add, the closest first; nothing when there is no gap.
 */
export function basketGap(hint: BasketHint | null): number {
  if (!hint) return 0;
  if (hint.kind === 'min') return hint.progress.shortIqd;
  if (hint.kind === 'deal_unlock') return hint.missingIqd;
  return 0;
}

export function basketUpsell(categories: ReadonlyArray<{ name: string; items: MenuItem[] }>, cart: CartState, gapIqd: number): MenuItem[] {
  if (gapIqd <= 0) return [];
  return upsellItems(categories, cart, gapIqd)
    .filter((item) => item.priceIqd >= gapIqd)
    .sort((a, b) => a.priceIqd - b.priceIqd)
    .slice(0, BASKET_UPSELL_MAX);
}
