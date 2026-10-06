import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AZIZIYAH_MONEY_RULES,
  CATALOG_PUBLIC_RATE,
  CATALOG_SEARCH_LIMITS,
  DriverError,
  PriceRequest,
  SMALL_ORDER_FEE_IQD,
  menuDealOf,
  deliveryFeesOf,
  searchScore,
  type Actor,
  type CatalogPicksInput,
  type CatalogReader,
  type CatalogSearchDish,
  type CatalogSearchInput,
  type CatalogSearchResult,
  type CatalogToday,
  type CatalogTodayInput,
  type CustomerCatalogPort,
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
import { InMemoryWindowCounter, WINDOW_COUNTER, type WindowCounter } from '../../shared/window-counter.js';
import { PricingService } from '../pricing/index.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import type { CatalogItemRecord, StorefrontRecord, UnmetSearchRecord } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';
import { activeWindow, basePrepMin, etaRange, foldArabic, menuItemView, menuSections, minutesUntilLocal, nextOpeningIn, openState, pinOf, prepRange, STOREFRONT_RULES } from './storefront.js';

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
    /** One of the store's holiday closures (Merchant app hours): closed for the day, shown as hours. */
    holiday?: boolean;
  }>;
  /** Live merchant deals as badges (bound by orders over the promotions module); none when absent. */
  deals?(orgId: string, at: Date): Promise<DealBadge[]>;
}

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

/** The zone a "tuktuk from" fare is priced in: a ride inside the town centre. */
const TODAY_TUKTUK_ZONE = 'centre';

/**
 * The customer catalog read (`catalog.restaurants`, `catalog.menu`, M3). Composes the catalog's
 * storefronts and menus with the merchant's settings from orgs (location, pause windows), busy mode,
 * and a fee preview from the pricing engine split exactly as `orders.place` charges it, so the
 * delivery fee on a card is the one the customer pays at checkout (door hand-over, now).
 */
@Injectable()
export class CatalogRpc implements CustomerCatalogPort {
  private readonly clock: Clock;
  private readonly guests: WindowCounter;
  private readonly eta: EtaService;

  constructor(
    private readonly catalog: CatalogService,
    @Inject(STOREFRONT_MERCHANTS) private readonly merchants: StorefrontMerchants,
    @Inject(PricingService) private readonly pricing: StorefrontPricing,
    @Optional() @Inject(CLOCK) clock?: Clock,
    @Optional() @Inject(WINDOW_COUNTER) guests?: WindowCounter,
    @Optional() eta?: EtaService,
    @Optional() @Inject(STOREFRONT_TODAY) private readonly todayFacts: StorefrontToday | null = null,
  ) {
    this.clock = clock ?? new SystemClock();
    this.guests = guests ?? new InMemoryWindowCounter(this.clock);
    this.eta = eta ?? new EtaService(new StraightLineRouter());
  }

  async restaurants(reader: Actor | CatalogReader, input: z.infer<typeof RestaurantsInput>): Promise<RestaurantCard[]> {
    await this.admit(reader);
    const now = this.clock.now();
    const fronts = await this.catalog.storefronts(input.cityId);
    const f = input.filters;
    const q = f.query ? foldArabic(f.query) : '';
    const cards: RestaurantCard[] = [];
    for (const s of fronts) {
      const items = await this.catalog.menu(s.orgId);
      if (q && !this.matches(s, items, q)) continue;
      if (f.tag && !s.tags.includes(f.tag)) continue;
      const card = await this.card(s, items, input.dropoff ?? null, now);
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
    const items = await this.catalog.menu(s.orgId);
    const restaurant = await this.card(s, items, input.dropoff ?? null, now);
    // f10: each dish's price under a live percent deal with no minimum (the rule orders.quote applies).
    const deals = restaurant.deals ?? [];
    const categories = menuSections(items, now, this.merchants.timeZone).map((c) => ({ ...c, items: c.items.map((i) => ({ ...i, deal: menuDealOf(i, deals) })) }));
    return { restaurant, categories };
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
    for (const s of await this.catalog.storefronts(input.cityId)) {
      const items = await this.catalog.menu(s.orgId);
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
      if (kitchenScore === 0 && hits.length === 0) continue;
      const card = await this.card(s, items, input.dropoff ?? null, now);
      // A kitchen that only matches by its dishes still shows in the kitchen list, after the rest.
      restaurants.push({ card, score: kitchenScore > 0 ? kitchenScore : 0.5 });
      for (const { item, score } of hits) {
        const view = menuItemView(item, now, this.merchants.timeZone);
        dishes.push({
          score,
          dish: {
            id: view.id,
            name: view.name,
            description: view.description,
            priceIqd: view.priceIqd,
            photoUrl: view.photoUrl,
            available: view.available,
            restaurantId: card.id,
            restaurantName: card.name,
            restaurantOpen: card.open,
            restaurantOpensAt: card.opensAt,
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
    for (const s of await this.catalog.storefronts(input.cityId)) {
      const items = await this.catalog.menu(s.orgId);
      const card = await this.card(s, items, input.dropoff ?? null, now);
      if (!card.open) continue;
      for (const item of items) {
        const rank = words.findIndex((w) => searchScore(w, item.nameAr) >= 2);
        if (rank === -1) continue;
        const view = menuItemView(item, now, this.merchants.timeZone);
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
            restaurantId: card.id,
            restaurantName: card.name,
            restaurantOpen: true,
            restaurantOpensAt: null,
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
   * `search.unmet` (joy h4): keeps one anonymous empty search the customer chose to tell us about.
   * Folded so «بيتزا» and «البيتزا» count together; at most `UNMET_PER_MINUTE` per caller (IP for
   * guests, person for the signed in) so one bored thumb cannot fill the Console.
   */
  async unmet(reader: Actor | CatalogReader, input: z.infer<typeof SearchUnmetInput>): Promise<{ ok: true }> {
    await this.admit(reader);
    const term = foldArabic(input.term);
    if (term.length < 2) return { ok: true };
    const personId = 'personId' in reader ? reader.personId : (reader.actor?.personId ?? null);
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
    let openRestaurants = 0;
    for (const s of await this.catalog.storefronts(input.cityId)) {
      if ((await this.card(s, await this.catalog.menu(s.orgId), null, now)).open) openRestaurants += 1;
    }
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
    if (!hit.allowed) throw new DriverError('rate_limited', { retryAfterSec: hit.retryAfterSec });
  }

  private matches(s: StorefrontRecord, items: readonly CatalogItemRecord[], q: string): boolean {
    const words = q.split(' ');
    return [s.nameAr, s.cuisineAr, ...items.map((i) => i.nameAr)].some((text) => {
      const folded = foldArabic(text);
      return words.every((w) => folded.includes(w));
    });
  }

  /** Kitchen → door courier minutes from the one ETA service, plus pickup and hand-over; null without pins. */
  private async rideMinutes(from: DeliveryPoint, to: DeliveryPoint): Promise<number | null> {
    const a = pinOf(from);
    const b = pinOf(to);
    if (!a || !b) return null;
    return (await this.eta.minutes(a, b, 'bike')).minutes + STOREFRONT_RULES.handoverMin;
  }

  private async card(s: StorefrontRecord, items: readonly CatalogItemRecord[], dropoff: DeliveryPoint | null, now: Date): Promise<RestaurantCard> {
    const { location, pauseWindows: pauses, busy: merchantBusy, closed, holiday } = await this.merchants.profile(s.orgId, s.cityId, now);
    const busy = this.catalog.isBusy(s.orgId) || merchantBusy === true;
    const prep = prepRange(basePrepMin(s.prepMin, items), busy);
    const eta = etaRange(prep, location && dropoff ? await this.rideMinutes(location, dropoff) : null);
    const fees = location && dropoff ? this.feePreview(s.cityId, location, dropoff, now) : null;
    const state = holiday
      ? { open: false, closedReason: 'hours' as const, opensAt: null }
      : closed
        ? { open: false, closedReason: 'paused' as const, opensAt: null }
        : openState(now, s.hours, pauses, this.merchants.timeZone);
    return {
      id: s.orgId,
      cityId: s.cityId,
      name: s.nameAr,
      cuisine: s.cuisineAr,
      tags: [...s.tags],
      photoUrl: s.photoUrl,
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
      opensInMin: holiday || closed || state.open ? null : this.opensInMin(now, s.hours, pauses, state.closedReason),
      busy,
      deals: (await this.merchants.deals?.(s.orgId, now)) ?? [],
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
