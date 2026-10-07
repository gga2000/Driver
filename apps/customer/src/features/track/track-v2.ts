import { FOOD_RATED_TYPES, type Order, type OrderTracking } from '@driver/contracts';
import { liveStage } from '@/features/home/live-card';
import { cashAtDoor } from './arrival-logic';
import { ratingBranch } from './rating-logic';
import { courierAtDoor, type Phase } from './timeline';

/**
 * The redesigned live order (after-order design Step 3, switch `track_v2`): the pure parts. Food
 * orders only; rides keep their own screen. Nothing here decides money or a status: every amount is
 * the order's (the server's), every dot is lit by an event the API recorded.
 */

/** Which orders the new screen follows: kitchen orders (the ones with a kitchen story and a door). */
export function followsInTrackV2(type: Order['type']): boolean {
  return (FOOD_RATED_TYPES as readonly string[]).includes(type);
}

/**
 * What fills the screen (t1): the kitchen card while it cooks (no still map), the map once the
 * courier has the food, the door when he pressed «وصلت» at my door, then one thank-you card.
 * `ended`: rejected, cancelled, failed or under review — a calm card with what happened.
 */
export type TrackMode = 'kitchen' | 'map' | 'door' | 'thanks' | 'ended';

export function trackMode(v: OrderTracking, phase: Phase): TrackMode {
  switch (phase) {
    case 'arrived':
    case 'done':
      return 'thanks';
    case 'disputed':
      // A complaint opened from the thank-you card (a low rating) keeps the card, so its answer shows.
      return v.order.deliveredAt ? 'thanks' : 'ended';
    case 'cancelled':
    case 'failed':
      return 'ended';
    case 'unreachable':
      return 'map';
    case 'on_the_way':
      return courierAtDoor(v) ? 'door' : 'map';
    case 'reassigning':
      // A courier lost after pickup still has the food on the road; before it, the kitchen holds it.
      return v.order.pickedUpAt ? 'map' : 'kitchen';
    default:
      return 'kitchen';
  }
}

/** The four dots (t4): «انقبل · يطبخون · بالطريق · عندك». */
export type RoadKey = 'accepted' | 'cooking' | 'on_the_way' | 'at_you';

export interface RoadDot {
  key: RoadKey;
  /** `done`: it happened. `current`: where the order is now. `todo`: not yet. */
  state: 'done' | 'current' | 'todo';
  /** The current dot breathes only while its own event has happened (the kitchen pressed «بدأنا», he picked it up). */
  live: boolean;
  /** When it happened (done dots), from the order's own timestamps; null when the kitchen skipped the button. */
  at: Date | null;
}

const ROAD: readonly RoadKey[] = ['accepted', 'cooking', 'on_the_way', 'at_you'];

/**
 * Where the order is on the road, from the same stages as home's live card (#7's `liveStage`), so the
 * two never disagree. Before the kitchen's yes the first dot is current («ينتظر»). After the yes the
 * cooking dot is current; it breathes only once the kitchen pressed «بدأنا» or «جاهز» — never with time.
 */
export function roadDots(o: Pick<Order, 'type' | 'state' | 'acceptedAt' | 'preparingAt' | 'readyAt' | 'pickedUpAt' | 'deliveredAt'>): RoadDot[] {
  const delivered = Boolean(o.deliveredAt) || o.state === 'delivered' || o.state === 'completed' || o.state === 'closed';
  const stage = liveStage(o);
  const current = delivered ? ROAD.length : stage === 'sent' ? 0 : stage === 'onTheWay' ? 2 : 1;
  const at: Record<RoadKey, Date | null> = {
    accepted: o.acceptedAt ?? null,
    cooking: o.readyAt ?? o.preparingAt ?? null,
    on_the_way: o.pickedUpAt ?? null,
    at_you: o.deliveredAt ?? null,
  };
  const liveNow: Record<RoadKey, boolean> = {
    accepted: false,
    cooking: Boolean(o.preparingAt || o.readyAt || o.state === 'preparing' || o.state === 'ready'),
    on_the_way: Boolean(o.pickedUpAt || o.state === 'picked_up'),
    at_you: false,
  };
  return ROAD.map((key, i) => ({
    key,
    state: i < current ? 'done' : i === current ? 'current' : 'todo',
    live: i === current && liveNow[key],
    at: i < current ? at[key] : null,
  }));
}

/**
 * The one money line (t3): what to have in hand at the door. Cash: the note he said he would pay with
 * (or the total), with the change the courier brings for it; the wallet: nothing to hand over.
 */
export type MoneyLine =
  | { kind: 'cash'; handIqd: number; totalIqd: number; tenderChangeIqd: number; roundedIqd: number }
  | { kind: 'paid'; amountIqd: number };

export function moneyLine(order: Parameters<typeof cashAtDoor>[0]): MoneyLine {
  const pay = cashAtDoor(order);
  if (pay.kind === 'paid') return { kind: 'paid', amountIqd: pay.amountIqd };
  return { kind: 'cash', handIqd: pay.tender?.tenderIqd ?? pay.cashIqd, totalIqd: pay.cashIqd, tenderChangeIqd: pay.tender?.changeIqd ?? 0, roundedIqd: pay.changeIqd };
}

/**
 * After the door (HUNT-05), in the past tense and from what the server recorded: the note he handed
 * over when the rest went to his wallet (`paidIqd`), otherwise the total he paid in cash.
 */
export type PaidLine = { kind: 'cash'; paidIqd: number; totalIqd: number; creditedIqd: number } | { kind: 'wallet'; amountIqd: number };

export function paidLine(order: Parameters<typeof cashAtDoor>[0]): PaidLine {
  const pay = cashAtDoor(order);
  if (pay.kind === 'paid') return { kind: 'wallet', amountIqd: pay.amountIqd };
  return { kind: 'cash', paidIqd: pay.paidIqd, totalIqd: pay.cashIqd, creditedIqd: pay.creditedIqd };
}

/** Iraqi dinar notes in circulation, largest first. */
export const IQD_NOTES: readonly number[] = [50_000, 25_000, 10_000, 5_000, 1_000, 500, 250];

/**
 * Which notes make the amount at the door (a2): 20,000 is two 10,000s (there is no 20,000 note).
 * Fewest notes first; null when it takes more than `max` notes (then the amount alone says it) or
 * the amount is not a sum of notes.
 */
export function notesFor(amountIqd: number, max = 4): number[] | null {
  if (!Number.isInteger(amountIqd) || amountIqd <= 0) return null;
  const out: number[] = [];
  let left = amountIqd;
  for (const note of IQD_NOTES) {
    while (left >= note) {
      out.push(note);
      left -= note;
      if (out.length > max) return null;
    }
  }
  return left === 0 ? out : null;
}

/** The thank-you card's rating sends itself on a good score; anything lower waits for «كمّل». */
export function autoSendRating(courier: number, food: number | null, rated: boolean): boolean {
  if (rated || courier <= 0 || (food !== null && food <= 0)) return false;
  return ratingBranch(courier, food) === 'thanks';
}

/** The courier hint of the place the order goes to («باب أخضر يم جامع الرسول»), for the door screen. */
export function doorNote(dropoff: OrderTracking['dropoff'], places: ReadonlyArray<{ id: string; note: string | null }>): string | null {
  const id = dropoff?.placeId;
  if (!id) return null;
  const note = places.find((p) => p.id === id)?.note?.trim();
  return note ? note : null;
}
