/**
 * Pure seed data and helpers (no database): tested without Postgres, consumed by seed.ts.
 * Zones come from @driver/contracts so the API config and the database never disagree.
 */
import { AZIZIYAH_ZONES, type AziziyahZoneSeed } from '@driver/contracts';

export { AZIZIYAH_ZONES };

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

/** Draft polygon: a hexagon of `radiusM` around the centroid, as WKT (lng lat order). */
export function hexagonWkt(z: Pick<AziziyahZoneSeed, 'lat' | 'lng' | 'radiusM'>): string {
  const pts: string[] = [];
  const dLat = z.radiusM / 111_320;
  const dLng = z.radiusM / (111_320 * Math.cos((z.lat * Math.PI) / 180));
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push(`${(z.lng + dLng * Math.cos(a)).toFixed(6)} ${(z.lat + dLat * Math.sin(a)).toFixed(6)}`);
  }
  pts.push(pts[0]!);
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
