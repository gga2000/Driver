import { FOOD_RATED_TYPES, type Order, type OrderState } from '@driver/contracts';
import type { Phase, TFn } from './timeline';

/**
 * «شغل المطبخ» (joy l3, research S-3): the kitchen's real steps on a food order — the kitchen said
 * yes, cooking, ready, the courier has it — each lit only by the event the API recorded
 * (`acceptedAt`, `preparingAt`, `readyAt`, `pickedUpAt`). Nothing fills with time: with no new event
 * the strip holds still (the honesty rule; never a fake timer).
 */

export type KitchenStageKey = 'accepted' | 'cooking' | 'ready' | 'picked_up';

/** `done`: its event happened. `active`: started, not finished (only cooking has a start). `todo`: not yet. */
export type KitchenStageState = 'done' | 'active' | 'todo';

export interface KitchenStage {
  key: KitchenStageKey;
  state: KitchenStageState;
  /** When the stage happened (done) or began (active); null when the kitchen skipped the button. */
  at: Date | null;
}

export type KitchenOrder = Pick<Order, 'type' | 'state' | 'acceptedAt' | 'preparingAt' | 'readyAt' | 'pickedUpAt'>;

const ENDED: ReadonlySet<OrderState> = new Set<OrderState>(['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'failed']);

/**
 * The four stages, or null when there is no kitchen story to tell: not a kitchen order (rides,
 * parcels), the kitchen has not said yes yet (the kitchen screen's job), or the order ended.
 */
export function kitchenStages(o: KitchenOrder): KitchenStage[] | null {
  if (!(FOOD_RATED_TYPES as readonly string[]).includes(o.type) || !o.acceptedAt || ENDED.has(o.state)) return null;
  const ready = o.readyAt ?? null;
  const picked = o.pickedUpAt ?? null;
  // A kitchen may press "جاهز" without "بدأنا" first: cooking is then done, with no start time to show.
  const cookingDone = Boolean(ready || picked);
  return [
    { key: 'accepted', state: 'done', at: o.acceptedAt },
    { key: 'cooking', state: cookingDone ? 'done' : o.preparingAt ? 'active' : 'todo', at: o.preparingAt ?? null },
    { key: 'ready', state: ready || picked ? 'done' : 'todo', at: ready },
    { key: 'picked_up', state: picked ? 'done' : 'todo', at: picked },
  ];
}

const KITCHEN_PHASES: ReadonlySet<Phase> = new Set<Phase>(['preparing', 'to_pickup', 'at_pickup', 'reassigning']);

/**
 * Where the strip shows: the collapsed sheet of a food order from the kitchen's yes until the courier
 * picks it up. After that the map, the ETA and the timeline carry the story.
 */
export function showKitchenProgress(o: KitchenOrder, phase: Phase | null): boolean {
  return phase !== null && KITCHEN_PHASES.has(phase) && !o.pickedUpAt && kitchenStages(o) !== null;
}

/** The words under each segment; the last names the courier once he is known. */
export function kitchenStageLabel(key: KitchenStageKey, t: TFn, courierName: string | null): string {
  switch (key) {
    case 'accepted':
      return t('track.kitchen_accepted');
    case 'cooking':
      return t('track.kitchen_cooking');
    case 'ready':
      return t('track.kitchen_ready');
    case 'picked_up':
      return courierName ? t('track.kitchen_picked_up', { name: courierName }) : t('track.kitchen_picked_up_any');
  }
}

/**
 * One sentence for screen readers: «المطعم قبل 6:10، يطبخون من 6:12، جاهز: بعده، استلمه حيدر: بعده».
 */
export function kitchenProgressLabel(stages: readonly KitchenStage[], t: TFn, clock: (d: Date) => string, courierName: string | null): string {
  return stages
    .map((s) => {
      const label = kitchenStageLabel(s.key, t, courierName);
      if (s.state === 'todo') return t('track.kitchen_a11y_next', { stage: label });
      if (!s.at) return label;
      return t(s.state === 'active' ? 'track.kitchen_a11y_since' : 'track.kitchen_a11y_at', { stage: label, time: clock(s.at) });
    })
    .join('، ');
}
