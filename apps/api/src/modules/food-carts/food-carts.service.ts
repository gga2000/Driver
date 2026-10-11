import { Inject, Injectable } from '@nestjs/common';
import {
  AZIZIYAH_MONEY_RULES,
  AZIZIYAH_ZONES,
  DriverError,
  FOOD_CART_RULES,
  OPEN_WALKUP_STATES,
  localClock,
  walkMinutes,
  type Actor,
  type CartCard,
  type CartDish,
  type CartInput,
  type CartKind,
  type CartModeView,
  type CartSpot,
  type CartOwnerView,
  type CartSettingsInput,
  type CartsInput,
  type CartsList,
  type CollectWalkupInput,
  type FollowCartInput,
  type FoodCartsPort,
  type FoodCartsReader,
  type LatLng,
  type MerchantScope,
  type OpenCartHereInput,
  type OwnerWalkupInput,
  type PlaceWalkupInput,
  type WalkupLine,
  type WalkupRef,
  type WalkupState,
  type WalkupView,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { CatalogService, FOOD_CART_TAG, itemOnSale, type CatalogItemRecord } from '../catalog/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { OrgsService } from '../orgs/index.js';
import { FOOD_CARTS_REPOSITORY, type FoodCartRecord, type FoodCartsRepository, type WalkupRecord } from './food-carts.repository.js';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const TIMEZONE = 'Asia/Baghdad';
/** Dishes a list card shows; the cart page shows the whole menu. */
const CARD_DISHES = 3;
/** «تذاكري»: the tickets of the last day. */
const MINE_WINDOW_MS = 24 * HOUR_MS;

/** A cart's storefront cuisine line, by kind. */
const CART_KIND_AR: Record<CartKind, string> = { liver: 'كبدة', falafel: 'فلافل', tea: 'چاي', corn: 'عرانيس', bagilla: 'باگلة', cart: 'عربانة' };

/** Is the cart open at `now`: opened, not closed since, inside the night's limits. */
export function cartOpen(c: Pick<FoodCartRecord, 'openedAt' | 'closedAt' | 'closesAt'>, now: Date): boolean {
  if (!c.openedAt) return false;
  if (c.closedAt && c.closedAt.getTime() >= c.openedAt.getTime()) return false;
  if (now.getTime() - c.openedAt.getTime() >= FOOD_CART_RULES.maxOpenHours * HOUR_MS) return false;
  return !(c.closesAt && c.closesAt.getTime() <= now.getTime());
}

/** The zone a spot sits in, for the courier's pickup: the nearest zone centre. */
function zoneKeyAt(at: LatLng): string {
  let best = AZIZIYAH_ZONES[0]!;
  let bestD = Infinity;
  for (const z of AZIZIYAH_ZONES) {
    const d = (z.lat - at.lat) ** 2 + ((z.lng - at.lng) * Math.cos((at.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best.id;
}

/**
 * Food carts «عربانات» (2026-10-11). A cart is a restaurant org (base tier) with a `food_carts` row: the
 * owner opens it where he stands tonight («فتحت هنا»), which also moves the org's pickup point and
 * opens it for delivery orders; closing closes both. Followers hear the first opening of a Baghdad day
 * once (`food_cart.opened`, deduped by day). A walk-over ticket is priced here from the catalog (never
 * the client), carries a 3-digit code and is paid in cash at the cart; collecting it records the
 * restaurants' pickup commission tier on its total. Every ticket move is a guarded update.
 */
@Injectable()
export class FoodCartsService implements FoodCartsPort {
  constructor(
    @Inject(FOOD_CARTS_REPOSITORY) private readonly repo: FoodCartsRepository,
    private readonly catalog: CatalogService,
    private readonly orgs: OrgsService,
    private readonly identity: IdentityService,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ───────────────────────── setup ─────────────────────────

  /** Makes a restaurant org a cart (seed, ops). Returns the existing row when it is one already. */
  async register(input: { orgId: string; cityId: string; kind: CartKind; usual?: { from: string; to: string } | null; awayNote?: string | null }): Promise<FoodCartRecord> {
    const existing = await this.repo.byOrg(input.orgId);
    if (existing) return existing;
    await this.orgs.setMerchantSettings(input.orgId, { commissionTier: 'base' });
    // A storefront tagged `food_cart`, so a delivery order goes through the menu, basket and checkout
    // every kitchen uses; the restaurant lists leave `food_cart` storefronts out (carts have their own).
    const org = await this.orgs.get(input.orgId);
    if (!(await this.catalog.storefront(input.orgId))) {
      await this.catalog.saveStorefront({ orgId: input.orgId, cityId: input.cityId, nameAr: org.name, cuisineAr: CART_KIND_AR[input.kind], tags: [FOOD_CART_TAG, input.kind], minOrderIqd: 0, hours: [] });
    }
    return this.repo.create({
      orgId: input.orgId,
      cityId: input.cityId,
      kind: input.kind,
      spot: null,
      openedAt: null,
      closesAt: null,
      closedAt: null,
      usualFrom: input.usual?.from ?? null,
      usualTo: input.usual?.to ?? null,
      awayNote: input.awayNote ?? null,
    });
  }

  // ───────────────────────── customer ─────────────────────────

  async list(reader: FoodCartsReader, input: z.output<typeof CartsInput>): Promise<CartsList> {
    const now = this.clock.now();
    const carts = await this.repo.inCity(input.cityId);
    const ids = carts.map((c) => c.id);
    const [following, counts] = await Promise.all([
      reader.actor ? this.repo.followed(reader.actor.personId, ids) : Promise.resolve(new Set<string>()),
      this.repo.followerCounts(ids),
    ]);
    const cards = await Promise.all(carts.map((c) => this.card(c, { now, near: input.near ?? null, following: following.has(c.id), followers: counts.get(c.id) ?? 0, dishes: CARD_DISHES })));
    const byWalk = (a: CartCard, b: CartCard) => (a.walkMin ?? 999) - (b.walkMin ?? 999) || a.name.localeCompare(b.name, 'ar');
    return {
      open: cards.filter((c) => c.open).sort(byWalk),
      closed: cards.filter((c) => !c.open).sort((a, b) => Number(b.following) - Number(a.following) || byWalk(a, b)),
      followedIds: [...following],
    };
  }

  async get(reader: FoodCartsReader, input: z.output<typeof CartInput>): Promise<CartCard> {
    const c = await this.cartOrThrow(input.cartId);
    const [following, counts] = await Promise.all([
      reader.actor ? this.repo.followed(reader.actor.personId, [c.id]) : Promise.resolve(new Set<string>()),
      this.repo.followerCounts([c.id]),
    ]);
    return this.card(c, { now: this.clock.now(), near: input.near ?? null, following: following.has(c.id), followers: counts.get(c.id) ?? 0, dishes: null });
  }

  async follow(actor: Actor, input: FollowCartInput): Promise<{ following: boolean; followers: number }> {
    const c = await this.cartOrThrow(input.cartId);
    if (input.on) {
      const already = await this.repo.followed(actor.personId, [c.id]);
      if (!already.has(c.id) && (await this.repo.followCount(actor.personId)) >= FOOD_CART_RULES.maxFollows) throw new DriverError('cart_follow_limit');
    }
    await this.repo.setFollow(actor.personId, c.id, input.on, this.clock.now());
    const counts = await this.repo.followerCounts([c.id]);
    return { following: input.on, followers: counts.get(c.id) ?? 0 };
  }

  async placeWalkup(actor: Actor, input: PlaceWalkupInput): Promise<WalkupView> {
    const now = this.clock.now();
    const c = await this.cartOrThrow(input.cartId);
    if (!cartOpen(c, now)) throw new DriverError('cart_closed');
    const mine = await this.settle(await this.repo.walkupsOfPerson(actor.personId, new Date(now.getTime() - MINE_WINDOW_MS)), now);
    if (mine.filter((w) => OPEN_WALKUP_STATES.includes(w.state)).length >= FOOD_CART_RULES.maxOpenTickets) throw new DriverError('walkup_too_many');

    // One line per dish, priced from the catalog (never the client's figure).
    const qty = new Map<string, number>();
    for (const l of input.lines) qty.set(l.itemId, Math.min(FOOD_CART_RULES.maxQty, (qty.get(l.itemId) ?? 0) + l.qty));
    const items = await this.catalog.itemsOf(c.orgId, [...qty.keys()]);
    if (items.length !== qty.size || items.some((i) => !itemOnSale(i, now))) throw new DriverError('cart_dish_unavailable');
    const lines: WalkupLine[] = items.map((i) => ({ itemId: i.id, nameAr: i.nameAr, qty: qty.get(i.id)!, priceIqd: i.priceIqd }));
    const totalIqd = lines.reduce((s, l) => s + l.qty * l.priceIqd, 0);

    const open = await this.repo.walkupsOfCart(c.id, OPEN_WALKUP_STATES);
    const w = await this.repo.createWalkup({
      cartId: c.id,
      orgId: c.orgId,
      personId: actor.personId,
      code: this.freshCode(new Set(open.map((x) => x.code))),
      state: 'placed',
      lines,
      note: input.note?.length ? input.note : null,
      totalIqd,
      commissionIqd: 0,
      readyBy: new Date(now.getTime() + (await this.readyMin(c)) * MIN_MS),
      placedAt: now,
      readyAt: null,
      collectedAt: null,
      cancelledAt: null,
    });
    await this.emit(actor.personId, 'food_cart.walkup_placed', c, { walkupId: w.id, code: w.code, totalIqd });
    return this.view(w, c);
  }

  async myWalkups(actor: Actor): Promise<WalkupView[]> {
    const now = this.clock.now();
    const list = await this.settle(await this.repo.walkupsOfPerson(actor.personId, new Date(now.getTime() - MINE_WINDOW_MS)), now);
    const carts = new Map<string, FoodCartRecord>();
    for (const id of new Set(list.map((w) => w.cartId))) {
      const c = await this.repo.get(id);
      if (c) carts.set(id, c);
    }
    return Promise.all(list.filter((w) => carts.has(w.cartId)).map((w) => this.view(w, carts.get(w.cartId)!)));
  }

  async cancelWalkup(actor: Actor, input: WalkupRef): Promise<WalkupView> {
    const w = await this.repo.walkup(input.walkupId);
    if (!w || w.personId !== actor.personId) throw new DriverError('walkup_not_found');
    const done = await this.repo.updateWalkup(w.id, ['placed'], { state: 'cancelled', cancelledAt: this.clock.now() });
    if (!done) throw new DriverError('walkup_state_conflict');
    const c = await this.cartOrThrow(w.cartId);
    await this.emit(actor.personId, 'food_cart.walkup_cancelled', c, { walkupId: w.id, code: w.code });
    return this.view(done, c);
  }

  // ───────────────────────── owner (Merchant app cart mode) ─────────────────────────

  async mode(actor: Actor, input: MerchantScope): Promise<CartModeView> {
    await this.staffAt(actor, input.merchantOrgId);
    return { cart: (await this.repo.byOrg(input.merchantOrgId)) !== null };
  }

  async owner(actor: Actor, input: MerchantScope): Promise<CartOwnerView> {
    const c = await this.ownCart(actor, input.merchantOrgId);
    return this.ownerView(c);
  }

  async openHere(actor: Actor, input: OpenCartHereInput): Promise<CartOwnerView> {
    const c = await this.ownCart(actor, input.merchantOrgId);
    const spot = { lat: input.at.lat, lng: input.at.lng, label: input.label?.length ? input.label : null, facing: input.facing ?? c.spot?.facing ?? 180 };
    return this.ownerView(await this.openAt(c, spot, input.closesAt ?? null, actor.personId));
  }

  /**
   * «فتحت هنا»: the cart is open at `spot` from now, its org's pickup point moves there and delivery
   * orders open. The first opening of a Baghdad day tells the followers (`food_cart.opened`).
   */
  async openAt(c: FoodCartRecord, spot: CartSpot, closesAt: Date | null, actorId: string): Promise<FoodCartRecord> {
    const now = this.clock.now();
    const wasOpen = cartOpen(c, now);
    const next = await this.repo.update(c.id, {
      spot,
      openedAt: wasOpen ? c.openedAt : now,
      closesAt: closesAt && closesAt.getTime() > now.getTime() ? closesAt : null,
      closedAt: null,
      awayNote: null,
    });
    await this.orgs.setMerchantSettings(c.orgId, { location: { zoneKey: zoneKeyAt(spot), pin: { lat: spot.lat, lng: spot.lng } }, closed: null });
    if (!wasOpen) {
      const followerIds = await this.repo.followerIds(c.id);
      const day = localClock(now, TIMEZONE).date;
      const zone = AZIZIYAH_ZONES.find((z) => z.id === zoneKeyAt(spot));
      await this.emit(actorId, 'food_cart.opened', next, { followerIds, spotLabel: spot.label, zoneName_ar: zone?.name_ar ?? null, localDate: day, kind: c.kind }, `food_cart.opened:${c.id}:${day}`);
    }
    return next;
  }

  /** Where the cart stands when last seen, without opening it (seed, ops). */
  async placeAt(cartId: string, spot: CartSpot): Promise<FoodCartRecord> {
    return this.repo.update(cartId, { spot });
  }

  async close(actor: Actor, input: MerchantScope): Promise<CartOwnerView> {
    const now = this.clock.now();
    const c = await this.ownCart(actor, input.merchantOrgId);
    const next = await this.repo.update(c.id, { closedAt: now, closesAt: null });
    await this.orgs.setMerchantSettings(c.orgId, { closed: { reason: 'cart_closed', note: null, at: now } });
    // Tickets the cart never started are called off (their customers are told); ready ones wait to be collected.
    for (const w of await this.repo.walkupsOfCart(c.id, ['placed'])) {
      const done = await this.repo.updateWalkup(w.id, ['placed'], { state: 'cancelled', cancelledAt: now });
      if (done) await this.emit(actor.personId, 'food_cart.walkup_rejected', c, { walkupId: w.id, personId: w.personId, code: w.code, why: 'closed' });
    }
    return this.ownerView(next);
  }

  async settings(actor: Actor, input: CartSettingsInput): Promise<CartOwnerView> {
    const c = await this.ownCart(actor, input.merchantOrgId);
    const next = await this.repo.update(c.id, {
      ...(input.usual !== undefined ? { usualFrom: input.usual?.from ?? null, usualTo: input.usual?.to ?? null } : {}),
      ...(input.awayNote !== undefined ? { awayNote: input.awayNote?.length ? input.awayNote : null } : {}),
    });
    return this.ownerView(next);
  }

  async ready(actor: Actor, input: OwnerWalkupInput): Promise<CartOwnerView> {
    const c = await this.ownCart(actor, input.merchantOrgId);
    const w = await this.ticketOf(c, input.walkupId);
    const done = await this.repo.updateWalkup(w.id, ['placed'], { state: 'ready', readyAt: this.clock.now() });
    if (!done) throw new DriverError('walkup_state_conflict');
    await this.emit(actor.personId, 'food_cart.walkup_ready', c, { walkupId: w.id, personId: w.personId, code: w.code });
    return this.ownerView(c);
  }

  async reject(actor: Actor, input: OwnerWalkupInput): Promise<CartOwnerView> {
    const c = await this.ownCart(actor, input.merchantOrgId);
    const w = await this.ticketOf(c, input.walkupId);
    const done = await this.repo.updateWalkup(w.id, ['placed'], { state: 'cancelled', cancelledAt: this.clock.now() });
    if (!done) throw new DriverError('walkup_state_conflict');
    await this.emit(actor.personId, 'food_cart.walkup_rejected', c, { walkupId: w.id, personId: w.personId, code: w.code, why: 'cart' });
    return this.ownerView(c);
  }

  async collect(actor: Actor, input: CollectWalkupInput): Promise<CartOwnerView> {
    const c = await this.ownCart(actor, input.merchantOrgId);
    const w = await this.ticketOf(c, input.walkupId);
    if (w.code !== input.code) throw new DriverError('walkup_code_wrong');
    // The restaurants' pickup tier (Ali's pick: carts pay what restaurants pay), on the cash total.
    const commissionIqd = Math.round(w.totalIqd * AZIZIYAH_MONEY_RULES.commission.pickup);
    const done = await this.repo.updateWalkup(w.id, OPEN_WALKUP_STATES, { state: 'collected', collectedAt: this.clock.now(), commissionIqd });
    if (!done) throw new DriverError('walkup_state_conflict');
    await this.emit(actor.personId, 'food_cart.walkup_collected', c, { walkupId: w.id, totalIqd: w.totalIqd, commissionIqd });
    return this.ownerView(c);
  }

  // ───────────────────────── helpers ─────────────────────────

  private async cartOrThrow(id: string): Promise<FoodCartRecord> {
    const c = await this.repo.get(id);
    if (!c) throw new DriverError('cart_not_found');
    return c;
  }

  /** Owner or staff of the store; FORBIDDEN otherwise. */
  private async staffAt(actor: Actor, orgId: string): Promise<void> {
    if (await this.identity.hasRole(actor.personId, 'merchant_owner', orgId)) return;
    if (await this.identity.hasRole(actor.personId, 'merchant_staff', orgId)) return;
    throw new DriverError('forbidden');
  }

  private async ownCart(actor: Actor, orgId: string): Promise<FoodCartRecord> {
    await this.staffAt(actor, orgId);
    const c = await this.repo.byOrg(orgId);
    if (!c) throw new DriverError('cart_not_found');
    return c;
  }

  private async ticketOf(c: FoodCartRecord, walkupId: string): Promise<WalkupRecord> {
    const w = await this.repo.walkup(walkupId);
    if (!w || w.cartId !== c.id) throw new DriverError('walkup_not_found');
    return w;
  }

  private async readyMin(c: FoodCartRecord): Promise<number> {
    const prep = (await this.orgs.merchantSettings(c.orgId).catch(() => null))?.defaultPrepMin;
    return prep && prep > 0 ? prep : FOOD_CART_RULES.readyMin[c.kind];
  }

  private freshCode(taken: ReadonlySet<string>): string {
    for (let i = 0; i < 50; i++) {
      const code = String(100 + Math.floor(Math.random() * 900));
      if (!taken.has(code)) return code;
    }
    return String(100 + Math.floor(Math.random() * 900));
  }

  /** Open tickets nobody collected within the hold turn `expired` (guarded, so a late collect wins). */
  private async settle(list: WalkupRecord[], now: Date): Promise<WalkupRecord[]> {
    const holdMs = FOOD_CART_RULES.holdMin * MIN_MS;
    return Promise.all(
      list.map(async (w) => {
        if (!OPEN_WALKUP_STATES.includes(w.state)) return w;
        const from = (w.readyAt ?? w.readyBy).getTime();
        if (now.getTime() - from < holdMs) return w;
        return (await this.repo.updateWalkup(w.id, OPEN_WALKUP_STATES, { state: 'expired' })) ?? (await this.repo.walkup(w.id)) ?? w;
      }),
    );
  }

  private async card(c: FoodCartRecord, o: { now: Date; near: LatLng | null; following: boolean; followers: number; dishes: number | null }): Promise<CartCard> {
    const [org, menu, readyMin] = await Promise.all([this.orgs.get(c.orgId), this.catalog.menu(c.orgId), this.readyMin(c)]);
    const open = cartOpen(c, o.now);
    const dishes: CartDish[] = menu.map((i: CatalogItemRecord) => ({ itemId: i.id, nameAr: i.nameAr, priceIqd: i.priceIqd, available: itemOnSale(i, o.now), photoUrl: i.photoUrl }));
    return {
      id: c.id,
      merchantOrgId: c.orgId,
      name: org.name,
      kind: c.kind,
      open,
      spot: c.spot,
      usual: c.usualFrom && c.usualTo ? { from: c.usualFrom, to: c.usualTo } : null,
      awayNote: open ? null : c.awayNote,
      openedAt: open ? c.openedAt : null,
      closesAt: open ? c.closesAt : null,
      walkMin: o.near && c.spot ? walkMinutes(o.near, c.spot) : null,
      readyMin,
      following: o.following,
      followers: o.followers,
      dishes: o.dishes === null ? dishes : dishes.filter((d) => d.available).slice(0, o.dishes),
      delivery: open && c.spot !== null,
      pickup: open && c.spot ? { zoneKey: zoneKeyAt(c.spot), pin: { lat: c.spot.lat, lng: c.spot.lng } } : null,
    };
  }

  private async view(w: WalkupRecord, c: FoodCartRecord): Promise<WalkupView> {
    const org = await this.orgs.get(c.orgId);
    return { ...this.ownerTicket(w), cartName: org.name, kind: c.kind, spot: c.spot };
  }

  private ownerTicket(w: WalkupRecord): CartOwnerView['walkups'][number] {
    return { id: w.id, cartId: w.cartId, code: w.code, state: w.state, lines: w.lines, note: w.note, totalIqd: w.totalIqd, placedAt: w.placedAt, readyAt: w.readyAt, readyBy: w.readyBy };
  }

  private async ownerView(c: FoodCartRecord): Promise<CartOwnerView> {
    const now = this.clock.now();
    const counts = await this.repo.followerCounts([c.id]);
    const open = (await this.settle(await this.repo.walkupsOfCart(c.id, OPEN_WALKUP_STATES), now)).filter((w) => OPEN_WALKUP_STATES.includes(w.state as WalkupState));
    const since = c.openedAt ?? new Date(now.getTime() - MINE_WINDOW_MS);
    const tonight = await this.repo.collectedSince(c.id, since);
    return {
      cart: await this.card(c, { now, near: null, following: false, followers: counts.get(c.id) ?? 0, dishes: null }),
      walkups: open.map((w) => this.ownerTicket(w)),
      tonight: { collected: tonight.count, cashIqd: tonight.cashIqd },
    };
  }

  private async emit(actorId: string, type: string, c: FoodCartRecord, payload: Record<string, unknown>, idempotencyKey?: string): Promise<void> {
    const org = await this.orgs.get(c.orgId);
    await this.uow.run((tx) =>
      this.events.emit(
        tx,
        { actorId, type, occurredAt: this.clock.now(), payload: { cartId: c.id, merchantOrgId: c.orgId, cartName: org.name, ...payload }, ...(idempotencyKey ? { idempotencyKey } : {}) },
        { name: 'org', id: c.orgId },
      ),
    );
  }
}
