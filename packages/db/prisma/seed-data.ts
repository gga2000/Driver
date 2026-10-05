/**
 * Pure seed data and helpers (no database): tested without Postgres, consumed by seed.ts.
 * Zones come from @driver/contracts so the API config and the database never disagree.
 */
import { AZIZIYAH_ZONES, draftRing, type AziziyahZoneSeed } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS, type SeedRestaurant } from '@driver/contracts/seeds';

export { AZIZIYAH_ZONES };
/** The four launch restaurants with their menus (M3); shared with the API's in-memory twin. */
export { AZIZIYAH_RESTAURANTS, type SeedRestaurant };

/** The `catalogs.storefront` JSON of a seeded restaurant (read by the API's catalog repository). */
export function storefrontJson(r: SeedRestaurant): Record<string, unknown> {
  return { cuisineAr: r.cuisineAr, tags: r.tags, photoUrl: null, minOrderIqd: r.minOrderIqd, prepMin: r.prepMin, hours: r.hours, ratingPlaceholder: r.ratingPlaceholder };
}

export interface SeedCity {
  id: string;
  nameAr: string;
  nameEn: string;
  active: boolean;
}

export const CITIES: SeedCity[] = [
  { id: 'aziziyah', nameAr: 'العزيزية', nameEn: 'Aziziyah', active: true },
  { id: 'kut', nameAr: 'الكوت', nameEn: 'Kut', active: false },
  { id: 'baghdad', nameAr: 'بغداد', nameEn: 'Baghdad', active: false },
];

/** Draft polygon: the AI hexagon (`draftRing`, shared with the API's demo store) as WKT (lng lat order). */
export function hexagonWkt(z: Pick<AziziyahZoneSeed, 'lat' | 'lng' | 'radiusM'>): string {
  const ring = draftRing(z);
  const pts = [...ring, ring[0]!].map((p) => `${p.lng.toFixed(6)} ${p.lat.toFixed(6)}`);
  return `POLYGON((${pts.join(', ')}))`;
}

export function pointWkt(p: { lat: number; lng: number }): string {
  return `POINT(${p.lng.toFixed(6)} ${p.lat.toFixed(6)})`;
}

export interface SeedMeetingPoint {
  key: string;
  cityId: string;
  zoneKey?: string;
  nameAr: string;
  nameEn: string;
  lat: number;
  lng: number;
  garage: boolean;
  reachableBy: Array<'bike' | 'tuktuk' | 'car' | 'suv' | 'van' | 'intercity'>;
}

/** 4 intercity garages (150 m late-meter geofence) + 6 neighbourhood street-pickup points. */
export const MEETING_POINTS: SeedMeetingPoint[] = [
  // garages
  { key: 'garage_bab1', cityId: 'aziziyah', zoneKey: 'centre', nameAr: 'كراج البوابة ١', nameEn: 'Gate 1 garage', lat: 32.9032, lng: 45.0578, garage: true, reachableBy: ['car', 'suv', 'van', 'intercity'] },
  { key: 'garage_bab2', cityId: 'aziziyah', zoneKey: 'street_30', nameAr: 'كراج البوابة ٢', nameEn: 'Gate 2 garage', lat: 32.9088, lng: 45.0648, garage: true, reachableBy: ['car', 'suv', 'van', 'intercity'] },
  { key: 'garage_souq', cityId: 'aziziyah', zoneKey: 'centre', nameAr: 'كراج السوق', nameEn: 'Souq garage', lat: 32.9062, lng: 45.0612, garage: true, reachableBy: ['car', 'suv', 'van', 'intercity'] },
  { key: 'garage_nahdha', cityId: 'baghdad', nameAr: 'كراج النهضة', nameEn: 'Al-Nahdha garage', lat: 33.3344, lng: 44.4165, garage: true, reachableBy: ['car', 'suv', 'van', 'intercity'] },
  // street-pickup meeting points
  { key: 'mp_jami_kabir', cityId: 'aziziyah', zoneKey: 'centre', nameAr: 'باب الجامع الكبير', nameEn: 'Grand Mosque gate', lat: 32.9045, lng: 45.0595, garage: false, reachableBy: ['bike', 'tuktuk', 'car'] },
  { key: 'mp_hadiqat_shasha', cityId: 'aziziyah', zoneKey: 'mahdood_1', nameAr: 'حديقة الشاشة', nameEn: 'Al-Shasha park', lat: 32.9122, lng: 45.0552, garage: false, reachableBy: ['bike', 'tuktuk', 'car'] },
  { key: 'mp_kuliyat_tarbiya', cityId: 'aziziyah', zoneKey: 'saadouniya', nameAr: 'باب كلية التربية الأساسية', nameEn: 'College of Basic Education gate', lat: 32.9012, lng: 45.0478, garage: false, reachableBy: ['bike', 'tuktuk', 'car'] },
  { key: 'mp_shari_30', cityId: 'aziziyah', zoneKey: 'street_30', nameAr: 'تقاطع شارع ٣٠', nameEn: 'Street 30 junction', lat: 32.9098, lng: 45.0628, garage: false, reachableBy: ['bike', 'tuktuk', 'car'] },
  { key: 'mp_hawas_bridge', cityId: 'aziziyah', zoneKey: 'hawas_bridge', nameAr: 'رأس جسر حواس', nameEn: 'Hawas bridge head', lat: 32.9172, lng: 45.0378, garage: false, reachableBy: ['tuktuk', 'car'] },
  { key: 'mp_khamas_bridge', cityId: 'aziziyah', zoneKey: 'khamas_bridge', nameAr: 'رأس جسر خماس', nameEn: 'Khamas bridge head', lat: 32.9382, lng: 45.0812, garage: false, reachableBy: ['tuktuk', 'car'] },
];

/**
 * الرجعة drafts (routes module): a Kut garage for the secondary corridor and three on-the-way meeting
 * points along the Aziziyah ⇄ Baghdad road. DRAFT — plausible names and pins until field ops verify
 * them on the ground; the API's intercity config carries the same ids (`mp_<key>`) with `draft: true`.
 */
export const INTERCITY_DRAFT_POINTS: SeedMeetingPoint[] = [
  { key: 'garage_kut', cityId: 'kut', nameAr: 'كراج الكوت (مسودة)', nameEn: 'Kut garage (draft)', lat: 32.5126, lng: 45.8189, garage: true, reachableBy: ['car', 'suv', 'van', 'intercity'] },
  { key: 'ic_aziziyah_north_exit', cityId: 'aziziyah', nameAr: 'مدخل العزيزية الشمالي (مسودة)', nameEn: 'Aziziyah north entrance (draft)', lat: 32.9455, lng: 45.0296, garage: false, reachableBy: ['car', 'suv', 'van', 'intercity'] },
  { key: 'ic_madain_junction', cityId: 'baghdad', nameAr: 'مفرق المدائن (مسودة)', nameEn: 'Al-Mada’in junction (draft)', lat: 33.0985, lng: 44.5802, garage: false, reachableBy: ['car', 'suv', 'van', 'intercity'] },
  { key: 'ic_diyala_bridge', cityId: 'baghdad', nameAr: 'جسر ديالى (مسودة)', nameEn: 'Diyala bridge (draft)', lat: 33.2348, lng: 44.5231, garage: false, reachableBy: ['car', 'suv', 'van', 'intercity'] },
];

export interface SeedTaxonomyNode {
  slug: string;
  nameAr: string;
  nameEn: string;
  parent?: string;
}

export const TAXONOMY: SeedTaxonomyNode[] = [
  { slug: 'food', nameAr: 'أكل', nameEn: 'Food' },
  { slug: 'grill', nameAr: 'مشاوي', nameEn: 'Grill', parent: 'food' },
  { slug: 'fast_food', nameAr: 'وجبات سريعة', nameEn: 'Fast food', parent: 'food' },
  { slug: 'rice_dishes', nameAr: 'تمن ومرق', nameEn: 'Rice & stew', parent: 'food' },
  { slug: 'bread_pastry', nameAr: 'خبز ومعجنات', nameEn: 'Bread & pastry', parent: 'food' },
  { slug: 'sweets', nameAr: 'حلويات', nameEn: 'Sweets', parent: 'food' },
  { slug: 'drinks', nameAr: 'مشروبات', nameEn: 'Drinks' },
  { slug: 'juice', nameAr: 'عصائر', nameEn: 'Juice', parent: 'drinks' },
  { slug: 'soft_drinks', nameAr: 'مشروبات غازية', nameEn: 'Soft drinks', parent: 'drinks' },
  { slug: 'grocery', nameAr: 'بقالة', nameEn: 'Grocery' },
  { slug: 'produce', nameAr: 'خضرة وفواكه', nameEn: 'Produce', parent: 'grocery' },
  { slug: 'dairy', nameAr: 'ألبان', nameEn: 'Dairy', parent: 'grocery' },
  { slug: 'household', nameAr: 'منظفات ومستلزمات', nameEn: 'Household', parent: 'grocery' },
  { slug: 'pharmacy', nameAr: 'صيدلية', nameEn: 'Pharmacy' },
];

export interface SeedItem {
  nameAr: string;
  nameEn: string;
  priceIqd: number;
  taxonomy: string;
  prepTimeMin: number;
  modifierGroups?: Array<{ nameAr: string; nameEn: string; required: boolean; max: number; options: Array<{ nameAr: string; nameEn: string; priceIqd: number }> }>;
}

export const DEMO_RESTAURANT = {
  name: 'مطعم عبدالله',
  cityId: 'aziziyah',
  zoneKey: 'centre',
  catalogNameAr: 'القائمة الرئيسية',
  items: [
    { nameAr: 'كص عراقي', nameEn: 'Iraqi gus (shawarma)', priceIqd: 4000, taxonomy: 'fast_food', prepTimeMin: 10,
      modifierGroups: [{ nameAr: 'الخبز', nameEn: 'Bread', required: true, max: 1, options: [{ nameAr: 'صمون', nameEn: 'Samoon', priceIqd: 0 }, { nameAr: 'خبز رقاق', nameEn: 'Flatbread', priceIqd: 0 }] }] },
    { nameAr: 'تكة لحم', nameEn: 'Lamb tikka', priceIqd: 12000, taxonomy: 'grill', prepTimeMin: 25 },
    { nameAr: 'كباب عراقي', nameEn: 'Iraqi kebab', priceIqd: 10000, taxonomy: 'grill', prepTimeMin: 20,
      modifierGroups: [{ nameAr: 'الكمية', nameEn: 'Portion', required: true, max: 1, options: [{ nameAr: 'نص كيلو', nameEn: 'Half kilo', priceIqd: 0 }, { nameAr: 'كيلو', nameEn: 'One kilo', priceIqd: 9000 }] }] },
    { nameAr: 'دجاج مشوي', nameEn: 'Grilled chicken', priceIqd: 9000, taxonomy: 'grill', prepTimeMin: 30 },
    { nameAr: 'تمن وقيمة', nameEn: 'Rice with qeema', priceIqd: 6000, taxonomy: 'rice_dishes', prepTimeMin: 10 },
    { nameAr: 'تمن وفاصوليا', nameEn: 'Rice with white beans', priceIqd: 5000, taxonomy: 'rice_dishes', prepTimeMin: 10 },
    { nameAr: 'فلافل', nameEn: 'Falafel sandwich', priceIqd: 1500, taxonomy: 'fast_food', prepTimeMin: 5,
      modifierGroups: [{ nameAr: 'إضافات', nameEn: 'Extras', required: false, max: 3, options: [{ nameAr: 'عمبة', nameEn: 'Amba', priceIqd: 0 }, { nameAr: 'بيض', nameEn: 'Egg', priceIqd: 500 }, { nameAr: 'جبن', nameEn: 'Cheese', priceIqd: 500 }] }] },
    { nameAr: 'كبة برغل', nameEn: 'Bulgur kubba', priceIqd: 1000, taxonomy: 'bread_pastry', prepTimeMin: 5 },
    { nameAr: 'عصير برتقال', nameEn: 'Orange juice', priceIqd: 2000, taxonomy: 'juice', prepTimeMin: 3 },
    { nameAr: 'بيبسي', nameEn: 'Pepsi', priceIqd: 750, taxonomy: 'soft_drinks', prepTimeMin: 1 },
  ] satisfies SeedItem[],
};

/** Dispatcher demo person — pseudonymous row; phone goes to the vault. */
export const DISPATCHER = {
  phoneE164: '+9647700000001',
  name: 'موزّع تجريبي',
  locale: 'ar-IQ',
};

/**
 * `SEED_PROFILE=production` (scripts/deploy/supabase-setup.mjs): reference data and the launch
 * restaurants only — no demo restaurant, and no demo dispatcher, whose made-up number would hand the
 * Console to whoever really owns it. The first admin comes from `SEED_ADMIN_PHONE` (any Iraqi mobile
 * form), hashed with the production PHONE_HASH_PEPPER so the API recognises it at sign-in.
 */
export interface SeedOptions {
  profile: 'dev' | 'production';
  admin?: { phoneE164: string; name: string };
}

/** 07xx…, 7xx…, 9647…, +9647… → +9647xxxxxxxxx (the API's normalizeIraqiPhone rule, Western digits). */
export function iraqiE164(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  const national = digits.startsWith('00964') ? digits.slice(5) : digits.startsWith('964') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  if (!/^7\d{9}$/.test(national)) throw new Error(`not an Iraqi mobile number: ${raw}`);
  return `+964${national}`;
}

export function seedOptionsFromEnv(env: Record<string, string | undefined>): SeedOptions {
  const phone = env['SEED_ADMIN_PHONE']?.trim();
  return {
    profile: env['SEED_PROFILE'] === 'production' ? 'production' : 'dev',
    ...(phone ? { admin: { phoneE164: iraqiE164(phone), name: env['SEED_ADMIN_NAME']?.trim() || 'المدير' } } : {}),
  };
}
