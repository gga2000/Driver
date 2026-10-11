import type { ReserveRule } from '../home-kitchens.js';
import type { SeedHours, SeedMenuItem, SeedRestaurant } from './aziziyah-restaurants.js';

/**
 * DEMO ONLY: four أكل بيت home kitchens, so the home-cooking screens have kitchens, ready plates and
 * reservations behind them in the studio and the screenshots. Seeded by the customer demo API alone
 * (`apps/customer/scripts/demo-api.mjs`), never by `pnpm db:seed`: no cook has signed up yet. The
 * kitchen names are kitchen names, never a woman's real name; prices are realistic 2026 Aziziyah
 * prices in IQD.
 */

/** A home dish: ready today (`cooked` plates, `left` still free) or cooked only when booked. */
export type SeedHomeSale = { mode: 'ready'; cooked: number; left: number } | { mode: 'reserve'; rule: ReserveRule };

export interface SeedHomeItem extends SeedMenuItem {
  /** «شنو بالصحن؟», e.g. «5 حبات». */
  portion?: string;
  home: SeedHomeSale;
}

export interface SeedHomeKitchen extends SeedRestaurant {
  /** Marks the storefront a home kitchen; `monogram` null = the name's first letter. */
  home: { monogram: string | null };
  categories: Array<{ nameAr: string; nameEn: string; items: SeedHomeItem[] }>;
}

function days(start: string, end: string, dows: number[] = [0, 1, 2, 3, 4, 5, 6]): SeedHours[] {
  return dows.map((dow) => ({ dow, start, end }));
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export const DEMO_HOME_KITCHENS: readonly SeedHomeKitchen[] = [
  {
    key: 'um_hussein',
    orgId: 'org_aziziyah_um_hussein',
    nameAr: 'مطبخ أم حسين',
    nameEn: "Um Hussein's kitchen",
    cuisineAr: 'دولمة · كبة · قوزي',
    tags: ['home'],
    cityId: 'aziziyah',
    zoneKey: 'centre',
    pin: { lat: 32.9088, lng: 45.0611 },
    minOrderIqd: 0,
    prepMin: 15,
    hours: days('10:00', '21:00'),
    ratingPlaceholder: { avg: 4.9, count: 212 },
    home: { monogram: null },
    categories: [
      {
        nameAr: 'أكل بيت',
        nameEn: 'Home dishes',
        items: [
          { key: 'dolma', nameAr: 'دولمة عراقية', nameEn: 'Iraqi dolma', descriptionAr: 'ورق عنب وبصل وشجر، ويا ضلع غنم', priceIqd: 6000, prepTimeMin: 10, taxonomy: 'dolma', servesMin: 1, servesMax: 1, home: { mode: 'ready', cooked: 12, left: 4 } },
          { key: 'kubba', nameAr: 'كبة حلب', nameEn: 'Kubba Halab', descriptionAr: 'تمن ولحم مفروم، مقلية بنفس اليوم', priceIqd: 5000, prepTimeMin: 10, taxonomy: 'kubba', portion: '5 حبات', home: { mode: 'ready', cooked: 10, left: 6 } },
          { key: 'quzi', nameAr: 'قوزي على تمن', nameEn: 'Quzi on rice', descriptionAr: 'لحم غنم على تمن بالكرزات والزبيب', priceIqd: 12000, prepTimeMin: 10, taxonomy: 'rice', servesMin: 2, servesMax: 2, labels: ['family'], home: { mode: 'reserve', rule: { aheadMin: 1440, days: [0, 3, 5], times: ['13:00', '19:00'], maxPerSlot: 6 } } },
          { key: 'biryani', nameAr: 'برياني دجاج', nameEn: 'Chicken biryani', descriptionAr: 'دجاج كامل وتمن بالبهارات ويا شعرية', priceIqd: 8000, prepTimeMin: 10, taxonomy: 'biryani', servesMin: 3, servesMax: 4, home: { mode: 'reserve', rule: { aheadMin: 240, days: EVERY_DAY, times: ['13:00', '19:00'], maxPerSlot: 8 } } },
        ],
      },
    ],
  },
  {
    key: 'abu_zainab',
    orgId: 'org_aziziyah_abu_zainab',
    nameAr: 'مطبخ بيت أبو زينب',
    nameEn: "Abu Zainab's home kitchen",
    cuisineAr: 'بامية · برياني · شوربة',
    tags: ['home'],
    cityId: 'aziziyah',
    zoneKey: 'street_30',
    pin: { lat: 32.9122, lng: 45.0655 },
    minOrderIqd: 0,
    prepMin: 15,
    hours: days('11:00', '22:00'),
    ratingPlaceholder: { avg: 4.8, count: 96 },
    home: { monogram: 'ز' },
    categories: [
      {
        nameAr: 'أكل بيت',
        nameEn: 'Home dishes',
        items: [
          { key: 'bamia', nameAr: 'بامية ويا تمن', nameEn: 'Okra stew with rice', descriptionAr: 'بامية بلحم غنم ومعجون، وتمن بالشعرية', priceIqd: 5000, prepTimeMin: 10, taxonomy: 'stew', servesMin: 1, servesMax: 1, home: { mode: 'ready', cooked: 15, left: 9 } },
          { key: 'lentil_soup', nameAr: 'شوربة عدس', nameEn: 'Lentil soup', descriptionAr: 'عدس أحمر بالكمون، ويا خبز وليمون', priceIqd: 2000, prepTimeMin: 5, taxonomy: 'soup', portion: 'طاسة كبيرة', home: { mode: 'ready', cooked: 10, left: 0 } },
          { key: 'meat_biryani', nameAr: 'برياني لحم', nameEn: 'Lamb biryani', descriptionAr: 'لحم غنم وتمن بسمتي، ويا لوز وزبيب', priceIqd: 10000, prepTimeMin: 10, taxonomy: 'biryani', servesMin: 2, servesMax: 3, home: { mode: 'reserve', rule: { aheadMin: 1440, days: EVERY_DAY, times: ['13:00'], maxPerSlot: 5 } } },
        ],
      },
    ],
  },
  {
    key: 'um_ali',
    orgId: 'org_aziziyah_um_ali',
    nameAr: 'مطبخ أم علي',
    nameEn: "Um Ali's kitchen",
    cuisineAr: 'پاچة · تشريب',
    tags: ['home'],
    cityId: 'aziziyah',
    zoneKey: 'nakheel_street',
    pin: { lat: 32.9051, lng: 45.0702 },
    minOrderIqd: 0,
    prepMin: 20,
    hours: days('06:00', '20:00'),
    ratingPlaceholder: { avg: 4.7, count: 58 },
    home: { monogram: null },
    categories: [
      {
        nameAr: 'أكل بيت',
        nameEn: 'Home dishes',
        items: [
          { key: 'pacha', nameAr: 'پاچة', nameEn: 'Pacha', descriptionAr: 'راس وكراعين ومعلاگ، ويا خبز مشرّب', priceIqd: 7000, prepTimeMin: 10, taxonomy: 'pacha', servesMin: 1, servesMax: 1, home: { mode: 'reserve', rule: { aheadMin: 1440, days: [5], times: ['07:00'], maxPerSlot: 10 } } },
          { key: 'tashreeb', nameAr: 'تشريب دجاج', nameEn: 'Chicken tashreeb', descriptionAr: 'خبز مشرّب بمرگة دجاج وحمص ولومي', priceIqd: 5000, prepTimeMin: 10, taxonomy: 'tashreeb', servesMin: 1, servesMax: 1, home: { mode: 'reserve', rule: { aheadMin: 240, days: EVERY_DAY, times: ['13:00'], maxPerSlot: 6 } } },
        ],
      },
    ],
  },
  {
    key: 'khala_suad',
    orgId: 'org_aziziyah_khala_suad',
    nameAr: 'حلويات خالة سعاد',
    nameEn: "Auntie Suad's sweets",
    cuisineAr: 'كليچة · زلابية',
    tags: ['home'],
    cityId: 'aziziyah',
    zoneKey: 'area_150',
    pin: { lat: 32.9019, lng: 45.0583 },
    minOrderIqd: 0,
    prepMin: 10,
    hours: days('09:00', '22:00'),
    ratingPlaceholder: { avg: 4.9, count: 140 },
    home: { monogram: 'س' },
    categories: [
      {
        nameAr: 'حلو البيت',
        nameEn: 'Home sweets',
        items: [
          { key: 'zalabia', nameAr: 'زلابية', nameEn: 'Zalabia', descriptionAr: 'مقرمشة بالقطر، من صبح اليوم', priceIqd: 3000, prepTimeMin: 5, taxonomy: 'sweets', portion: 'نص كيلو', home: { mode: 'ready', cooked: 30, left: 22 } },
          { key: 'kleicha', nameAr: 'كليچة بالتمر', nameEn: 'Date kleicha', descriptionAr: 'عجينة بالهيل وحشوة تمر، مخبوزة بالبيت', priceIqd: 8000, prepTimeMin: 5, taxonomy: 'sweets', portion: 'كيلو', home: { mode: 'reserve', rule: { aheadMin: 2880, days: [4], times: ['17:00'], maxPerSlot: 20 } } },
        ],
      },
    ],
  },
];
