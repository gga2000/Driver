import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  AZIZIYAH_MONEY_RULES,
  CATALOG_PUBLIC_RATE,
  CATALOG_SEARCH_LIMITS,
  DriverError,
  iceCreamTooFar,
  PriceRequest,
  POPULAR_RULES,
  SMALL_ORDER_FEE_IQD,
  carryModifierPicks,
  cashToHand,
  kiloPriceOf,
  matchDish,
  menuDealOf,
  similarKitchens,
  smallOrderFeeIqd,
  deliveryFeesOf,
  searchScore,
  type Actor,
  type CatalogCraving,
  type CatalogCravingsInput,
  type CatalogPicksInput,
  type CarryOverInput,
  type CarryOverPreview,
  type CatalogReader,
  type CatalogSearchDish,
  type CatalogSearchInput,
  type CatalogSearchResult,
  type CatalogToday,
  type CatalogTodayInput,
  type CustomerCatalogPort,
  type FollowDishInput,
  type MyDishFollows,
  type PotsTodayInput,
  type TodayPot,
  type DealBadge,
  type DeliveryPoint,
  type MenuInput,
  type Quote,
  type RestaurantCard,
  type RestaurantMenu,
  type RestaurantsInput,
  type SearchUnmetInput,
  type UnmetSearchesInput,
  type UnmetSearchRow,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { mapBounded } from '../../shared/map-bounded.js';
import { InMemoryWindowCounter, WINDOW_COUNTER, type WindowCounter } from '../../shared/window-counter.js';
import { PricingService } from '../pricing/index.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import type { CatalogItemRecord, StorefrontRecord, UnmetSearchRecord } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';
import { photoLink, STOREFRONT_PHOTOS, type PhotoLink, type PhotoLinks } from './photos.js';
import { activeWindow, basePrepMin, localTwelveHour, etaRange, foldArabic, menuItemView, menuSections, minutesUntilLocal, nextOpeningIn, oneTap, openState, pinOf, popularItems, prepRange, STOREFRONT_RULES } from './storefront.js';

/** The signed-in person behind a catalog read, if any. */
function readerPerson(reader: Actor | CatalogReader): string | null {
  return 'personId' in reader ? reader.personId : (reader.actor?.personId ?? null);
}

/** Unmet searches one caller may send per minute (joy h4). */
export const UNMET_PER_MINUTE = 10;

/** Rows (newest first) → one line per folded term, most searches first, then the most recent. */
export function aggregateUnmet(rows: readonly UnmetSearchRecord[], limit: number): UnmetSearchRow[] {
  const byTerm = new Map<string, { row: UnmetSearchRow; zones: Map<string | null, number> }>();
  for (const r of rows) {
    const g = byTerm.get(r.term) ?? { row: { term: r.term, typed: r.typed, searches: 0, signedIn: 0, zones: [], lastAt: r.createdAt }, zones: new Map<string | null, number>() };
    g.row.searches += 1;
    if (r.signedIn) g.row.signedIn += 1;
    if (r.createdAt > g.row.lastAt) {
      g.row.lastAt = r.createdAt;
      g.row.typed = r.typed;
    }
    g.zones.set(r.zoneKey, (g.zones.get(r.zoneKey) ?? 0) + 1);
    byTerm.set(r.term, g);
  }
  return [...byTerm.values()]
    .map(({ row, zones }) => ({
      ...row,
      zones: [...zones.entries()].map(([zoneKey, searches]) => ({ zoneKey, searches })).sort((a, b) => b.searches - a.searches || String(a.zoneKey).localeCompare(String(b.zoneKey))),
    }))
    .sort((a, b) => b.searches - a.searches || b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, limit);
}

/** The quote engine the fee preview uses: the same one `orders.place` locks fees with. */
export interface StorefrontPricing {
  quote(req: PriceRequest): Quote;
}

/**
 * Merchant facts the card needs from the merchant directory orders reads: where couriers pick up and
 * the effective pause windows (the merchant's own or the city's defaults, e.g. Friday prayer) — the
 * same ones `orders.place` refuses inside. Bound by the orders module (`OrdersStorefrontMerchants`),
 * which also wires `CatalogRpc`, so catalog never imports orders.
 */
export interface StorefrontMerchants {
  /** Local time zone opening hours and pause windows are in. */
  readonly timeZone: string;
  profile(
    orgId: string,
    cityId: string,
    at?: Date,
  ): Promise<{
    location: DeliveryPoint | null;
    pauseWindows: Array<{ dow: number; start: string; end: string }>;
    /** Busy mode switched on from the Merchant app (auto-expiring). */
    busy?: boolean;
    /** Closed by hand from the Merchant app (early close). */
    closed?: boolean;
    /** A quick pause from the Merchant app reopens by itself at this time; absent = until reopened by hand. */
    reopensAt?: Date;
    /** One of the store's holiday closures (Merchant app hours): closed for the day, shown as hours. */
    holiday?: boolean;
  }>;
  /** Live merchant deals as badges (bound by orders over the promotions module); none when absent. */
  deals?(orgId: string, at: Date): Promise<DealBadge[]>;
  /** Joy o8: per dish id, how many of the kitchen's orders since `since` had it (refused and cancelled orders left out). */
  dishOrderCounts?(orgId: string, since: Date, until: Date): Promise<Map<string, number>>;
  /**
   * x1: when (epoch ms) a merchant's settings last changed on this instance (opened, closed, busy,
   * moved, a tablet back online); 0 when never. A change rebuilds the town snapshot at once.
   */
  changeStamp?(): number;
}

type MerchantFacts = Awaited<ReturnType<StorefrontMerchants['profile']>>;

/** One kitchen as every list reads it: storefront, menu, merchant settings and deals. */
interface Kitchen {
  s: StorefrontRecord;
  items: readonly CatalogItemRecord[];
  profile: MerchantFacts;
  deals: DealBadge[];
}

/**
 * x1: how long one town's kitchens are reused by the lists (home, picks, cravings, search, pots,
 * today, carry-over). A menu edit or a kitchen opening/closing on this instance rebuilds them at once;
 * other instances see it within this time. Ride minutes, fees, kill switches and opening hours are
 * still worked out per read, `catalog.menu` reads live, and `orders.place` checks every price and the
 * open state itself.
 */
export const TOWN_SNAPSHOT_MS = 30_000;

/** A snapshot built this soon after a change only lives this long (that change may still have been committing). */
const TOWN_SETTLE_MS = 2_000;

export const STOREFRONT_MERCHANTS = Symbol('STOREFRONT_MERCHANTS');

/**
 * The rest of the welcome screen's facts (`catalog.today`, audit d-6), bound by the orders module:
 * الرجعة cars today and the garage of the next car to Baghdad (routes), and the city's late-delivery
 * promise (money rules). Without it `today` still answers, with no cars and the default promise.
 */
export interface StorefrontToday {
  rajaa(): Promise<{ carsToday: number; baghdadGarage: { id: string; nameAr: string; nameEn: string } | null }>;
  latePromiseMin(cityId: string): number;
}
export const STOREFRONT_TODAY = Symbol('STOREFRONT_TODAY');

/**
 * Storefront cards one catalog read builds at once (perf t4): each card reads the merchant profile, its
 * deals and a ride time, so a city's kitchens are built side by side instead of one after another, but
 * bounded so one read never takes the whole database pool.
 */
export const CARD_CONCURRENCY = 6;

/** Kitchen → door ride minutes already asked for in this one read, by pin pair (shared between cards). */
type RideMemo = Map<string, Promise<number | null>>;

/** The zone a "tuktuk from" fare is priced in: a ride inside the town centre. */
const TODAY_TUKTUK_ZONE = 'centre';

/** k7: an ice cream shop is out of reach past 3 km by road from this door (it drops out of every list). */
function outOfReach(s: StorefrontRecord, card: RestaurantCard, dropoff: DeliveryPoint | null | undefined): boolean {
  return iceCreamTooFar(s.tags, card.pickup?.pin, dropoff?.pin);
}

/**
 * The customer catalog read (`catalog.restaurants`, `catalog.menu`, M3). Composes the catalog's
 * storefronts and menus with the merchant's settings from orgs (location, pause windows), busy mode,
 * and a fee preview from the pricing engine split exactly as `orders.place` charges it, so the
 * delivery fee on a card is the one the customer pays at checkout (door hand-over, now).
 */
/**
 * REL-16: the launch kill switches as menus and lists see them. Bound to the controls module by the
 * orders module; unbound (tests, the demo) nothing is ever stopped.
 */
export const STOREFRONT_SWITCHES = Symbol('STOREFRONT_SWITCHES');
export interface StorefrontSwitches {
  /** The customer's words when a switch stops this kitchen for this door, else null. */
  stopped(input: { cityId: string; merchantOrgId: string; kitchenZone: string | null; dropoffZone: string | null }): Promise<string | null>;
}

@Injectable()
export class CatalogRpc implements CustomerCatalogPort {
  private readonly log = new Logger(CatalogRpc.name);
  private readonly clock: Clock;
  private readonly guests: WindowCounter;
  private readonly eta: EtaService;
  /** Merchant uploads (`upload:<id>`) as signed links: the owner's photo edits and accepted menu-photo-service shots. */
  private readonly photo: PhotoLink;
  /** x1: per city, the kitchens of the last build (a promise, so reads arriving during a build share it). */
  private readonly towns = new Map<string, { builtAt: number; stamp: string; kitchens: Promise<Kitchen[]> }>();

  constructor(
    private readonly catalog: CatalogService,
    @Inject(STOREFRONT_MERCHANTS) private readonly merchants: StorefrontMerchants,
    @Inject(PricingService) private readonly pricing: StorefrontPricing,
    @Optional() @Inject(CLOCK) clock?: Clock,
    @Optional() @Inject(WINDOW_COUNTER) guests?: WindowCounter,
    @Optional() eta?: EtaService,
    @Optional() @Inject(STOREFRONT_TODAY) private readonly todayFacts: StorefrontToday | null = null,
    @Optional() @Inject(STOREFRONT_PHOTOS) photos: PhotoLinks | null = null,
    @Optional() @Inject(STOREFRONT_SWITCHES) private readonly switches: StorefrontSwitches | null = null,
  ) {
    this.photo = photoLink(photos);
    this.clock = clock ?? new SystemClock();
    this.guests = guests ?? new InMemoryWindowCounter(this.clock);
    this.eta = eta ?? new EtaService(new StraightLineRouter());
  }

  async restaurants(reader: Actor | CatalogReader, input: z.infer<typeof RestaurantsInput>): Promise<RestaurantCard[]> {
    await this.admit(reader);
    const now = this.clock.now();
    const f = input.filters;
    const q = f.query ? foldArabic(f.query) : '';
    const rides: RideMemo = new Map();
    const built = await mapBounded(await this.town(input.cityId), CARD_CONCURRENCY, async (k) => {
      if (q && !this.matches(k.s, k.items, q)) return null;
      if (f.tag && !k.s.tags.includes(f.tag)) return null;
      const card = await this.card(k, input.dropoff ?? null, now, rides);
      return outOfReach(k.s, card, input.dropoff) ? null : card;
    });
    const cards: RestaurantCard[] = [];
    for (const card of built) {
      if (!card) continue;
      if (f.openNow && !card.open) continue;
      if (f.freeDelivery && card.deliveryFeeIqd !== 0) continue;
      cards.push(card);
    }
    // Open kitchens first, then the quickest to the door, then by name.
    return cards.sort(
      (a, b) =>
        Number(b.open) - Number(a.open) ||
        (a.etaMinMinutes ?? a.prepMinMinutes) - (b.etaMinMinutes ?? b.prepMinMinutes) ||
        a.name.localeCompare(b.name, 'ar'),
    );
  }

  async menu(reader: Actor | CatalogReader, input: z.infer<typeof MenuInput>): Promise<RestaurantMenu> {
    await this.admit(reader);
    const s = await this.catalog.storefront(input.merchantId);
    if (!s) throw new DriverError('org_not_found');
    const now = this.clock.now();
    const kitchen = await this.kitchen(s, now);
    const items = kitchen.items;
    const restaurant = await this.card(kitchen, input.dropoff ?? null, now);
    // f10: each dish's price under a live percent deal with no minimum (the rule orders.quote applies).
    const deals = restaurant.deals ?? [];
    const categories = menuSections(items, now, this.merchants.timeZone, this.photo).map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, deal: menuDealOf(i, deals) })) }));
    // o8: «الأكثر طلباً بالعزيزية» from the kitchen's real orders (≥ 20 orders a dish, last 30 days).
    const since = new Date(now.getTime() - POPULAR_RULES.windowDays * 86_400_000);
    const counts = (await this.merchants.dishOrderCounts?.(s.orgId, since, now)) ?? new Map<string, number>();
    const orderable = categories.flatMap((c) => c.items).filter((i) => i.available);
    const popular = popularItems(counts, orderable.map((i) => i.id), POPULAR_RULES);
    // h2: today's pot while it shows and its dish can be ordered; dishes that were a pot lately (followable).
    const pot = await this.catalog.showingPot(s.orgId);
    const potOk = pot !== null && orderable.some((i) => i.id === pot.itemId);
    const potDishes = await this.catalog.followableDishes(s.orgId);
    // h5: the owner's story, only when he chose to show it.
    const story = s.story?.shown && s.story.text ? { text: s.story.text, sinceYear: s.story.sinceYear } : null;
    return { restaurant, categories, popular, pot: potOk ? { itemId: pot.itemId, note: pot.note, until: pot.until } : null, potDishes, story };
  }

  /**
   * «العزيزية اليوم» (joy h2): the city's pots that show now and whose dish can be ordered, with the
   * kitchen's open state; open kitchens first, then the first to cook. `followed` is the reader's own.
   */
  async pots(reader: Actor | CatalogReader, input: z.infer<typeof PotsTodayInput>): Promise<TodayPot[]> {
    await this.admit(reader);
    const now = this.clock.now();
    const showing = new Map((await this.catalog.showingPots()).map((p) => [p.merchantOrgId, p]));
    const personId = readerPerson(reader);
    const followed = new Set(personId ? (await this.catalog.dishFollows(personId)).map((f) => f.itemId) : []);
    const out: Array<{ pot: TodayPot; postedAt: number }> = [];
    const rides: RideMemo = new Map();
    const built = await mapBounded(await this.town(input.cityId), CARD_CONCURRENCY, async (k) => {
      const { s } = k;
      const pot = showing.get(s.orgId);
      if (!pot) return null;
      const item = k.items.find((i) => i.id === pot.itemId);
      if (!item) return null;
      const view = menuItemView(item, now, this.merchants.timeZone);
      if (!view.available) return null;
      const card = await this.card(k, input.dropoff ?? null, now, rides);
      return outOfReach(s, card, input.dropoff) ? null : { s, pot, view, card };
    });
    for (const b of built) {
      if (!b) continue;
      const { s, pot, view, card } = b;
      out.push({
        postedAt: pot.createdAt.getTime(),
        pot: {
          merchantOrgId: s.orgId,
          restaurantName: card.name,
          restaurantOpen: card.open,
          opensAt: card.opensAt,
          dish: { id: view.id, name: view.name, priceIqd: view.priceIqd, photoUrl: view.photoUrl },
          note: pot.note,
          until: pot.until,
          followed: followed.has(view.id),
        },
      });
    }
    return out.sort((a, b) => Number(b.pot.restaurantOpen) - Number(a.pot.restaurantOpen) || a.postedAt - b.postedAt).map((o) => o.pot);
  }

  async dishFollows(actor: Actor): Promise<MyDishFollows> {
    return { itemIds: (await this.catalog.dishFollows(actor.personId)).map((f) => f.itemId) };
  }

  /** «خبرني لمن يطبخوه»: follow or stop following one dish (the kitchen's own, at most 30). */
  async followDish(actor: Actor, input: FollowDishInput): Promise<MyDishFollows> {
    const rows = await this.catalog.followDish(actor.personId, input.merchantOrgId, input.itemId, input.on);
    return { itemIds: rows.map((f) => f.itemId) };
  }

  /**
   * `catalog.carryOver` (joy o15): the two similar open kitchens (shared cuisine tags first) and, for
   * each, which lines of the refused cart it makes — the same dish-and-choices rule the app moves the
   * cart with — and about what that cart costs there: menu prices + the card's fees to the drop-off
   * + the small-order fee, cash rounded to 250. Deals are left to checkout's exact quote.
   */
  async carryOver(reader: Actor | CatalogReader, input: z.infer<typeof CarryOverInput>): Promise<CarryOverPreview> {
    await this.admit(reader);
    const now = this.clock.now();
    const rejected = await this.catalog.storefront(input.merchantId);
    const cards = await this.cardsWithMenus(input.cityId, input.dropoff ?? null, now);
    const picked = similarKitchens({ id: input.merchantId, tags: rejected?.tags ?? [] }, cards.map((c) => c.card));
    const options = picked.map((card) => {
      const items = cards.find((c) => c.card.id === card.id)!.items;
      const menu = menuSections(items, now, this.merchants.timeZone, this.photo).flatMap((c) => c.items);
      let itemsIqd = 0;
      let moved = 0;
      const missing: string[] = [];
      for (const line of input.lines) {
        const dish = matchDish(line.name, menu);
        const picks = dish?.available ? carryModifierPicks(line.choices, dish.modifierGroups) : null;
        if (!dish || !picks) {
          missing.push(line.name);
          continue;
        }
        moved += 1;
        itemsIqd += (dish.priceIqd + picks.reduce((a, p) => a + p.modifier.priceIqd, 0)) * line.qty;
      }
      const fees = card.deliveryFeeIqd !== null && card.serviceFeeIqd !== null ? card.deliveryFeeIqd + card.serviceFeeIqd : null;
      const totalIqd = moved > 0 && fees !== null ? cashToHand(itemsIqd + fees + smallOrderFeeIqd(itemsIqd, card.minOrderIqd)).cashIqd : null;
      return { restaurant: card, moved, of: input.lines.length, missing, totalIqd };
    });
    return { options };
  }

  /**
   * Search (`catalog.search`): kitchens by name, cuisine line or tag; dishes by name or menu section. Every query word
   * has to match (narrowing). Closed kitchens stay in, marked with when they open, so they can still
   * be opened (and scheduled once pre-orders exist).
   */
  async search(reader: Actor | CatalogReader, input: z.infer<typeof CatalogSearchInput>): Promise<CatalogSearchResult> {
    await this.admit(reader);
    const folded = foldArabic(input.query);
    if (!folded) return { folded, restaurants: [], dishes: [] };
    const now = this.clock.now();
    const restaurants: Array<{ card: RestaurantCard; score: number }> = [];
    const dishes: Array<{ dish: CatalogSearchDish; score: number }> = [];
    const rides: RideMemo = new Map();
    const matched = await mapBounded(await this.town(input.cityId), CARD_CONCURRENCY, async (k) => {
      const { s, items } = k;
      // A name match outranks a cuisine or tag match ("خالد" → مطعم خالد before a kebab place).
      const byName = searchScore(folded, s.nameAr);
      const byKind = Math.max(searchScore(folded, s.cuisineAr), ...s.tags.map((tag) => searchScore(folded, tag)), 0);
      const kitchenScore = byName > 0 ? byName + 3 : byKind;
      // A dish matches by its name, or (weaker) by its menu section ("ريوگ" → كاهي وقيمر، مخلمة…).
      const hits = items
        .map((item) => {
          const byDish = searchScore(folded, item.nameAr);
          return { item, score: byDish > 0 ? byDish : item.categoryAr && searchScore(folded, item.categoryAr) > 0 ? 0.5 : 0 };
        })
        .filter((h) => h.score > 0);
      if (kitchenScore === 0 && hits.length === 0) return null;
      const card = await this.card(k, input.dropoff ?? null, now, rides);
      return outOfReach(s, card, input.dropoff) ? null : { kitchenScore, hits, card };
    });
    for (const m of matched) {
      if (!m) continue;
      const { kitchenScore, hits, card } = m;
      // A kitchen that only matches by its dishes still shows in the kitchen list, after the rest.
      restaurants.push({ card, score: kitchenScore > 0 ? kitchenScore : 0.5 });
      for (const { item, score } of hits) {
        const view = menuItemView(item, now, this.merchants.timeZone, this.photo);
        dishes.push({
          score,
          dish: {
            id: view.id,
            name: view.name,
            description: view.description,
            priceIqd: view.priceIqd,
            photoUrl: view.photoUrl,
            available: view.available,
            quickAdd: oneTap(view),
            restaurantId: card.id,
            restaurantName: card.name,
            restaurantOpen: card.open,
            restaurantOpensAt: card.opensAt,
            kiloIqd: kiloPriceOf(view),
          },
        });
      }
    }
    restaurants.sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.card.open) - Number(a.card.open) ||
        (a.card.etaMinMinutes ?? a.card.prepMinMinutes) - (b.card.etaMinMinutes ?? b.card.prepMinMinutes) ||
        a.card.name.localeCompare(b.card.name, 'ar'),
    );
    dishes.sort(
      (a, b) =>
        Number(b.dish.restaurantOpen && b.dish.available) - Number(a.dish.restaurantOpen && a.dish.available) ||
        b.score - a.score ||
        a.dish.priceIqd - b.dish.priceIqd ||
        a.dish.name.localeCompare(b.dish.name, 'ar'),
    );
    return {
      folded,
      restaurants: restaurants.slice(0, CATALOG_SEARCH_LIMITS.restaurants).map((r) => r.card),
      dishes: dishes.slice(0, CATALOG_SEARCH_LIMITS.dishes).map((d) => d.dish),
    };
  }

  /**
   * Guests (no valid token) are limited per client IP (`CATALOG_PUBLIC_RATE`): the catalog is public,
   * so a scraper is held back without slowing down people who signed in. No IP (tests, in-process
   * callers) means no limit.
   */
  /**
   * `catalog.today` (audit d-6): the welcome screen's live proof — kitchens open now (the list's own
   * "open"), الرجعة cars still leaving today, a tuktuk ride in the centre priced now by the same
   * engine as a booking, the garage of the next car to Baghdad, and the late-delivery promise.
   */
  /**
   * `catalog.picks` (joy h1/h4): real dishes for a meal's words, from kitchens open now. A dish counts
   * when every word of the pick starts a word of its name (`searchScore` ≥ 2, so «تمن» finds «تمن
   * وقيمة» but not «ثمن»). Earlier words rank first; the first pass takes one dish per kitchen so the
   * row shows the town, the second fills up to `limit`.
   */
  async picks(reader: Actor | CatalogReader, input: z.infer<typeof CatalogPicksInput>): Promise<CatalogSearchDish[]> {
    await this.admit(reader);
    const now = this.clock.now();
    const words = input.words.map((w) => foldArabic(w)).filter(Boolean);
    const found: Array<{ rank: number; score: number; dish: CatalogSearchDish }> = [];
    for (const { card, items } of await this.cardsWithMenus(input.cityId, input.dropoff ?? null, now)) {
      if (!card.open) continue;
      for (const item of items) {
        const rank = words.findIndex((w) => searchScore(w, item.nameAr) >= 2);
        if (rank === -1) continue;
        const view = menuItemView(item, now, this.merchants.timeZone, this.photo);
        if (!view.available) continue;
        found.push({
          rank,
          // «باچة» itself before «تشريب باچة».
          score: searchScore(words[rank]!, item.nameAr),
          dish: {
            id: view.id,
            name: view.name,
            description: view.description,
            priceIqd: view.priceIqd,
            photoUrl: view.photoUrl,
            available: true,
            quickAdd: oneTap(view),
            restaurantId: card.id,
            restaurantName: card.name,
            restaurantOpen: true,
            restaurantOpensAt: null,
            kiloIqd: kiloPriceOf(view),
          },
        });
      }
    }
    found.sort((a, b) => a.rank - b.rank || b.score - a.score || a.dish.priceIqd - b.dish.priceIqd || a.dish.name.localeCompare(b.dish.name, 'ar'));
    // Variety: one per kitchen first, then dishes of a word not shown yet, then the rest.
    const out: Array<(typeof found)[number]> = [];
    const take = (ok: (f: (typeof found)[number]) => boolean) => {
      for (const f of found) {
        if (out.length >= input.limit) return;
        if (!out.includes(f) && ok(f)) out.push(f);
      }
    };
    take((f) => !out.some((o) => o.dish.restaurantId === f.dish.restaurantId));
    take((f) => !out.some((o) => o.rank === f.rank));
    take(() => true);
    return out.map((f) => f.dish);
  }

  /**
   * `catalog.cravings` (food doors, d5/k9): per kind, the open shops that have it now and their best
   * dish for it — a dish counts when one of the kind's words starts a word of its name (`searchScore`
   * ≥ 2, like `picks`); per shop the closest name wins, then the cheaper. Shops in a kind: best match,
   * then cheapest. Kinds with no shop are dropped.
   */
  async cravings(reader: Actor | CatalogReader, input: z.infer<typeof CatalogCravingsInput>): Promise<CatalogCraving[]> {
    await this.admit(reader);
    const now = this.clock.now();
    const kinds = input.kinds.map((k) => ({ key: k.key, words: k.words.map((w) => foldArabic(w)).filter(Boolean) }));
    const found = new Map<string, Array<{ score: number; dish: CatalogSearchDish }>>(kinds.map((k) => [k.key, []]));
    for (const { card, items } of await this.cardsWithMenus(input.cityId, input.dropoff ?? null, now)) {
      if (!card.open) continue;
      const views = items.map((item) => menuItemView(item, now, this.merchants.timeZone, this.photo)).filter((v) => v.available);
      for (const kind of kinds) {
        let best: { score: number; dish: CatalogSearchDish } | null = null;
        for (const view of views) {
          const score = Math.max(0, ...kind.words.map((w) => searchScore(w, view.name)));
          if (score < 2) continue;
          if (best && (score < best.score || (score === best.score && view.priceIqd >= best.dish.priceIqd))) continue;
          best = {
            score,
            dish: {
              id: view.id,
              name: view.name,
              description: view.description,
              priceIqd: view.priceIqd,
              photoUrl: view.photoUrl,
              available: true,
              quickAdd: oneTap(view),
              restaurantId: card.id,
              restaurantName: card.name,
              restaurantOpen: true,
              restaurantOpensAt: null,
              kiloIqd: kiloPriceOf(view),
            },
          };
        }
        if (best) found.get(kind.key)!.push(best);
      }
    }
    return kinds.flatMap((k) => {
      const dishes = found.get(k.key)!.sort((a, b) => b.score - a.score || a.dish.priceIqd - b.dish.priceIqd || a.dish.restaurantName.localeCompare(b.dish.restaurantName, 'ar'));
      return dishes.length > 0 ? [{ key: k.key, dishes: dishes.map((d) => d.dish) }] : [];
    });
  }

  /**
   * `search.unmet` (joy h4): keeps one anonymous empty search the customer chose to tell us about.
   * Folded so «بيتزا» and «البيتزا» count together; at most `UNMET_PER_MINUTE` per caller (IP for
   * guests, person for the signed in) so one bored thumb cannot fill the Console.
   */
  async unmet(reader: Actor | CatalogReader, input: z.infer<typeof SearchUnmetInput>): Promise<{ ok: true }> {
    await this.admit(reader);
    const term = foldArabic(input.term);
    if (term.length < 2) return { ok: true };
    const personId = readerPerson(reader);
    const ip = 'ip' in reader ? (reader.ip ?? null) : null;
    const who = personId ? `p:${personId}` : `ip:${ip ?? 'none'}`;
    const hit = await this.guests.hit(`search:unmet:${who}`, 60_000, UNMET_PER_MINUTE);
    if (!hit.allowed) throw new DriverError('rate_limited', { retryAfterSec: hit.retryAfterSec });
    await this.catalog.addUnmetSearch({ cityId: input.cityId, term, typed: input.term.trim().slice(0, 60), zoneKey: input.zoneKey ?? null, signedIn: personId !== null, createdAt: this.clock.now() });
    return { ok: true };
  }

  /** Console (`search.unmetList`): the most asked-for missing words, busiest first. */
  async unmetSearches(_actor: Actor, input: z.infer<typeof UnmetSearchesInput>): Promise<UnmetSearchRow[]> {
    const since = new Date(this.clock.now().getTime() - input.days * 86_400_000);
    return aggregateUnmet(await this.catalog.unmetSearches(input.cityId, since), input.limit);
  }

  async today(reader: Actor | CatalogReader, input: z.infer<typeof CatalogTodayInput>): Promise<CatalogToday> {
    await this.admit(reader);
    const now = this.clock.now();
    const openRestaurants = (await this.cardsWithMenus(input.cityId, null, now)).filter((c) => c.card.open).length;
    let tuktukFromIqd: number | null = null;
    try {
      tuktukFromIqd = this.pricing.quote(
        PriceRequest.parse({
          cityId: input.cityId,
          vertical: 'tuktuk',
          stops: [
            { zoneId: TODAY_TUKTUK_ZONE, type: 'pickup' },
            { zoneId: TODAY_TUKTUK_ZONE, type: 'dropoff' },
          ],
          at: now,
        }),
      ).total;
    } catch {
      tuktukFromIqd = null;
    }
    const rajaa = this.todayFacts ? await this.todayFacts.rajaa() : { carsToday: 0, baghdadGarage: null };
    return {
      openRestaurants,
      rajaaCarsToday: rajaa.carsToday,
      tuktukFromIqd,
      baghdadGarage: rajaa.baghdadGarage ? { id: rajaa.baghdadGarage.id, name_ar: rajaa.baghdadGarage.nameAr, name_en: rajaa.baghdadGarage.nameEn } : null,
      latePromiseMin: this.todayFacts?.latePromiseMin(input.cityId) ?? AZIZIYAH_MONEY_RULES.latePromise.afterMin,
    };
  }

  private async admit(reader: Actor | CatalogReader): Promise<void> {
    if ('personId' in reader || reader.actor || !reader.ip) return;
    const hit = await this.guests.hit(`catalog:guest:${reader.ip}`, CATALOG_PUBLIC_RATE.windowMs, CATALOG_PUBLIC_RATE.perIp);
    if (!hit.allowed) {
      // Logged so a carrier-NAT address full of real guests shows up in the logs, not as silent refusals.
      this.log.warn(`guest catalog limit hit (${CATALOG_PUBLIC_RATE.perIp}/min) for one address; retry in ${hit.retryAfterSec}s`);
      throw new DriverError('rate_limited', { retryAfterSec: hit.retryAfterSec });
    }
  }

  private matches(s: StorefrontRecord, items: readonly CatalogItemRecord[], q: string): boolean {
    const words = q.split(' ');
    return [s.nameAr, s.cuisineAr, ...items.map((i) => i.nameAr)].some((text) => {
      const folded = foldArabic(text);
      return words.every((w) => folded.includes(w));
    });
  }

  /**
   * Every kitchen's menu and card for one read, in the storefronts' order, so what a caller does with
   * them next is exactly what the one-by-one loop did. Kitchens out of reach of the drop-off (ice
   * cream too far) are left out.
   */
  private async cardsWithMenus(cityId: string, dropoff: DeliveryPoint | null, now: Date): Promise<Array<{ card: RestaurantCard; items: readonly CatalogItemRecord[] }>> {
    const rides: RideMemo = new Map();
    const built = await mapBounded(await this.town(cityId), CARD_CONCURRENCY, async (k) => {
      const card = await this.card(k, dropoff, now, rides);
      return outOfReach(k.s, card, dropoff) ? null : { card, items: k.items };
    });
    return built.filter((b) => b !== null);
  }

  /**
   * x1: the town's kitchens, reused for `TOWN_SNAPSHOT_MS` (one read of every storefront, menu,
   * merchant profile and deal list instead of one per kitchen per list), rebuilt at once when the
   * catalog or a merchant's settings changed on this instance.
   */
  private town(cityId: string): Promise<Kitchen[]> {
    const now = this.clock.now().getTime();
    const menus = this.catalog.changeStamp();
    const merchants = this.merchants.changeStamp?.() ?? 0;
    const stamp = `${menus}:${merchants}`;
    const hit = this.towns.get(cityId);
    const settling = hit !== undefined && hit.builtAt - Math.max(menus, merchants) < TOWN_SETTLE_MS;
    if (hit && hit.stamp === stamp && now - hit.builtAt < (settling ? TOWN_SETTLE_MS : TOWN_SNAPSHOT_MS)) return hit.kitchens;
    const at = new Date(now);
    const kitchens = this.catalog.storefronts(cityId).then((fronts) => mapBounded(fronts, CARD_CONCURRENCY, (s) => this.kitchen(s, at)));
    const entry = { builtAt: now, stamp, kitchens };
    this.towns.set(cityId, entry);
    // A failed build is not kept: the next read tries again.
    kitchens.catch(() => {
      if (this.towns.get(cityId) === entry) this.towns.delete(cityId);
    });
    return kitchens;
  }

  /** One kitchen's facts, read now (one after another, so a build holds one connection per kitchen). */
  private async kitchen(s: StorefrontRecord, at: Date): Promise<Kitchen> {
    const items = await this.catalog.menu(s.orgId);
    const profile = await this.merchants.profile(s.orgId, s.cityId, at);
    const deals = (await this.merchants.deals?.(s.orgId, at)) ?? [];
    return { s, items, profile, deals };
  }

  /**
   * Kitchen → door courier minutes from the one ETA service, plus pickup and hand-over; null without pins.
   * Within one read the same pin pair (branches at one spot) is asked for once.
   */
  private rideMinutes(from: DeliveryPoint, to: DeliveryPoint, rides: RideMemo): Promise<number | null> {
    const a = pinOf(from);
    const b = pinOf(to);
    if (!a || !b) return Promise.resolve(null);
    const key = `${a.lat},${a.lng}>${b.lat},${b.lng}`;
    let minutes = rides.get(key);
    if (!minutes) {
      minutes = this.eta.minutes(a, b, 'bike').then((m) => m.minutes + STOREFRONT_RULES.handoverMin);
      rides.set(key, minutes);
    }
    return minutes;
  }

  private async card(k: Kitchen, dropoff: DeliveryPoint | null, now: Date, rides: RideMemo = new Map()): Promise<RestaurantCard> {
    const { s, items } = k;
    const { location, pauseWindows: pauses, busy: merchantBusy, closed, reopensAt, holiday } = k.profile;
    const busy = this.catalog.isBusy(s.orgId) || merchantBusy === true;
    const prep = prepRange(basePrepMin(s.prepMin, items), busy);
    const eta = etaRange(prep, location && dropoff ? await this.rideMinutes(location, dropoff, rides) : null);
    const fees = location && dropoff ? this.feePreview(s.cityId, location, dropoff, now) : null;
    // REL-16: a kitchen a kill switch stops looks closed here, with the switch's words, not only at «اطلب».
    const stoppedNote = this.switches ? await this.switches.stopped({ cityId: s.cityId, merchantOrgId: s.orgId, kitchenZone: location?.zoneKey ?? null, dropoffZone: dropoff?.zoneKey ?? null }) : null;
    const state = holiday
      ? { open: false, closedReason: 'hours' as const, opensAt: null }
      : stoppedNote
        ? { open: false, closedReason: 'paused' as const, opensAt: null }
        : closed
          ? { open: false, closedReason: 'paused' as const, opensAt: reopensAt ? localTwelveHour(reopensAt, this.merchants.timeZone) : null }
        : openState(now, s.hours, pauses, this.merchants.timeZone);
    return {
      id: s.orgId,
      cityId: s.cityId,
      name: s.nameAr,
      cuisine: s.cuisineAr,
      tags: [...s.tags],
      photoUrl: this.photo(s.photoUrl),
      rating: s.ratingPlaceholder,
      pickup: location,
      prepMinMinutes: prep.min,
      prepMaxMinutes: prep.max,
      etaMinMinutes: eta?.min ?? null,
      etaMaxMinutes: eta?.max ?? null,
      deliveryFeeIqd: fees?.deliveryFeeIqd ?? null,
      serviceFeeIqd: fees?.serviceFeeIqd ?? null,
      minOrderIqd: s.minOrderIqd,
      smallOrderFeeIqd: s.minOrderIqd > 0 ? SMALL_ORDER_FEE_IQD : 0,
      open: state.open,
      closedReason: state.closedReason,
      opensAt: state.opensAt,
      opensInMin: holiday || stoppedNote || state.open ? null : closed ? (reopensAt ? Math.max(1, Math.ceil((reopensAt.getTime() - now.getTime()) / 60_000)) : null) : this.opensInMin(now, s.hours, pauses, state.closedReason),
      ...(stoppedNote ? { stoppedNote } : {}),
      busy,
      hours: s.hours.map((h) => ({ dow: h.dow, start: h.start, end: h.end })),
      pauses: pauses.map((p) => ({ dow: p.dow, start: p.start, end: p.end })),
      deals: k.deals,
    };
  }

  /** f12: minutes until a closed kitchen opens — its next opening window, or the end of the pause it is in. */
  private opensInMin(now: Date, hours: StorefrontRecord['hours'], pauses: ReadonlyArray<{ dow: number; start: string; end: string }>, reason: 'hours' | 'paused' | null): number | null {
    if (reason === 'hours') return nextOpeningIn(now, hours, this.merchants.timeZone);
    const pause = activeWindow(now, pauses, this.merchants.timeZone);
    return pause ? minutesUntilLocal(now, pause.end, this.merchants.timeZone) : null;
  }

  /** The food quote from the kitchen's zone to the customer's, at the door; null when it cannot be priced. */
  private feePreview(cityId: string, pickup: DeliveryPoint, dropoff: DeliveryPoint, at: Date): { deliveryFeeIqd: number; serviceFeeIqd: number } | null {
    try {
      const quote = this.pricing.quote(
        PriceRequest.parse({
          cityId,
          vertical: 'food',
          stops: [
            { zoneId: pickup.zoneKey, type: 'pickup', ...(pickup.pin ? { pin: pickup.pin } : {}) },
            { zoneId: dropoff.zoneKey, type: 'dropoff', ...(dropoff.pin ? { pin: dropoff.pin } : {}) },
          ],
          options: { doorPickup: false, streetHandover: false },
          at,
        }),
      );
      return deliveryFeesOf(quote);
    } catch {
      return null;
    }
  }
}
