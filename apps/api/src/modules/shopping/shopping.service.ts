import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  AZIZIYAH_ZONES,
  DriverError,
  localClock,
  type Actor,
  type PhotoUploadTicket,
  type DeliveryPoint,
  type MerchantScope,
} from '@driver/contracts';
import {
  SHOPPING_RULES,
  type AppShopView,
  type AppShopsInput,
  type BakeryOwnerView,
  type BakeryView,
  type DailyBreadInput,
  type DailyBreadPatch,
  type DailyBreadRef,
  type DailyBreadTime,
  type DailyBreadView,
  type ErrandUploadInput,
  type PostPricesInput,
  type ProduceItemView,
  type SetBakeryStateInput,
  type ShopInput,
  type ShopKind,
  type ShopModeView,
  type ShoppingDoor,
  type ShoppingDoorInput,
  type ShoppingFront,
  type ShoppingFrontInput,
  type ShoppingPort,
  type ShoppingReader,
  type ShopState,
  type StallOwnerView,
  type StallView,
} from '@driver/contracts/shopping';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import {
  CatalogService,
  STOREFRONT_PHOTOS,
  UPLOAD_PHOTO_PREFIX,
  activeWindow,
  nextOpening,
  photoLink,
  pinOf,
  twelveHour,
  type CatalogItemRecord,
  type PhotoLink,
  type PhotoLinks,
  type StorefrontRecord,
} from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { IdentityService } from '../identity/index.js';
import { OrdersService } from '../orders/index.js';
import { OrgsService, closedNow } from '../orgs/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { ShopItemsService, type ShopItemRecord } from '../shop-items/index.js';
import {
  SHOPPING_REPOSITORY,
  type DailyBreadRecord,
  type DayPostRecord,
  type ShoppingRepository,
} from './shopping.repository.js';

const TIMEZONE = 'Asia/Baghdad';
const DAY_MS = 86_400_000;
/** Every storefront of a stall or bakery carries this tag (kept out of the restaurant lists). */
export const SHOP_TAG = 'shop';
/** Town riding pace for the «15 دقيقة» estimate: km per hour along streets, plus hand-over minutes. */
const RIDE_KMH = 22;
const STREET_FACTOR = 1.3;
const HANDOVER_MIN = 3;

/** Local «6:12» of an instant. */
function localHm(at: Date): string {
  const m = localClock(at, TIMEZONE).minutes;
  return twelveHour(
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
  );
}

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The shop kind of a storefront by its tags; null for anything else. */
export function shopKindOf(front: Pick<StorefrontRecord, 'tags'> | null): ShopKind | null {
  if (!front?.tags.includes(SHOP_TAG)) return null;
  if (front.tags.includes('bakery')) return 'bakery';
  if (front.tags.includes('produce_stall')) return 'produce_stall';
  return null;
}

interface ShopState3 {
  state: ShopState;
  closesAt: string | null;
  resumesAt: string | null;
  opensAt: string | null;
}

/**
 * The shopping side «السوق» (2026-10-11). Stalls and bakeries are grocer orgs whose storefront is tagged
 * `shop`; `shop_items` says how each item sells. A stall's morning post sets the catalog price (with the
 * price history the catalog keeps), its photo and «خلص»; the customer sees how it moved since
 * yesterday. A bakery is open, paused («وقّف شوية», a hand close that reopens by itself) or closed, the
 * same hand close every kitchen has. «صمون كل يوم» is placed by the server each chosen day as an
 * ordinary `grocery_catalog` order, so fees, cash and dispatch are the city's.
 */
@Injectable()
export class ShoppingService implements ShoppingPort {
  private readonly logger = new Logger(ShoppingService.name);
  private readonly photo: PhotoLink;

  constructor(
    @Inject(SHOPPING_REPOSITORY) private readonly repo: ShoppingRepository,
    private readonly items: ShopItemsService,
    private readonly catalog: CatalogService,
    private readonly orgs: OrgsService,
    private readonly identity: IdentityService,
    private readonly orders: OrdersService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Optional() @Inject(STOREFRONT_PHOTOS) photos: PhotoLinks | null = null,
    @Optional() private readonly config: ConfigService | null = null,
  ) {
    this.photo = photoLink(photos);
  }

  // ───────────────────────── setup (seed, ops) ─────────────────────────

  /** Makes a grocer org a stall or bakery: its storefront tagged `shop` + kind. */
  async register(input: {
    orgId: string;
    cityId: string;
    kind: ShopKind;
    cuisineAr: string;
    photoUrl: string | null;
    hours?: StorefrontRecord['hours'];
  }): Promise<void> {
    const org = await this.orgs.get(input.orgId);
    const existing = await this.catalog.storefront(input.orgId);
    const tags = [...new Set([...(existing?.tags ?? []), SHOP_TAG, input.kind])];
    await this.catalog.saveStorefront({
      orgId: input.orgId,
      cityId: input.cityId,
      nameAr: org.name,
      cuisineAr: input.cuisineAr,
      tags,
      minOrderIqd: 0,
      photoUrl: input.photoUrl,
      hours: input.hours ?? existing?.hours ?? [],
    });
  }

  saveItem(item: ShopItemRecord): Promise<ShopItemRecord> {
    return this.items.saveItem(item);
  }

  /** Seeds a day's post as if the stall posted at `at` (demo, tests). */
  async seedPost(posts: readonly Omit<DayPostRecord, 'localDate'>[], at: Date): Promise<void> {
    const localDate = localClock(at, TIMEZONE).date;
    await this.repo.savePosts(posts.map((p) => ({ ...p, localDate })));
  }

  // ───────────────────────── customer ─────────────────────────

  /** A «دوّرلي» photo or voice note upload, before the order exists (the order checks it is his). */
  errandUpload(actor: Actor, input: ErrandUploadInput): Promise<PhotoUploadTicket> {
    return this.blobs.createUpload({
      ownerId: actor.personId,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
  }

  /** The home door: launched or not, open bakeries and stalls priced this morning (no per-shop views). */
  async door(_reader: ShoppingReader, input: ShoppingDoorInput): Promise<ShoppingDoor> {
    const now = this.clock.now();
    const today = localClock(now, TIMEZONE).date;
    let bakeriesOpen = 0;
    let stallsPricedToday = 0;
    for (const s of await this.shopsIn(input.cityId)) {
      if (s.kind === 'bakery') {
        if ((await this.stateOf(s.front, now)).state === 'open') bakeriesOpen++;
      } else if ((await this.repo.postsOn(s.front.orgId, [today])).length > 0) stallsPricedToday++;
    }
    return {
      launched: this.config ? this.config.isLaunched(input.cityId, 'grocery') : false,
      bakeriesOpen,
      stallsPricedToday,
    };
  }

  async front(_reader: ShoppingReader, input: ShoppingFrontInput): Promise<ShoppingFront> {
    const shops = await this.shopsIn(input.cityId);
    const now = this.clock.now();
    const stalls: StallView[] = [];
    const bakeries: BakeryView[] = [];
    for (const s of shops) {
      if (s.kind === 'produce_stall') stalls.push(await this.stallView(s.front, input.near, now));
      else bakeries.push(await this.bakeryView(s.front, input.near, now));
    }
    const rank = (v: { state: ShopState }) =>
      v.state === 'open' ? 0 : v.state === 'paused' ? 1 : 2;
    stalls.sort((a, b) => rank(a) - rank(b) || a.minutes - b.minutes);
    bakeries.sort((a, b) => rank(a) - rank(b) || a.minutes - b.minutes);
    return { bakeriesOpen: bakeries.filter((b) => b.state === 'open').length, stalls, bakeries };
  }

  async stall(_reader: ShoppingReader, input: ShopInput): Promise<StallView> {
    const front = await this.shopFront(input.id, 'produce_stall', input.cityId);
    return this.stallView(front, input.near, this.clock.now());
  }

  async bakery(_reader: ShoppingReader, input: ShopInput): Promise<BakeryView> {
    const front = await this.shopFront(input.id, 'bakery', input.cityId);
    return this.bakeryView(front, input.near, this.clock.now());
  }

  /** «محل بالتطبيق»: storefronts in town whose name matches, open ones first. */
  async appShops(
    _reader: ShoppingReader,
    input: z.output<typeof AppShopsInput>,
  ): Promise<AppShopView[]> {
    const q = input.search.trim();
    const all = await this.catalog.storefronts(input.cityId);
    return all
      .filter((s) => !q || s.nameAr.includes(q) || s.cuisineAr.includes(q))
      .slice(0, 20)
      .map((s) => ({ id: s.orgId, name: s.nameAr, kind: s.cuisineAr }));
  }

  // ───────────────────────── «صمون كل يوم» ─────────────────────────

  async dailyBreadMine(actor: Actor): Promise<DailyBreadView[]> {
    const rows = await this.repo.dailyBreadOf(actor.personId);
    return Promise.all(rows.map((r) => this.breadView(r)));
  }

  async dailyBreadCreate(actor: Actor, input: DailyBreadInput): Promise<DailyBreadView> {
    const front = await this.shopFront(input.bakeryId, 'bakery', input.cityId);
    await this.bakeryItem(front.orgId, input.itemId);
    if ((await this.repo.dailyBreadOf(actor.personId)).length >= SHOPPING_RULES.maxDailyBread)
      throw new DriverError('daily_bread_limit');
    const r = await this.repo.createDailyBread({
      personId: actor.personId,
      cityId: input.cityId,
      orgId: front.orgId,
      itemId: input.itemId,
      packs: input.packs,
      time: input.time,
      days: [...new Set(input.days)].sort(),
      dropoff: input.dropoff,
      courierNote: input.courierNote ?? null,
    });
    return this.breadView(r);
  }

  async dailyBreadUpdate(actor: Actor, input: DailyBreadPatch): Promise<DailyBreadView> {
    const r = await this.ownBread(actor, input.id);
    const next = await this.repo.updateDailyBread(r.id, {
      ...(input.paused !== undefined ? { paused: input.paused } : {}),
      ...(input.packs !== undefined ? { packs: input.packs } : {}),
      ...(input.time !== undefined ? { time: input.time } : {}),
      ...(input.days ? { days: [...new Set(input.days)].sort() } : {}),
    });
    return this.breadView(next);
  }

  async dailyBreadDelete(
    actor: Actor,
    input: z.output<typeof DailyBreadRef>,
  ): Promise<{ ok: true }> {
    const r = await this.ownBread(actor, input.id);
    await this.repo.deleteDailyBread(r.id);
    return { ok: true };
  }

  /**
   * Places today's «صمون كل يوم» orders that fall due: each active standing order whose day it is,
   * `dailyBreadLeadMin` before its time, once per day (claimed before placing, so two workers never
   * place it twice). A refused order (bakery closed, service paused) is logged and not retried today.
   */
  async placeDueBread(now: Date = this.clock.now()): Promise<{ placed: number; refused: number }> {
    const { date, dow, minutes } = localClock(now, TIMEZONE);
    let placed = 0;
    let refused = 0;
    for (const time of SHOPPING_RULES.dailyBreadTimes) {
      const [h, m] = time.split(':').map(Number) as [number, number];
      const due = h * 60 + m - SHOPPING_RULES.dailyBreadLeadMin;
      if (minutes < due || minutes >= h * 60 + m) continue;
      for (const r of await this.repo.dailyBreadAt(time)) {
        if (!r.days.includes(dow) || r.lastPlacedOn === date) continue;
        if (!(await this.repo.claimDay(r.id, date))) continue;
        try {
          await this.orders.place(r.personId, {
            cityId: r.cityId,
            type: 'grocery_catalog',
            merchantOrgId: r.orgId,
            lines: [{ catalogItemId: r.itemId, qty: r.packs }],
            dropoff: r.dropoff,
            ...(r.courierNote ? { courierNote: r.courierNote } : {}),
            paymentMethod: 'cash',
            clientRequestId: `bread-${r.id}-${date}`.slice(0, 64),
          });
          placed++;
        } catch (err) {
          refused++;
          this.logger.warn(`daily bread ${r.id} on ${date}: ${(err as Error).message}`);
        }
      }
    }
    return { placed, refused };
  }

  // ───────────────────────── Merchant app: shop mode ─────────────────────────

  async mode(actor: Actor, input: MerchantScope): Promise<ShopModeView> {
    await this.staffAt(actor, input.merchantOrgId);
    return { kind: shopKindOf(await this.catalog.storefront(input.merchantOrgId)) };
  }

  async stallOwner(actor: Actor, input: MerchantScope): Promise<StallOwnerView> {
    await this.staffAt(actor, input.merchantOrgId);
    const front = await this.shopFront(input.merchantOrgId, 'produce_stall');
    return this.ownerStallView(front, this.clock.now());
  }

  /**
   * «أسعار اليوم» (owner only: staff can't change prices, Ali). Each item: today's price, or «نفس
   * البارحة» (yesterday's posted price, else the current one); a new photo of his own; or «خلص» for
   * today. The catalog price moves with it (and keeps its history), so orders are priced from it.
   */
  async postPrices(actor: Actor, input: PostPricesInput): Promise<StallOwnerView> {
    if (!(await this.identity.hasRole(actor.personId, 'merchant_owner', input.merchantOrgId)))
      throw new DriverError('forbidden');
    const front = await this.shopFront(input.merchantOrgId, 'produce_stall');
    const orgId = front.orgId;
    const now = this.clock.now();
    const today = localClock(now, TIMEZONE).date;
    const yesterday = localClock(new Date(now.getTime() - DAY_MS), TIMEZONE).date;
    const shopItems = new Map((await this.items.itemsOf(orgId)).map((i) => [i.itemId, i]));
    const before = new Map((await this.repo.postsOn(orgId, [yesterday])).map((p) => [p.itemId, p]));
    for (const i of input.items) {
      if (!shopItems.has(i.itemId)) throw new DriverError('menu_item_not_found');
      if (i.photoUrl && !i.photoUrl.startsWith(UPLOAD_PHOTO_PREFIX))
        throw new DriverError('invalid_input');
      // Today's photo is the owner's own finished upload, like a menu photo.
      if (i.photoUrl) {
        const blob = await this.blobs.get(i.photoUrl.slice(UPLOAD_PHOTO_PREFIX.length));
        if (!blob || blob.ownerId !== actor.personId || blob.state !== 'stored')
          throw new DriverError('upload_invalid');
      }
    }
    await this.uow.run(async (tx) => {
      const posts: DayPostRecord[] = [];
      for (const i of input.items) {
        const item = await this.catalog.adminItem(orgId, i.itemId, tx);
        const priceIqd = i.priceIqd ?? before.get(i.itemId)?.priceIqd ?? item.priceIqd;
        await this.catalog.updatePrice(orgId, i.itemId, priceIqd, actor.personId, tx);
        if (i.photoUrl)
          await this.catalog.replacePhoto(orgId, i.itemId, i.photoUrl, tx, null, true);
        if (!i.available) await this.catalog.soldOutToday(orgId, i.itemId, tx);
        else if (!item.available || item.soldOutUntil)
          await this.catalog.setAvailability(orgId, i.itemId, true, tx);
        posts.push({
          orgId,
          itemId: i.itemId,
          localDate: today,
          priceIqd,
          photoUrl: i.photoUrl ?? null,
          fromYesterday: i.priceIqd === undefined,
          available: i.available,
          postedAt: now,
        });
      }
      await this.repo.savePosts(posts, tx);
    });
    return this.ownerStallView(front, now);
  }

  async bakeryOwner(actor: Actor, input: MerchantScope): Promise<BakeryOwnerView> {
    await this.staffAt(actor, input.merchantOrgId);
    const front = await this.shopFront(input.merchantOrgId, 'bakery');
    return this.ownerBakeryView(front, this.clock.now());
  }

  /**
   * The baker's three buttons: «مفتوح» clears the hand close, «وقّف شوية» closes it for 15/30/60
   * minutes (reopens by itself), «سدّ» closes it until he opens again.
   */
  async setBakeryState(actor: Actor, input: SetBakeryStateInput): Promise<BakeryOwnerView> {
    await this.staffAt(actor, input.merchantOrgId);
    const front = await this.shopFront(input.merchantOrgId, 'bakery');
    const now = this.clock.now();
    if (input.state === 'paused' && !input.pauseMin) throw new DriverError('invalid_input');
    const closed =
      input.state === 'open'
        ? null
        : input.state === 'paused'
          ? {
              reason: 'bakery_paused',
              note: null,
              at: now,
              until: new Date(now.getTime() + input.pauseMin! * 60_000),
            }
          : { reason: 'bakery_closed', note: null, at: now, until: null };
    await this.orgs.setMerchantSettings(front.orgId, { closed });
    return this.ownerBakeryView(front, now);
  }

  // ───────────────────────── views ─────────────────────────

  private async shopsIn(cityId: string): Promise<{ kind: ShopKind; front: StorefrontRecord }[]> {
    const fronts = await this.catalog.storefronts(cityId);
    return fronts.flatMap((front) => {
      const kind = shopKindOf(front);
      return kind ? [{ kind, front }] : [];
    });
  }

  private async shopFront(
    orgId: string,
    kind: ShopKind,
    cityId?: string,
  ): Promise<StorefrontRecord> {
    const front = await this.catalog.storefront(orgId);
    if (!front || shopKindOf(front) !== kind || (cityId && front.cityId !== cityId))
      throw new DriverError(kind === 'bakery' ? 'bakery_not_found' : 'stall_not_found');
    return front;
  }

  /** Open / paused / closed from the hand close and the weekly hours, with the times to show. */
  private async stateOf(
    front: StorefrontRecord,
    now: Date,
  ): Promise<ShopState3 & { location: DeliveryPoint | null; prepMin: number | null }> {
    const org = await this.orgs.find(front.orgId);
    const s = org?.merchant ?? null;
    const location = s?.location ?? null;
    const prepMin = s?.defaultPrepMin ?? front.prepMin;
    const closed = closedNow(s?.closed ?? null, now);
    if (closed?.until)
      return {
        state: 'paused',
        closesAt: null,
        resumesAt: localHm(closed.until),
        opensAt: null,
        location,
        prepMin,
      };
    const window = front.hours.length > 0 ? activeWindow(now, front.hours, TIMEZONE) : null;
    if (closed || (front.hours.length > 0 && !window)) {
      return {
        state: 'closed',
        closesAt: null,
        resumesAt: null,
        opensAt: front.hours.length > 0 ? nextOpening(now, front.hours, TIMEZONE) : null,
        location,
        prepMin,
      };
    }
    return {
      state: 'open',
      closesAt: window ? twelveHour(window.end) : null,
      resumesAt: null,
      opensAt: null,
      location,
      prepMin,
    };
  }

  /** Prep plus a town ride from the shop to `near` (the centre when absent), rounded up to 5. */
  private minutesTo(
    location: DeliveryPoint | null,
    near: DeliveryPoint | undefined,
    prepMin: number | null,
  ): number {
    const from = location ? pinOf(location) : null;
    const centre = AZIZIYAH_ZONES[0]!;
    const to = (near ? pinOf(near) : null) ?? { lat: centre.lat, lng: centre.lng };
    const ride = from ? (kmBetween(from, to) * STREET_FACTOR * 60) / RIDE_KMH + HANDOVER_MIN : 15;
    return Math.max(5, Math.ceil(((prepMin ?? 5) + ride) / 5) * 5);
  }

  private areaOf(location: DeliveryPoint | null): string {
    const z = location ? AZIZIYAH_ZONES.find((x) => x.id === location.zoneKey) : null;
    return z?.name_ar ?? '';
  }

  private async produce(
    orgId: string,
    now: Date,
  ): Promise<{
    items: ProduceItemView[];
    postedAt: Date | null;
    rows: Array<{
      item: CatalogItemRecord;
      today: DayPostRecord | undefined;
      yesterday: DayPostRecord | undefined;
      photo: string | null;
    }>;
  }> {
    const today = localClock(now, TIMEZONE).date;
    const yesterday = localClock(new Date(now.getTime() - DAY_MS), TIMEZONE).date;
    const [shopItems, menu, posts, lastPhotos] = await Promise.all([
      this.items.itemsOf(orgId),
      this.catalog.adminMenu(orgId),
      this.repo.postsOn(orgId, [today, yesterday]),
      this.repo.lastPhotos(orgId),
    ]);
    const byId = new Map(menu.map((i) => [i.id, i]));
    const todayPosts = new Map(
      posts.filter((p) => p.localDate === today).map((p) => [p.itemId, p]),
    );
    const yPosts = new Map(
      posts.filter((p) => p.localDate === yesterday).map((p) => [p.itemId, p]),
    );
    const rows: Array<{
      item: CatalogItemRecord;
      today: DayPostRecord | undefined;
      yesterday: DayPostRecord | undefined;
      photo: string | null;
    }> = [];
    const items: ProduceItemView[] = [];
    for (const s of shopItems) {
      const item = byId.get(s.itemId);
      if (!item || (s.soldBy !== 'kg' && s.soldBy !== 'piece')) continue;
      const t = todayPosts.get(s.itemId);
      const y = yPosts.get(s.itemId);
      const stored = t?.photoUrl ?? lastPhotos.get(s.itemId) ?? item.photoUrl;
      const photo = stored ? this.photo(stored) : null;
      rows.push({ item, today: t, yesterday: y, photo });
      const soldOut =
        item.soldOutUntil !== null &&
        item.soldOutUntil !== undefined &&
        item.soldOutUntil.getTime() > now.getTime();
      items.push({
        id: item.id,
        name: item.nameAr,
        photo,
        photoToday: Boolean(t?.photoUrl),
        soldBy: s.soldBy,
        priceIqd: item.priceIqd,
        yesterdayIqd: y?.priceIqd ?? null,
        priceFromYesterday: t?.fromYesterday ?? false,
        piecesPerKg: s.piecesMin && s.piecesMax ? [s.piecesMin, s.piecesMax] : null,
        piecesWord: s.piecesWord,
        available: item.available && !soldOut && (t?.available ?? true),
      });
    }
    const order = new Map(menu.map((i, n) => [i.id, n]));
    items.sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
    const firstPost = [...todayPosts.values()].reduce<Date | null>(
      (a, p) => (!a || p.postedAt < a ? p.postedAt : a),
      null,
    );
    return { items, postedAt: firstPost, rows };
  }

  private async stallView(
    front: StorefrontRecord,
    near: DeliveryPoint | undefined,
    now: Date,
  ): Promise<StallView> {
    const st = await this.stateOf(front, now);
    const { items, postedAt } = await this.produce(front.orgId, now);
    return {
      id: front.orgId,
      name: front.nameAr,
      area: this.areaOf(st.location),
      rating: front.ratingPlaceholder?.avg ?? null,
      minutes: this.minutesTo(st.location, near, st.prepMin),
      postedAt: postedAt ? localHm(postedAt) : null,
      photo: front.photoUrl ? this.photo(front.photoUrl) : null,
      state: st.state,
      items,
    };
  }

  private async bakeryView(
    front: StorefrontRecord,
    near: DeliveryPoint | undefined,
    now: Date,
  ): Promise<BakeryView> {
    const st = await this.stateOf(front, now);
    const [shopItems, menu] = await Promise.all([
      this.items.itemsOf(front.orgId),
      this.catalog.adminMenu(front.orgId),
    ]);
    const lots = new Map(
      shopItems.filter((s) => s.soldBy === 'lot').map((s) => [s.itemId, s.perLot ?? 1]),
    );
    return {
      id: front.orgId,
      name: front.nameAr,
      street: [front.cuisineAr, this.areaOf(st.location)].filter(Boolean).join('، '),
      state: st.state,
      closesAt: st.closesAt,
      resumesAt: st.resumesAt,
      opensAt: st.opensAt,
      minutes: this.minutesTo(st.location, near, st.prepMin),
      photo: front.photoUrl ? this.photo(front.photoUrl) : null,
      items: menu
        .filter((i) => lots.has(i.id))
        .map((i) => ({
          id: i.id,
          name: i.nameAr,
          per: lots.get(i.id)!,
          priceIqd: i.priceIqd,
          available: i.available && !(i.soldOutUntil && i.soldOutUntil.getTime() > now.getTime()),
        })),
    };
  }

  private async ownerStallView(front: StorefrontRecord, now: Date): Promise<StallOwnerView> {
    const { rows, postedAt } = await this.produce(front.orgId, now);
    const shopItems = new Map((await this.items.itemsOf(front.orgId)).map((s) => [s.itemId, s]));
    return {
      orgId: front.orgId,
      name: front.nameAr,
      postedAt: postedAt ? localHm(postedAt) : null,
      rows: rows.map((r) => ({
        itemId: r.item.id,
        name: r.item.nameAr,
        soldBy: shopItems.get(r.item.id)!.soldBy === 'piece' ? 'piece' : 'kg',
        priceIqd: r.item.priceIqd,
        yesterdayIqd: r.yesterday?.priceIqd ?? null,
        photo: r.photo,
        photoToday: Boolean(r.today?.photoUrl),
        postedToday: r.today !== undefined,
        available: r.today?.available ?? r.item.available,
      })),
    };
  }

  private async ownerBakeryView(front: StorefrontRecord, now: Date): Promise<BakeryOwnerView> {
    const st = await this.stateOf(front, now);
    const { dow } = localClock(now, TIMEZONE);
    const [standing, shopItems] = await Promise.all([
      this.repo.dailyBreadOfOrg(front.orgId),
      this.items.itemsOf(front.orgId),
    ]);
    const per = new Map(shopItems.map((s) => [s.itemId, s.perLot ?? 1]));
    const dailyToday = SHOPPING_RULES.dailyBreadTimes.map((time: DailyBreadTime) => ({
      time,
      pieces: standing
        .filter((r) => r.time === time && !r.paused && r.days.includes(dow))
        .reduce((a, r) => a + r.packs * (per.get(r.itemId) ?? 1), 0),
    }));
    return {
      orgId: front.orgId,
      name: front.nameAr,
      state: st.state,
      resumesAt: st.resumesAt,
      closesAt: st.closesAt,
      dailyToday,
    };
  }

  private async bakeryItem(
    orgId: string,
    itemId: string,
  ): Promise<{ item: CatalogItemRecord; perLot: number }> {
    const [s] = await this.items.itemsByIds(orgId, [itemId]);
    if (!s || s.soldBy !== 'lot') throw new DriverError('menu_item_not_found');
    const [item] = await this.catalog.itemsOf(orgId, [itemId]);
    if (!item) throw new DriverError('menu_item_not_found');
    return { item, perLot: s.perLot ?? 1 };
  }

  private async breadView(r: DailyBreadRecord): Promise<DailyBreadView> {
    const [front, { item, perLot }] = await Promise.all([
      this.catalog.storefront(r.orgId),
      this.bakeryItem(r.orgId, r.itemId),
    ]);
    return {
      id: r.id,
      bakeryId: r.orgId,
      bakeryName: front?.nameAr ?? '',
      itemId: r.itemId,
      itemName: item.nameAr,
      packs: r.packs,
      pieces: r.packs * perLot,
      time: r.time,
      days: r.days,
      paused: r.paused,
      breadIqd: r.packs * item.priceIqd,
      nextOn: r.paused ? null : this.nextDay(r, this.clock.now()),
    };
  }

  /** The next local date the bread comes: today when its time is still ahead and not yet placed. */
  private nextDay(r: DailyBreadRecord, now: Date): string | null {
    const [h, m] = r.time.split(':').map(Number) as [number, number];
    for (let k = 0; k < 8; k++) {
      const at = new Date(now.getTime() + k * DAY_MS);
      const { date, dow, minutes } = localClock(at, TIMEZONE);
      if (!r.days.includes(dow)) continue;
      if (k === 0 && (minutes >= h * 60 + m || r.lastPlacedOn === date)) continue;
      return date;
    }
    return null;
  }

  private async ownBread(actor: Actor, id: string): Promise<DailyBreadRecord> {
    const r = await this.repo.dailyBread(id);
    if (!r || r.personId !== actor.personId) throw new DriverError('daily_bread_not_found');
    return r;
  }

  private async staffAt(actor: Actor, orgId: string): Promise<void> {
    if (await this.identity.hasRole(actor.personId, 'merchant_owner', orgId)) return;
    if (await this.identity.hasRole(actor.personId, 'merchant_staff', orgId)) return;
    throw new DriverError('forbidden');
  }
}
