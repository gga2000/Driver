import type { LatLng } from '@driver/contracts';
import type { CatalogService } from '../catalog/index.js';
import type { OrgsService } from '../orgs/index.js';

/**
 * The store reviewers' hidden test kitchen (launch plan W5, BENCH-04, decision D-4): one restaurant
 * that only the store-reviewer account sees and orders from. It is a real org (`orgs.is_test`) with a
 * real menu, so the reviewer goes through the real basket, checkout and tracking; its orders are
 * walked to the door by the test crew (`StoreReviewRunner`), never by a real kitchen or courier.
 */
export const TEST_KITCHEN = {
  cityId: 'aziziyah',
  /** The name says what it is, in Arabic and English, so a reviewer (and anyone in the Console) knows. */
  nameAr: 'مطبخ التجربة · Test Kitchen',
  cuisineAr: 'للمراجعة فقط · For app review only',
  zoneKey: 'centre',
  pin: { lat: 32.9046, lng: 45.0612 } satisfies LatLng,
  prepMin: 10,
  minOrderIqd: 0,
  items: [
    {
      key: 'chicken_sandwich',
      nameAr: 'سندويچ دجاج',
      nameEn: 'Chicken sandwich',
      description: 'طلب تجريبي، ما يوصل لمطعم حقيقي',
      priceIqd: 3000,
    },
    {
      key: 'falafel_plate',
      nameAr: 'صحن فلافل',
      nameEn: 'Falafel plate',
      description: 'طلب تجريبي، ما يوصل لمطعم حقيقي',
      priceIqd: 2500,
    },
    { key: 'laban', nameAr: 'لبن', nameEn: 'Laban', description: null, priceIqd: 500 },
  ],
} as const;

/**
 * Makes sure the test kitchen's org exists, owned by the crew, always open (no prayer pause, no
 * hours) and auto-accepting. Returns its org id. Run under the kitchen lock (one machine at a time).
 */
export async function ensureTestKitchenOrg(
  orgs: Pick<OrgsService, 'inCity' | 'create' | 'setMerchantSettings'>,
  crewId: string,
): Promise<string> {
  const k = TEST_KITCHEN;
  const existing = (await orgs.inCity(k.cityId, 'restaurant')).find((o) => o.isTest);
  const org =
    existing ??
    (await orgs.create({
      type: 'restaurant',
      name: k.nameAr,
      cityId: k.cityId,
      ownerId: crewId,
      isTest: true,
    }));
  await orgs.setMerchantSettings(org.id, {
    autoAccept: true,
    pauseWindows: [],
    location: { zoneKey: k.zoneKey, pin: k.pin },
    defaultPrepMin: k.prepMin,
    commissionTier: 'base',
  });
  return org.id;
}

/**
 * Its storefront and menu, part by part, so a boot that died half-way finishes the job next time.
 * Dishes have fixed ids (`<org>_<key>`), so they are never added twice.
 */
export async function ensureTestKitchenMenu(
  catalog: Pick<CatalogService, 'storefront' | 'saveStorefront' | 'menu' | 'addItem'>,
  orgId: string,
): Promise<void> {
  const k = TEST_KITCHEN;
  if (!(await catalog.storefront(orgId))) {
    await catalog.saveStorefront({
      orgId,
      cityId: k.cityId,
      nameAr: k.nameAr,
      cuisineAr: k.cuisineAr,
      tags: [],
      minOrderIqd: k.minOrderIqd,
      prepMin: k.prepMin,
      hours: [],
      isTest: true,
    });
  }
  const have = new Set((await catalog.menu(orgId)).map((m) => m.id));
  let sortOrder = 0;
  for (const item of k.items) {
    const id = `${orgId}_${item.key}`;
    if (!have.has(id))
      await catalog.addItem({
        id,
        orgId,
        nameAr: item.nameAr,
        nameEn: item.nameEn,
        description: item.description,
        priceIqd: item.priceIqd,
        prepTimeMin: k.prepMin,
        categoryAr: 'الأكل',
        sortOrder,
      });
    sortOrder += 1;
  }
}
