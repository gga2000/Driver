import type { CatalogSearchDish, TodayPot } from '@driver/contracts';
import { potUntilAt } from './habits';

/**
 * The hour's food on home (Ali 2026-10-08, concept C «طبخة الساعة» with the big dish as a gallery):
 * the town's pots and the dishes for this hour, split into the gallery's slides and the grid under it.
 * Pure, so the order is tested.
 */

/** Slides in the gallery: four, so its one tour (`tourPlan`) ends well inside home's 20 s of motion. */
export const GALLERY_MAX = 4;
/** Dishes in the two-column grid under the gallery. */
export const MORE_MAX = 4;
/** Dishes asked of `catalog.picks` for both: the server's most, since a repeated dish or picture is left out. */
export const HOUR_PICKS = 12;

export interface HourDish {
  dish: CatalogSearchDish;
  /** «قدر اليوم»: the pot's "HH:MM" end today, or null for a pot that runs all day. */
  pot: { until: string | null } | null;
  /** The kitchen's line on its pot («ويا لحم غنم»), else the dish's own description. */
  line: string | null;
}

/** A name without its short vowels, shadda or stretching, so «مشكّل» and «مشكل» read the same. */
function plain(s: string): string {
  return s.replace(/[\u064B-\u0652\u0640]/g, '').trim();
}

/** Pots still on: the kitchen is open and the pot's end time (when it has one) hasn't passed. */
export function livePots(pots: readonly TodayPot[] | undefined, now: Date): TodayPot[] {
  return (pots ?? []).filter((p) => p.restaurantOpen && (!p.until || potUntilAt(p.until, now).getTime() > now.getTime()));
}

/** A pot as a dish card: added from its kitchen's menu (sizes may need choosing), unless a pick is the same dish. */
function potDish(p: TodayPot): CatalogSearchDish {
  return {
    id: p.dish.id,
    name: p.dish.name,
    description: null,
    priceIqd: p.dish.priceIqd,
    photoUrl: p.dish.photoUrl,
    available: true,
    quickAdd: false,
    restaurantId: p.merchantOrgId,
    restaurantName: p.restaurantName,
    restaurantOpen: true,
    restaurantOpensAt: null,
  };
}

/**
 * Pots first (the day's real cooking), then the hour's dishes. Home shows each dish once and each
 * picture once: a second kitchen's «تمن وقيمة», or a dish whose stand-in photo is already showing,
 * stays on its menu; so does a dish with no picture at all (`pictureOf` null), since a drawing that
 * big looks cheap. The gallery takes one dish per kitchen before any kitchen's second, so swiping
 * shows the town, not one menu; the grid takes the next ones in pairs (an odd one out would leave a
 * hole in the two columns). The `later` kitchen (the one the usual card above already offers) goes
 * to the back, used only when nothing else is left.
 */
export function hourFood(input: {
  pots: readonly TodayPot[] | undefined;
  picks: readonly CatalogSearchDish[] | undefined;
  now: Date;
  later?: string | null;
  /** The hour's dish words: a pick must start with one, as `catalog.picks` promises. */
  words?: readonly string[];
  /** The picture a dish would show (its photo's address, or a stand-in's asset), null for none. */
  pictureOf?: (d: CatalogSearchDish) => string | number | null;
}): { slides: HourDish[]; more: HourDish[] } {
  const byId = new Map((input.picks ?? []).map((d) => [d.id, d]));
  const all: HourDish[] = [];
  const seen = new Set<string>();
  for (const p of livePots(input.pots, input.now)) {
    if (seen.has(p.dish.id)) continue;
    seen.add(p.dish.id);
    const pick = byId.get(p.dish.id);
    all.push({ dish: pick ? { ...pick, photoUrl: pick.photoUrl ?? p.dish.photoUrl } : potDish(p), pot: { until: p.until }, line: p.note ?? pick?.description ?? null });
  }
  const starts = (input.words ?? []).map(plain);
  for (const d of input.picks ?? []) {
    if (seen.has(d.id) || !d.available || !d.restaurantOpen) continue;
    // «كليچة مشكلة» is not lunch because it holds «مشكّل»: only a dish that starts with an hour word.
    if (starts.length > 0 && !starts.some((w) => plain(d.name).startsWith(w))) continue;
    seen.add(d.id);
    all.push({ dish: d, pot: null, line: d.description });
  }

  const front = all.filter((h) => h.dish.restaurantId !== input.later);
  const back = all.filter((h) => h.dish.restaurantId === input.later);
  const names = new Set<string>();
  const pictures = new Set<string | number>();
  const ordered: HourDish[] = [];
  for (const h of [...front, ...back]) {
    const name = plain(h.dish.name);
    const picture = input.pictureOf ? input.pictureOf(h.dish) : h.dish.id;
    if (picture === null || names.has(name) || pictures.has(picture)) continue;
    names.add(name);
    pictures.add(picture);
    ordered.push(h);
  }

  const slides: HourDish[] = [];
  const kitchens = new Set<string>();
  for (const h of ordered) {
    if (slides.length === GALLERY_MAX) break;
    if (kitchens.has(h.dish.restaurantId)) continue;
    kitchens.add(h.dish.restaurantId);
    slides.push(h);
  }
  // Fewer kitchens than slides: their second dishes fill the gallery, still in order.
  for (const h of ordered) {
    if (slides.length === GALLERY_MAX) break;
    if (!slides.includes(h)) slides.push(h);
  }
  const rest = ordered.filter((h) => !slides.includes(h)).slice(0, MORE_MAX);
  return { slides, more: rest.slice(0, rest.length - (rest.length % 2)) };
}

/**
 * The gallery's one tour (Ali's motion rule, h1: play once and settle, nothing loops on an idle
 * screen): it waits `dwell` on each slide, steps to the next, and after the last comes back to the
 * first and stops. Returns the slide to show after each step, so 4 slides give [1, 2, 3, 0].
 */
export function tourPlan(count: number): number[] {
  if (count < 2) return [];
  return [...Array.from({ length: count - 1 }, (_, i) => i + 1), 0];
}

/** How long each slide rests during the tour: the whole tour fits in `budgetMs`, never under 3 s a slide. */
export function tourDwellMs(count: number, budgetMs: number): number {
  return Math.max(3_000, Math.min(4_000, Math.floor(budgetMs / Math.max(1, count + 0.5))));
}

/** Where a swipe lands: the nearest slide, nudged by a flick, inside the gallery. */
export function settleSlide(position: number, velocitySlidesPerSec: number, count: number): number {
  'worklet';
  const flick = Math.abs(velocitySlidesPerSec) > 0.6 ? Math.sign(velocitySlidesPerSec) * 0.5 : 0;
  return Math.max(0, Math.min(count - 1, Math.round(position + flick)));
}
