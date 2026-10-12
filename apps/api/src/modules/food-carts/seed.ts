import type { CartKind } from '@driver/contracts';
import type { CatalogService, NewCatalogItem } from '../catalog/index.js';
import type { OrgsService } from '../orgs/index.js';
import type { FoodCartsService } from './food-carts.service.js';

export interface DemoCart {
  key: string;
  nameAr: string;
  kind: CartKind;
  usual: { from: string; to: string } | null;
  /** Open tonight here; null = closed (shown at its last spot when it has one). */
  open: { lat: number; lng: number; label: string; facing: number } | null;
  last?: { lat: number; lng: number; label: string; facing: number };
  awayNote?: string;
  prepMin: number;
  /** `groups`: sizes (required, pick one) and extras (pick any), as the owner writes them. */
  dishes: { key: string; nameAr: string; nameEn: string; priceIqd: number; groups?: NonNullable<NewCatalogItem['modifierGroups']> }[];
}

/**
 * Aziziyah's carts for the demo API and local runs: three open tonight around the souq garage and
 * Street 30, two closed until their usual hour, one away for the season. Prices are street prices.
 */
export const DEMO_CARTS: readonly DemoCart[] = [
  {
    key: 'liver',
    nameAr: 'كبدة أبو حيدر',
    kind: 'liver',
    usual: { from: '18:00', to: '00:30' },
    open: { lat: 32.90235, lng: 45.06585, label: 'جنب كراج السوق', facing: 200 },
    prepMin: 6,
    dishes: [
      {
        key: 'laffa',
        nameAr: 'لفة كبدة',
        nameEn: 'Liver wrap',
        priceIqd: 2000,
        groups: [{ nameAr: 'إضافات', minSelect: 0, maxSelect: 2, required: false, modifiers: [{ nameAr: 'بيض', priceIqd: 500 }, { nameAr: 'حار', priceIqd: 0 }] }],
      },
      { key: 'maalak', nameAr: 'لفة معلاك', nameEn: 'Mixed offal wrap', priceIqd: 2000 },
      {
        key: 'plate',
        nameAr: 'صحن كبدة',
        nameEn: 'Liver plate',
        priceIqd: 3000,
        groups: [{ nameAr: 'الحجم', minSelect: 1, maxSelect: 1, required: true, modifiers: [{ nameAr: 'نص صحن', priceIqd: 0 }, { nameAr: 'صحن كامل', priceIqd: 2000 }] }],
      },
      { key: 'samoon', nameAr: 'صمونة كبدة', nameEn: 'Liver samoon', priceIqd: 1500 },
    ],
  },
  {
    key: 'falafel',
    nameAr: 'فلافل الحجي',
    kind: 'falafel',
    usual: { from: '16:00', to: '23:00' },
    open: { lat: 32.90905, lng: 45.06305, label: 'راس شارع 30', facing: 90 },
    prepMin: 4,
    dishes: [
      { key: 'laffa', nameAr: 'لفة فلافل', nameEn: 'Falafel wrap', priceIqd: 1000 },
      { key: 'samoon', nameAr: 'صمونة فلافل', nameEn: 'Falafel samoon', priceIqd: 750 },
      { key: 'amba', nameAr: 'لفة فلافل بالعمبة', nameEn: 'Falafel wrap with amba', priceIqd: 1250 },
    ],
  },
  {
    key: 'tea',
    nameAr: 'چاي أبو علي',
    kind: 'tea',
    usual: { from: '17:00', to: '01:00' },
    open: { lat: 32.90515, lng: 45.06045, label: 'ساحة المركز', facing: 0 },
    prepMin: 2,
    dishes: [
      { key: 'chai', nameAr: 'استكان چاي', nameEn: 'Glass of tea', priceIqd: 250 },
      { key: 'noomi', nameAr: 'چاي نومي بصرة', nameEn: 'Dried lime tea', priceIqd: 500 },
      { key: 'darcheen', nameAr: 'چاي دارسين', nameEn: 'Cinnamon tea', priceIqd: 500 },
    ],
  },
  {
    key: 'corn',
    nameAr: 'عرانيس أبو سجاد',
    kind: 'corn',
    usual: { from: '19:00', to: '23:30' },
    open: null,
    last: { lat: 32.9012, lng: 45.0555, label: 'شارع نخيل', facing: 270 },
    prepMin: 4,
    dishes: [
      { key: 'grilled', nameAr: 'عرنوص مشوي', nameEn: 'Grilled corn', priceIqd: 1000 },
      { key: 'cup', nameAr: 'كاسة ذرة', nameEn: 'Corn cup', priceIqd: 1500 },
    ],
  },
  {
    key: 'bagilla',
    nameAr: 'باگلة أبو كرار',
    kind: 'bagilla',
    usual: { from: '05:30', to: '10:00' },
    open: null,
    last: { lat: 32.9072, lng: 45.0712, label: 'منطقة 150', facing: 180 },
    prepMin: 3,
    dishes: [
      { key: 'dihin', nameAr: 'باگلة بالدهن', nameEn: 'Broad beans in ghee', priceIqd: 2000 },
      { key: 'egg', nameAr: 'باگلة بالدهن ويه بيض', nameEn: 'Broad beans with egg', priceIqd: 2500 },
    ],
  },
  {
    key: 'zbeeb',
    nameAr: 'شربت زبيب أبو مصطفى',
    kind: 'cart',
    usual: null,
    open: null,
    awayNote: 'ترجع برمضان',
    prepMin: 2,
    dishes: [{ key: 'glass', nameAr: 'كاسة شربت زبيب', nameEn: 'Raisin drink', priceIqd: 500 }],
  },
];

/** The in-memory twin of the carts seed: each cart's org, menu and `food_carts` row; open ones opened now. */
export async function seedDemoCarts(
  orgs: Pick<OrgsService, 'create' | 'setMerchantSettings'>,
  catalog: Pick<CatalogService, 'addItem'>,
  carts: Pick<FoodCartsService, 'register' | 'placeAt' | 'openAt'>,
  opts: { cityId?: string; ownerId?: string } = {},
): Promise<{ key: string; orgId: string; cartId: string }[]> {
  const cityId = opts.cityId ?? 'aziziyah';
  const out: { key: string; orgId: string; cartId: string }[] = [];
  for (const d of DEMO_CARTS) {
    const org = await orgs.create({ type: 'restaurant', name: d.nameAr, cityId, ownerId: opts.ownerId ?? 'seed-cart-owner' });
    await orgs.setMerchantSettings(org.id, { defaultPrepMin: d.prepMin, commissionTier: 'base', closed: { reason: 'cart_closed', note: null, at: new Date() } });
    let sortOrder = 0;
    for (const dish of d.dishes) {
      await catalog.addItem({ id: `${org.id}_${dish.key}`, orgId: org.id, nameAr: dish.nameAr, nameEn: dish.nameEn, description: null, priceIqd: dish.priceIqd, prepTimeMin: d.prepMin, categoryAr: null, sortOrder: sortOrder++, ...(dish.groups ? { modifierGroups: dish.groups } : {}) });
    }
    const cart = await carts.register({ orgId: org.id, cityId, kind: d.kind, usual: d.usual, awayNote: d.awayNote ?? null });
    if (d.last) await carts.placeAt(cart.id, d.last);
    if (d.open) await carts.openAt(cart, d.open, null, opts.ownerId ?? 'seed-cart-owner');
    out.push({ key: d.key, orgId: org.id, cartId: cart.id });
  }
  return out;
}
