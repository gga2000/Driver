import { doorsOfTags, setupProgress, type FoodDoor, type MenuCard, type MenuCards, type SetupFacts, type SetupProgress } from '@driver/contracts';
import type { MerchantSetupState } from '../orgs/index.js';

/**
 * Pure parts of «جهّز محلك» on the server: the facts the steps are judged by, the yes/fix cards from
 * the menu-photo draft, and which order is the shop's first real one. No I/O; `setup.service.ts`
 * reads the stores, the catalog and the orders and composes these.
 */

/** A dish as setup counts it (live menu items only). */
export interface SetupDish {
  photoUrl: string | null;
  photoLibrary?: string | null;
  available: boolean;
}

export interface SetupInputs {
  setup: MerchantSetupState;
  dishes: readonly SetupDish[];
  /** Rows on the menu-photo draft (0 when there is none, or it is closed). */
  draftRows: number;
  hoursSet: boolean;
  pickupSet: boolean;
}

/** Cards on the draft he has not answered yet. */
export function pendingCards(setup: MerchantSetupState, draftRows: number): number {
  let n = 0;
  for (let i = 0; i < draftRows; i++) if (!setup.cards[String(i)]) n++;
  return n;
}

export function setupFacts(i: SetupInputs): SetupFacts {
  return {
    kindsConfirmed: i.setup.kindsAt !== null && (i.setup.kinds?.length ?? 0) > 0,
    items: i.dishes.length,
    pendingCards: pendingCards(i.setup, i.draftRows),
    missingPhotos: i.dishes.filter((d) => d.available && !d.photoUrl).length,
    hoursSet: i.hoursSet,
    payoutSeen: i.setup.payoutAt !== null,
    pickupSet: i.pickupSet,
    practiced: i.setup.practiceAt !== null,
  };
}

export function progressOf(i: SetupInputs): SetupProgress {
  return setupProgress(setupFacts(i));
}

/** His confirmed doors, else what field ops' tags suggest (a shop with no tags suggests a meal kitchen). */
export function suggestedDoors(tags: readonly string[] | null): FoodDoor[] {
  const doors = doorsOfTags(tags ?? []);
  return doors.length > 0 ? doors : ['meal'];
}

/** The draft's rows as cards, each with his answer. */
export function cardsOf(setup: MerchantSetupState, rows: ReadonlyArray<{ nameAr: string; priceIqd: number; categoryAr?: string | null | undefined; description?: string | null | undefined }>): MenuCard[] {
  return rows.map((r, index) => {
    const a = setup.cards[String(index)];
    return { index, nameAr: r.nameAr, priceIqd: r.priceIqd, categoryAr: r.categoryAr ?? null, description: r.description ?? null, answer: a?.answer ?? 'pending', itemId: a?.itemId ?? null };
  });
}

/** Where the cards stand: no photos yet, photos in with nothing read, cards to check, or all answered. */
export function cardsState(job: { state: 'draft' | 'applied' | 'discarded'; rows: number } | null, pending: number): MenuCards['state'] {
  if (!job || job.state === 'discarded') return 'none';
  if (job.state === 'applied') return 'done';
  if (job.rows === 0) return 'reading';
  return pending > 0 ? 'ready' : 'done';
}

/** The shop's first real order: the earliest placed at or after the shutter went up (practice orders never reach the server). */
export function firstOrderAfter<O extends { id: string; placedAt: Date }>(orders: readonly O[], liveAt: Date): O | null {
  let best: O | null = null;
  for (const o of orders) {
    if (o.placedAt.getTime() < liveAt.getTime()) continue;
    if (!best || o.placedAt.getTime() < best.placedAt.getTime() || (o.placedAt.getTime() === best.placedAt.getTime() && o.id < best.id)) best = o;
  }
  return best;
}

/** The storefront's cuisine line from his doors, the four doors' own words (customer app). */
export const DOOR_CUISINE_AR: Readonly<Record<FoodDoor, string>> = { meal: 'أكل ومشويات', cafe: 'قهوة وچاي', cold: 'عصير وبارد', sweet: 'حلو وآيس كريم' };

export function cuisineLine(doors: readonly FoodDoor[]): string {
  return doors.map((d) => DOOR_CUISINE_AR[d]).join(' · ');
}
