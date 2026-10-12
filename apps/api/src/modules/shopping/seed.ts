import type { ShopKind, SoldBy } from '@driver/contracts';
import type { CatalogService } from '../catalog/index.js';
import type { OrgsService } from '../orgs/index.js';
import type { ShoppingService } from './shopping.service.js';

const media = (name: string): string => `/media/food/${name}`;

interface DemoShopItem {
  key: string;
  nameAr: string;
  soldBy: SoldBy;
  /** Today's price: per kilo, per piece or per lot. */
  priceIqd: number;
  /** Yesterday's posted price; null = no post yesterday. */
  yesterdayIqd?: number | null;
  /** Today's post kept yesterday's price («نفس البارحة»). */
  fromYesterday?: boolean;
  /** Today's post has no new photo (yesterday's shows). */
  oldPhoto?: boolean;
  photo?: string;
  pieces?: [number, number];
  piecesWord?: string;
  perLot?: number;
}

export interface DemoMarketShop {
  key: string;
  nameAr: string;
  kind: ShopKind;
  cuisineAr: string;
  zoneKey: string;
  pin: { lat: number; lng: number };
  photo: string;
  rating: number;
  prepMin: number;
  /** Local hh:mm of this morning's post (stalls). */
  postedAt?: string;
  /** Bakeries: paused for this many minutes from now. */
  pausedMin?: number;
  /** Bakeries that bake round the clock (no hours on file). */
  allDay?: boolean;
  items: DemoShopItem[];
}

/** Aziziyah's demo stalls and bakeries: the same numbers as the concept boards Ali approved (round 2). */
export const DEMO_MARKET_SHOPS: readonly DemoMarketShop[] = [
  {
    key: 'abu-haider',
    nameAr: 'بسطية أبو حيدر',
    kind: 'produce_stall',
    cuisineAr: 'خضرة وفواكه',
    zoneKey: 'centre',
    pin: { lat: 32.9041, lng: 45.0612 },
    photo: media('shop-produce-stall-1.webp'),
    rating: 4.8,
    prepMin: 5,
    postedAt: '06:12',
    items: [
      {
        key: 'tomato',
        nameAr: 'طماطة',
        soldBy: 'kg',
        priceIqd: 1000,
        yesterdayIqd: 1250,
        photo: 'shop-tomato-1.webp',
        pieces: [6, 7],
        piecesWord: 'طماطات',
      },
      {
        key: 'cucumber',
        nameAr: 'خيار',
        soldBy: 'kg',
        priceIqd: 750,
        yesterdayIqd: 750,
        photo: 'shop-cucumber-1.webp',
        pieces: [8, 10],
        piecesWord: 'خيارات',
      },
      {
        key: 'okra',
        nameAr: 'باميا',
        soldBy: 'kg',
        priceIqd: 3000,
        yesterdayIqd: 2500,
        photo: 'shop-okra-1.webp',
      },
      {
        key: 'eggplant',
        nameAr: 'بيتنجان',
        soldBy: 'kg',
        priceIqd: 1000,
        yesterdayIqd: 1000,
        photo: 'shop-eggplant-1.webp',
        pieces: [3, 4],
        piecesWord: 'بيتنجانات',
      },
      {
        key: 'orange',
        nameAr: 'برتقال',
        soldBy: 'kg',
        priceIqd: 1500,
        yesterdayIqd: 1500,
        photo: 'shop-orange-1.webp',
        oldPhoto: true,
        pieces: [5, 6],
        piecesWord: 'برتقالات',
      },
      {
        key: 'pomegranate',
        nameAr: 'رمان',
        soldBy: 'kg',
        priceIqd: 2000,
        yesterdayIqd: 2000,
        photo: 'shop-pomegranate-1.webp',
        pieces: [2, 3],
        piecesWord: 'رمانات',
      },
      {
        key: 'watermelon',
        nameAr: 'رقي',
        soldBy: 'piece',
        priceIqd: 3500,
        yesterdayIqd: 3500,
        fromYesterday: true,
        photo: 'shop-watermelon-1.webp',
      },
    ],
  },
  {
    key: 'haj-jabbar',
    nameAr: 'خضرة الحاج جبار',
    kind: 'produce_stall',
    cuisineAr: 'خضرة وفواكه',
    zoneKey: 'fidaa',
    pin: { lat: 32.9131, lng: 45.0664 },
    photo: media('shop-produce-stall-1.webp'),
    rating: 4.6,
    prepMin: 6,
    postedAt: '06:40',
    items: [
      {
        key: 'tomato',
        nameAr: 'طماطة',
        soldBy: 'kg',
        priceIqd: 1250,
        yesterdayIqd: 1250,
        photo: 'shop-tomato-1.webp',
        pieces: [6, 7],
        piecesWord: 'طماطات',
      },
      {
        key: 'eggplant',
        nameAr: 'بيتنجان',
        soldBy: 'kg',
        priceIqd: 750,
        yesterdayIqd: 1000,
        photo: 'shop-eggplant-1.webp',
        pieces: [3, 4],
        piecesWord: 'بيتنجانات',
      },
      {
        key: 'orange',
        nameAr: 'برتقال',
        soldBy: 'kg',
        priceIqd: 1500,
        yesterdayIqd: 1250,
        photo: 'shop-orange-1.webp',
        pieces: [5, 6],
        piecesWord: 'برتقالات',
      },
      {
        key: 'pomegranate',
        nameAr: 'رمان',
        soldBy: 'kg',
        priceIqd: 2000,
        yesterdayIqd: null,
        photo: 'shop-pomegranate-1.webp',
        pieces: [2, 3],
        piecesWord: 'رمانات',
      },
    ],
  },
  {
    key: 'haj-kadhim',
    nameAr: 'فرن الحاج كاظم',
    kind: 'bakery',
    cuisineAr: 'صمون حجري',
    zoneKey: 'street_30',
    pin: { lat: 32.9092, lng: 45.0641 },
    photo: media('shop-samoon-oven-1.webp'),
    rating: 4.9,
    prepMin: 5,
    allDay: true,
    items: [
      { key: 'hajri', nameAr: 'صمون حجري', soldBy: 'lot', priceIqd: 1000, perLot: 4 },
      { key: 'small', nameAr: 'صمون صغار', soldBy: 'lot', priceIqd: 1000, perLot: 8 },
      { key: 'kaak', nameAr: 'كعك بالسمسم', soldBy: 'lot', priceIqd: 1000, perLot: 10 },
    ],
  },
  {
    key: 'abu-ali',
    nameAr: 'فرن أبو علي',
    kind: 'bakery',
    cuisineAr: 'خبز تنور وصمون',
    zoneKey: 'nakheel_street',
    pin: { lat: 32.9015, lng: 45.0561 },
    photo: media('shop-samoon-oven-1.webp'),
    rating: 4.7,
    prepMin: 5,
    pausedMin: 30,
    items: [
      { key: 'hajri', nameAr: 'صمون حجري', soldBy: 'lot', priceIqd: 1000, perLot: 4 },
      { key: 'tannour', nameAr: 'خبز تنور', soldBy: 'lot', priceIqd: 1000, perLot: 3 },
    ],
  },
];

/** Bakeries bake all day (Ali): the demo ones are open 4:30 till 23:00 every day, but one bakes round the clock. */
const BAKERY_HOURS = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: '04:30', end: '23:00' }));

/** An instant on `now`'s Baghdad day (UTC+3) at local `hh:mm`, or the day before. */
function localAt(now: Date, hhmm: string, daysBack = 0): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const local = new Date(now.getTime() + 3 * 3_600_000);
  local.setUTCHours(h, m, 0, 0);
  return new Date(local.getTime() - 3 * 3_600_000 - daysBack * 86_400_000);
}

/** The in-memory twin of the shopping seed: each shop's org, storefront, items and this morning's post. */
export async function seedDemoShops(
  orgs: Pick<OrgsService, 'create' | 'setMerchantSettings'>,
  catalog: Pick<CatalogService, 'addItem'>,
  shopping: Pick<ShoppingService, 'register' | 'saveItem' | 'seedPost'>,
  /** `morning`: the stalls have not posted today yet (yesterday's prices stand), for the Merchant app's «أسعار اليوم». */
  opts: { cityId?: string; ownerId?: string; now?: Date; morning?: boolean } = {},
): Promise<{ key: string; orgId: string; kind: ShopKind }[]> {
  const cityId = opts.cityId ?? 'aziziyah';
  const now = opts.now ?? new Date();
  const out: { key: string; orgId: string; kind: ShopKind }[] = [];
  for (const d of DEMO_MARKET_SHOPS) {
    const org = await orgs.create({
      type: 'grocer',
      name: d.nameAr,
      cityId,
      ownerId: opts.ownerId ?? 'seed-shop-owner',
    });
    await orgs.setMerchantSettings(org.id, {
      defaultPrepMin: d.prepMin,
      location: { zoneKey: d.zoneKey, pin: d.pin },
      ...(d.pausedMin
        ? {
            closed: {
              reason: 'bakery_paused',
              note: null,
              at: now,
              until: new Date(now.getTime() + d.pausedMin * 60_000),
            },
          }
        : {}),
    });
    await shopping.register({
      orgId: org.id,
      cityId,
      kind: d.kind,
      cuisineAr: d.cuisineAr,
      photoUrl: d.photo,
      ...(d.kind === 'bakery' ? { hours: d.allDay ? [] : BAKERY_HOURS } : {}),
    });
    let sortOrder = 0;
    const today: Parameters<ShoppingService['seedPost']>[0][number][] = [];
    const yesterday: typeof today = [];
    for (const it of d.items) {
      const id = `${org.id}_${it.key}`;
      const photo = it.photo ? media(it.photo) : null;
      await catalog.addItem({
        id,
        orgId: org.id,
        nameAr: it.nameAr,
        priceIqd: opts.morning && d.kind === 'produce_stall' ? (it.yesterdayIqd ?? it.priceIqd) : it.priceIqd,
        photoUrl: photo,
        prepTimeMin: d.prepMin,
        sortOrder: sortOrder++,
        pointsEligible: true,
      });
      await shopping.saveItem({
        itemId: id,
        orgId: org.id,
        soldBy: it.soldBy,
        piecesMin: it.pieces?.[0] ?? null,
        piecesMax: it.pieces?.[1] ?? null,
        piecesWord: it.piecesWord ?? null,
        perLot: it.perLot ?? null,
      });
      if (d.kind !== 'produce_stall') continue;
      const postedAt = localAt(now, d.postedAt ?? '06:00');
      today.push({
        orgId: org.id,
        itemId: id,
        priceIqd: it.priceIqd,
        photoUrl: it.oldPhoto ? null : photo,
        fromYesterday: it.fromYesterday ?? false,
        available: true,
        postedAt,
      });
      if (it.yesterdayIqd !== null && it.yesterdayIqd !== undefined) {
        yesterday.push({
          orgId: org.id,
          itemId: id,
          priceIqd: it.yesterdayIqd,
          photoUrl: photo,
          fromYesterday: false,
          available: true,
          postedAt: localAt(now, d.postedAt ?? '06:00', 1),
        });
      }
    }
    if (yesterday.length) await shopping.seedPost(yesterday, new Date(now.getTime() - 86_400_000));
    if (today.length && !opts.morning) await shopping.seedPost(today, now);
    out.push({ key: d.key, orgId: org.id, kind: d.kind });
  }
  return out;
}
