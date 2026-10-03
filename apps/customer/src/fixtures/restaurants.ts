/**
 * FIXTURES — not API data.
 *
 * The API exposes merchants only to the Console (`merchants.list`, console roles) and has no
 * customer catalog read yet, so the home rails read these four real Aziziyah restaurants.
 * Everything here is isolated behind `fetchFixtureRestaurants()` (used by
 * `src/features/home/queries.ts`); when a customer `catalog.*` read lands, replace that queryFn and
 * delete this file. Fees, ratings and times are illustrative.
 */

export interface RestaurantSummary {
  id: string;
  name: string;
  /** Short cuisine line under the name. */
  cuisine: string;
  zoneId: string;
  rating: number;
  ratingCount: number;
  prepMinMinutes: number;
  prepMaxMinutes: number;
  deliveryFeeIqd: number;
  minOrderIqd: number;
  open: boolean;
  /** 12-hour clock when closed ("4:00"). */
  opensAt?: string;
  favourite: boolean;
  /** Deal line for the "عروض اليوم" rail. */
  deal?: string;
}

export const FIXTURE_RESTAURANTS: readonly RestaurantSummary[] = [
  {
    id: 'fx-khalid',
    name: 'مطعم خالد',
    cuisine: 'كص · تكة · لفات',
    zoneId: 'street_30',
    rating: 4.7,
    ratingCount: 312,
    prepMinMinutes: 20,
    prepMaxMinutes: 30,
    deliveryFeeIqd: 1000,
    minOrderIqd: 5000,
    open: true,
    favourite: true,
    deal: 'لفة كص الثانية بنص السعر',
  },
  {
    id: 'fx-haj-kareem',
    name: 'مشويات الحاج كريم',
    cuisine: 'مشويات · كباب · معلاك',
    zoneId: 'centre',
    rating: 4.8,
    ratingCount: 527,
    prepMinMinutes: 25,
    prepMaxMinutes: 35,
    deliveryFeeIqd: 500,
    minOrderIqd: 7000,
    open: true,
    favourite: true,
  },
  {
    id: 'fx-sham',
    name: 'مأكولات الشام',
    cuisine: 'شاورما · فلافل · مناقيش',
    zoneId: 'nakheel_street',
    rating: 4.5,
    ratingCount: 198,
    prepMinMinutes: 15,
    prepMaxMinutes: 25,
    deliveryFeeIqd: 0,
    minOrderIqd: 4000,
    open: true,
    favourite: false,
    deal: 'توصيل مجاني لحد الساعة 6',
  },
  {
    id: 'fx-musafir',
    name: 'مطعم المسافر',
    cuisine: 'قوزي · تمن ومرق · باچة',
    zoneId: 'area_150',
    rating: 4.6,
    ratingCount: 241,
    prepMinMinutes: 30,
    prepMaxMinutes: 45,
    deliveryFeeIqd: 1000,
    minOrderIqd: 8000,
    open: false,
    opensAt: '7:00',
    favourite: false,
  },
];

/** Community deal card (sample until promotions have a customer read). */
export const FIXTURE_COMMUNITY_DEAL = {
  restaurantId: 'fx-haj-kareem',
  body: 'اطلبوا سوية من مشويات الحاج كريم قبل الساعة 9 والتوصيل علينا لكل زاكور',
} as const;

/** Simulates the network so loading skeletons and error states are exercised in development. */
export async function fetchFixtureRestaurants(delayMs = 350): Promise<RestaurantSummary[]> {
  await new Promise((r) => setTimeout(r, delayMs));
  return FIXTURE_RESTAURANTS.map((r) => ({ ...r }));
}
