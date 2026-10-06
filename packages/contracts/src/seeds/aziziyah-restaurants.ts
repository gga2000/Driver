/**
 * Launch menus for the four Aziziyah restaurants (M3 food ordering). One source for the database
 * seed (`pnpm db:seed`), the API's in-memory twin (`seedStorefronts`, demo API, tests) and nothing
 * else: the apps read menus through `catalog.*`, never from here.
 *
 * Names are what people in Wasit say; prices are realistic 2026 Aziziyah prices in IQD (multiples
 * of 250). Ratings are PLACEHOLDERS until order ratings are aggregated; photos are null until the
 * merchants upload them (the app draws an illustrated placeholder).
 *
 * Ids are stable: org `org_aziziyah_<key>`, item `<orgId>_<itemKey>`, group `<itemId>_mg_<n>`,
 * modifier `<groupId>_m_<n>` (1-based), so the database and the in-memory twin agree.
 */

export interface SeedModifierGroup {
  nameAr: string;
  nameEn: string;
  required: boolean;
  /** Defaults to 1 when required, else 0. */
  min?: number;
  max: number;
  /** `servesMin`/`servesMax`: how many this version feeds (joy o3 «يشبّع»), when the kitchen says. */
  options: Array<{ nameAr: string; nameEn: string; priceIqd: number; servesMin?: number; servesMax?: number }>;
}

export interface SeedMenuItem {
  key: string;
  nameAr: string;
  nameEn: string;
  descriptionAr?: string;
  priceIqd: number;
  prepTimeMin: number;
  /** Shared taxonomy slug (`TAXONOMY` in the db seed). */
  taxonomy: string;
  modifierGroups?: SeedModifierGroup[];
  /** How many the dish feeds as it comes (joy o3), when the kitchen says. */
  servesMin?: number;
  servesMax?: number;
  /** The kitchen's labels (joy o8). */
  labels?: Array<'spicy' | 'new' | 'family'>;
}

export interface SeedMenuCategory {
  nameAr: string;
  nameEn: string;
  items: SeedMenuItem[];
}

/** Local opening window: "HH:MM"; `end` before `start` wraps past midnight. */
export interface SeedHours {
  dow: number;
  start: string;
  end: string;
}

export interface SeedRestaurant {
  key: string;
  orgId: string;
  nameAr: string;
  nameEn: string;
  /** Short cuisine line under the name on cards. */
  cuisineAr: string;
  /** Slugs used to suggest similar kitchens (rejection fallback) and search. */
  tags: string[];
  cityId: string;
  zoneKey: string;
  pin: { lat: number; lng: number };
  minOrderIqd: number;
  /** Typical kitchen prep in minutes (card ETA before the menu is read). */
  prepMin: number;
  hours: SeedHours[];
  /** PLACEHOLDER until ratings are aggregated from orders. */
  ratingPlaceholder: { avg: number; count: number };
  categories: SeedMenuCategory[];
}

/** The same window every day of the week. */
function daily(start: string, end: string): SeedHours[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start, end }));
}

const bread = (tannourIqd = 0): SeedModifierGroup => ({
  nameAr: 'الخبز',
  nameEn: 'Bread',
  required: true,
  max: 1,
  options: [
    { nameAr: 'صمون حجري', nameEn: 'Stone-baked samoon', priceIqd: 0 },
    { nameAr: 'خبز تنور', nameEn: 'Tannour bread', priceIqd: tannourIqd },
  ],
});

const grillExtras: SeedModifierGroup = {
  nameAr: 'إضافات',
  nameEn: 'Extras',
  required: false,
  max: 3,
  options: [
    { nameAr: 'عمبة', nameEn: 'Amba', priceIqd: 0 },
    { nameAr: 'طرشي', nameEn: 'Pickles', priceIqd: 0 },
    { nameAr: 'طماطة مشوية', nameEn: 'Grilled tomato', priceIqd: 250 },
    { nameAr: 'جبن', nameEn: 'Cheese', priceIqd: 500 },
  ],
};

const servings = (pairIqd: number): SeedModifierGroup => ({
  nameAr: 'الحجم',
  nameEn: 'Size',
  required: true,
  max: 1,
  options: [
    { nameAr: 'نفر', nameEn: 'One person', priceIqd: 0, servesMin: 1, servesMax: 1 },
    { nameAr: 'نفرين', nameEn: 'Two people', priceIqd: pairIqd, servesMin: 2, servesMax: 2 },
  ],
});

const byWeight = (kiloExtraIqd: number): SeedModifierGroup => ({
  nameAr: 'الكمية',
  nameEn: 'Amount',
  required: true,
  max: 1,
  options: [
    { nameAr: 'نص كيلو', nameEn: 'Half kilo', priceIqd: 0, servesMin: 2, servesMax: 3 },
    { nameAr: 'كيلو', nameEn: 'One kilo', priceIqd: kiloExtraIqd, servesMin: 4, servesMax: 5 },
  ],
});

const shawarmaBread: SeedModifierGroup = {
  nameAr: 'الخبز',
  nameEn: 'Bread',
  required: true,
  max: 1,
  options: [
    { nameAr: 'صمون', nameEn: 'Samoon', priceIqd: 0 },
    { nameAr: 'خبز عربي', nameEn: 'Pita', priceIqd: 0 },
    { nameAr: 'صاج', nameEn: 'Saj', priceIqd: 250 },
  ],
};

const shawarmaExtras: SeedModifierGroup = {
  nameAr: 'إضافات',
  nameEn: 'Extras',
  required: false,
  max: 3,
  options: [
    { nameAr: 'ثومية زيادة', nameEn: 'Extra garlic sauce', priceIqd: 0 },
    { nameAr: 'مخلل', nameEn: 'Pickles', priceIqd: 0 },
    { nameAr: 'بطاطا', nameEn: 'Fries inside', priceIqd: 250 },
    { nameAr: 'جبن', nameEn: 'Cheese', priceIqd: 500 },
  ],
};

const drinks = (extra: SeedMenuItem[] = []): SeedMenuCategory => ({
  nameAr: 'مشروبات',
  nameEn: 'Drinks',
  items: [
    ...extra,
    { key: 'pepsi', nameAr: 'بيبسي', nameEn: 'Pepsi', priceIqd: 750, prepTimeMin: 1, taxonomy: 'soft_drinks' },
    { key: 'water', nameAr: 'ماي صحي', nameEn: 'Bottled water', priceIqd: 250, prepTimeMin: 1, taxonomy: 'soft_drinks' },
  ],
});

export const AZIZIYAH_RESTAURANTS: readonly SeedRestaurant[] = [
  {
    key: 'khalid',
    orgId: 'org_aziziyah_khalid',
    nameAr: 'مطعم خالد',
    nameEn: 'Khalid Restaurant',
    cuisineAr: 'كباب · تكة · كبد',
    tags: ['grill', 'kebab', 'tikka', 'liver', 'sandwiches'],
    cityId: 'aziziyah',
    zoneKey: 'street_30',
    pin: { lat: 32.9095, lng: 45.0635 },
    minOrderIqd: 5000,
    prepMin: 20,
    hours: daily('11:00', '00:30'),
    ratingPlaceholder: { avg: 4.7, count: 312 },
    categories: [
      {
        nameAr: 'لفات',
        nameEn: 'Wraps',
        items: [
          { key: 'kebab_wrap', nameAr: 'لفة كباب', nameEn: 'Kebab wrap', descriptionAr: 'شيش كباب غنم على الفحم، بصل بالسماق وطماطة', priceIqd: 2000, prepTimeMin: 10, taxonomy: 'grill', modifierGroups: [bread(), grillExtras] },
          { key: 'tikka_wrap', nameAr: 'لفة تكة', nameEn: 'Tikka wrap', descriptionAr: 'تكة لحم متبّلة، مشوية على الفحم', priceIqd: 2500, prepTimeMin: 12, taxonomy: 'grill', modifierGroups: [bread(), grillExtras] },
          { key: 'liver_wrap', nameAr: 'لفة كبد', nameEn: 'Liver wrap', descriptionAr: 'كبد غنم طازج على الفحم، ويا بصل ونعناع', priceIqd: 1500, prepTimeMin: 8, taxonomy: 'grill', modifierGroups: [bread(), grillExtras] },
          { key: 'chicken_tikka_wrap', nameAr: 'لفة تكة دجاج', nameEn: 'Chicken tikka wrap', descriptionAr: 'صدر دجاج متبّل بالليمون والثوم', priceIqd: 2000, prepTimeMin: 10, taxonomy: 'grill', modifierGroups: [bread(), grillExtras], labels: ['new'] },
        ],
      },
      {
        nameAr: 'وجبات',
        nameEn: 'Plates',
        items: [
          { key: 'kebab_plate', nameAr: 'وجبة كباب', nameEn: 'Kebab plate', descriptionAr: '4 شيش كباب، تمن، شوربة، سلطة وصمون', priceIqd: 7000, prepTimeMin: 20, taxonomy: 'grill', modifierGroups: [servings(6000)] },
          { key: 'tikka_plate', nameAr: 'وجبة تكة', nameEn: 'Tikka plate', descriptionAr: '3 شيش تكة، تمن، شوربة، سلطة وصمون', priceIqd: 8000, prepTimeMin: 22, taxonomy: 'grill', modifierGroups: [servings(7000)] },
          { key: 'liver_plate', nameAr: 'وجبة كبد', nameEn: 'Liver plate', descriptionAr: 'كبد وقلوب على الفحم ويا تمن وسلطة', priceIqd: 5000, prepTimeMin: 15, taxonomy: 'grill' },
          { key: 'kebab_kilo', nameAr: 'كباب بالكيلو', nameEn: 'Kebab by weight', descriptionAr: 'ويا خبز تنور، طماطة وبصل مشوي', priceIqd: 12000, prepTimeMin: 25, taxonomy: 'grill', modifierGroups: [byWeight(11000)], labels: ['family'] },
          { key: 'khalid_mix', nameAr: 'مشكّل خالد', nameEn: 'Khalid mixed grill', descriptionAr: 'كباب، تكة، كبد ودجاج، ويا تمن وخبز لنفرين', priceIqd: 15000, prepTimeMin: 30, taxonomy: 'grill', servesMin: 2, servesMax: 2, labels: ['family'] },
        ],
      },
      {
        nameAr: 'شوربة ومقبلات',
        nameEn: 'Soup & sides',
        items: [
          { key: 'lentil_soup', nameAr: 'شوربة عدس', nameEn: 'Lentil soup', priceIqd: 1000, prepTimeMin: 3, taxonomy: 'rice_dishes' },
          { key: 'salad', nameAr: 'سلطة خضرة', nameEn: 'Garden salad', priceIqd: 1000, prepTimeMin: 5, taxonomy: 'rice_dishes' },
          { key: 'torshi', nameAr: 'طرشي', nameEn: 'Pickles', priceIqd: 500, prepTimeMin: 1, taxonomy: 'rice_dishes' },
        ],
      },
      drinks([{ key: 'shenina', nameAr: 'شنينة', nameEn: 'Shenina (salted yoghurt drink)', priceIqd: 750, prepTimeMin: 1, taxonomy: 'soft_drinks' }]),
    ],
  },
  {
    key: 'haj_kareem',
    orgId: 'org_aziziyah_haj_kareem',
    nameAr: 'مشويات الحاج كريم',
    nameEn: 'Haj Kareem Grills',
    cuisineAr: 'مشويات · دجاج · تمن ومرق',
    tags: ['grill', 'kebab', 'tikka', 'chicken', 'rice'],
    cityId: 'aziziyah',
    zoneKey: 'centre',
    pin: { lat: 32.905, lng: 45.06 },
    minOrderIqd: 7000,
    prepMin: 25,
    hours: daily('12:00', '00:00'),
    ratingPlaceholder: { avg: 4.8, count: 527 },
    categories: [
      {
        nameAr: 'مشويات',
        nameEn: 'Grills',
        items: [
          { key: 'iraqi_kebab', nameAr: 'كباب عراقي', nameEn: 'Iraqi kebab', descriptionAr: 'لحم غنم مفروم بالساطور، ويا خبز تنور وطماطة مشوية', priceIqd: 13000, prepTimeMin: 25, taxonomy: 'grill', modifierGroups: [byWeight(12000)] },
          { key: 'lamb_tikka', nameAr: 'تكة لحم', nameEn: 'Lamb tikka', descriptionAr: 'قطع لحم غنم متبّلة، مشوية على الفحم', priceIqd: 14000, prepTimeMin: 25, taxonomy: 'grill', modifierGroups: [byWeight(13000)] },
          {
            key: 'grilled_chicken',
            nameAr: 'دجاج مشوي',
            nameEn: 'Grilled chicken',
            descriptionAr: 'دجاج بلدي على الفحم ويا ثومية وبطاطا',
            priceIqd: 6000,
            prepTimeMin: 30,
            taxonomy: 'grill',
            modifierGroups: [
              { nameAr: 'الحجم', nameEn: 'Size', required: true, max: 1, options: [{ nameAr: 'نص دجاجة', nameEn: 'Half chicken', priceIqd: 0, servesMin: 1, servesMax: 2 }, { nameAr: 'دجاجة كاملة', nameEn: 'Whole chicken', priceIqd: 5000, servesMin: 3, servesMax: 4 }] },
            ],
          },
          {
            key: 'shish_tawook',
            nameAr: 'شيش طاووق',
            nameEn: 'Shish tawook',
            descriptionAr: 'صدر دجاج بالزبادي والبهارات',
            priceIqd: 7000,
            prepTimeMin: 20,
            taxonomy: 'grill',
            modifierGroups: [
              { nameAr: 'الصوص', nameEn: 'Sauce', required: false, max: 2, options: [{ nameAr: 'ثومية', nameEn: 'Garlic sauce', priceIqd: 0 }, { nameAr: 'حار', nameEn: 'Hot sauce', priceIqd: 0 }] },
            ],
          },
          { key: 'haj_mix', nameAr: 'مشكّل الحاج', nameEn: 'Haj mixed grill', descriptionAr: 'كيلو مشكّل: كباب، تكة، طاووق وكبد، ويا تمن وخبز وسلطات لـ 3–4 أشخاص', priceIqd: 25000, prepTimeMin: 35, taxonomy: 'grill', servesMin: 3, servesMax: 4, labels: ['family'] },
        ],
      },
      {
        nameAr: 'تمن ومرق',
        nameEn: 'Rice & stew',
        items: [
          { key: 'rice_qeema', nameAr: 'تمن وقيمة', nameEn: 'Rice with qeema', descriptionAr: 'قيمة لحم وحمص ويا تمن عنبر', priceIqd: 4000, prepTimeMin: 10, taxonomy: 'rice_dishes' },
          { key: 'rice_fasoulia', nameAr: 'تمن وفاصوليا', nameEn: 'Rice with white beans', descriptionAr: 'مرق فاصوليا بيضاء باللحم', priceIqd: 4000, prepTimeMin: 10, taxonomy: 'rice_dishes' },
          { key: 'rice_bamia', nameAr: 'تمن وبامية', nameEn: 'Rice with okra', descriptionAr: 'مرق بامية بالطماطة ولحم الغنم', priceIqd: 5000, prepTimeMin: 10, taxonomy: 'rice_dishes' },
        ],
      },
      {
        nameAr: 'خبز ومقبلات',
        nameEn: 'Bread & sides',
        items: [
          { key: 'tannour_bread', nameAr: 'خبز تنور (4 أرغفة)', nameEn: 'Tannour bread (4)', priceIqd: 1000, prepTimeMin: 5, taxonomy: 'bread_pastry' },
          { key: 'arabic_salad', nameAr: 'سلطة عربية', nameEn: 'Arabic salad', priceIqd: 1500, prepTimeMin: 5, taxonomy: 'rice_dishes' },
          { key: 'hummus', nameAr: 'حمص', nameEn: 'Hummus', priceIqd: 2000, prepTimeMin: 5, taxonomy: 'rice_dishes' },
          { key: 'jajeek', nameAr: 'جاجيك', nameEn: 'Jajeek', priceIqd: 1500, prepTimeMin: 3, taxonomy: 'rice_dishes' },
        ],
      },
      drinks([
        { key: 'erbil_laban', nameAr: 'لبن أربيل', nameEn: 'Erbil laban', priceIqd: 750, prepTimeMin: 1, taxonomy: 'soft_drinks' },
        { key: 'orange_juice', nameAr: 'عصير برتقال طبيعي', nameEn: 'Fresh orange juice', priceIqd: 2000, prepTimeMin: 4, taxonomy: 'juice' },
      ]),
    ],
  },
  {
    key: 'sham',
    orgId: 'org_aziziyah_sham',
    nameAr: 'مأكولات الشام',
    nameEn: 'Al-Sham Kitchen',
    cuisineAr: 'شاورما · فلافل · مناقيش',
    tags: ['shawarma', 'falafel', 'sandwiches', 'pastry', 'chicken'],
    cityId: 'aziziyah',
    zoneKey: 'nakheel_street',
    pin: { lat: 32.9018, lng: 45.0558 },
    minOrderIqd: 4000,
    prepMin: 15,
    hours: daily('10:00', '02:00'),
    ratingPlaceholder: { avg: 4.5, count: 198 },
    categories: [
      {
        nameAr: 'شاورما',
        nameEn: 'Shawarma',
        items: [
          { key: 'chicken_shawarma', nameAr: 'شاورما دجاج', nameEn: 'Chicken shawarma', descriptionAr: 'دجاج متبّل على السيخ، ثومية ومخلل', priceIqd: 2000, prepTimeMin: 8, taxonomy: 'fast_food', modifierGroups: [shawarmaBread, shawarmaExtras] },
          { key: 'meat_shawarma', nameAr: 'شاورما لحم', nameEn: 'Meat shawarma', descriptionAr: 'لحم عجل ويا طحينة وبصل بالسماق', priceIqd: 2500, prepTimeMin: 8, taxonomy: 'fast_food', modifierGroups: [shawarmaBread, shawarmaExtras] },
          {
            key: 'shawarma_plate',
            nameAr: 'صحن شاورما دجاج',
            nameEn: 'Chicken shawarma plate',
            descriptionAr: 'شاورما، بطاطا، ثومية، مخلل وخبز',
            priceIqd: 6000,
            prepTimeMin: 12,
            taxonomy: 'fast_food',
            modifierGroups: [{ nameAr: 'الحجم', nameEn: 'Size', required: true, max: 1, options: [{ nameAr: 'عادي', nameEn: 'Regular', priceIqd: 0 }, { nameAr: 'دبل', nameEn: 'Double', priceIqd: 3000 }] }],
          },
          { key: 'arabi_shawarma', nameAr: 'عربي شاورما', nameEn: 'Arabi shawarma', descriptionAr: 'شاورما مقطّعة بالصاج ويا ثومية وبطاطا', priceIqd: 5000, prepTimeMin: 10, taxonomy: 'fast_food' },
        ],
      },
      {
        nameAr: 'فلافل',
        nameEn: 'Falafel',
        items: [
          {
            key: 'falafel_wrap',
            nameAr: 'لفة فلافل',
            nameEn: 'Falafel wrap',
            descriptionAr: 'فلافل حارة ويا عمبة وخضرة',
            priceIqd: 1000,
            prepTimeMin: 5,
            taxonomy: 'fast_food',
            modifierGroups: [
              { nameAr: 'إضافات', nameEn: 'Extras', required: false, max: 3, options: [{ nameAr: 'عمبة', nameEn: 'Amba', priceIqd: 0 }, { nameAr: 'بيض', nameEn: 'Egg', priceIqd: 250 }, { nameAr: 'باذنجان مقلي', nameEn: 'Fried eggplant', priceIqd: 250 }] },
            ],
          },
          { key: 'falafel_plate', nameAr: 'صحن فلافل', nameEn: 'Falafel plate', descriptionAr: '8 حبات، حمص، طحينة وخبز', priceIqd: 3000, prepTimeMin: 7, taxonomy: 'fast_food' },
        ],
      },
      {
        nameAr: 'مناقيش ومعجنات',
        nameEn: 'Manakish & pastry',
        items: [
          { key: 'zaatar_manousheh', nameAr: 'منقوشة زعتر', nameEn: "Za'atar manousheh", priceIqd: 1500, prepTimeMin: 8, taxonomy: 'bread_pastry' },
          { key: 'cheese_manousheh', nameAr: 'منقوشة جبن', nameEn: 'Cheese manousheh', priceIqd: 2500, prepTimeMin: 8, taxonomy: 'bread_pastry' },
          { key: 'lahm_bajeen', nameAr: 'لحم بعجين', nameEn: 'Lahm bi ajeen', priceIqd: 2000, prepTimeMin: 10, taxonomy: 'bread_pastry' },
        ],
      },
      drinks([{ key: 'lemon_mint', nameAr: 'ليمون بالنعناع', nameEn: 'Lemon mint', priceIqd: 2000, prepTimeMin: 3, taxonomy: 'juice' }]),
    ],
  },
  {
    key: 'musafir',
    orgId: 'org_aziziyah_musafir',
    nameAr: 'مطعم المسافر',
    nameEn: 'Al-Musafir Restaurant',
    cuisineAr: 'باچة · ريوگ · تمن ومرق',
    tags: ['breakfast', 'pacha', 'rice', 'stew'],
    cityId: 'aziziyah',
    zoneKey: 'area_150',
    pin: { lat: 32.9075, lng: 45.0715 },
    minOrderIqd: 8000,
    prepMin: 30,
    hours: daily('05:00', '15:00'),
    ratingPlaceholder: { avg: 4.6, count: 241 },
    categories: [
      {
        nameAr: 'ريوگ',
        nameEn: 'Breakfast',
        items: [
          { key: 'kahi_geymar', nameAr: 'كاهي وقيمر', nameEn: 'Kahi with geymar', descriptionAr: 'كاهي حار بالشيرة ويا قيمر عرب', priceIqd: 3000, prepTimeMin: 10, taxonomy: 'bread_pastry' },
          { key: 'eggs_tomato', nameAr: 'بيض بالطماطة', nameEn: 'Eggs with tomato', priceIqd: 2500, prepTimeMin: 10, taxonomy: 'rice_dishes' },
          { key: 'makhlama', nameAr: 'مخلمة', nameEn: 'Makhlama', descriptionAr: 'لحم مفروم وبيض وبصل بالطاوة', priceIqd: 3000, prepTimeMin: 12, taxonomy: 'rice_dishes' },
        ],
      },
      {
        nameAr: 'باچة',
        nameEn: 'Pacha',
        items: [
          {
            key: 'pacha',
            nameAr: 'باچة',
            nameEn: 'Pacha',
            descriptionAr: 'راس وكراعين وكيبايات، ويا خبز مثرود',
            priceIqd: 7000,
            prepTimeMin: 15,
            taxonomy: 'rice_dishes',
            modifierGroups: [
              servings(6000),
              { nameAr: 'زيادة', nameEn: 'Extra', required: false, max: 2, options: [{ nameAr: 'لسان', nameEn: 'Tongue', priceIqd: 3000 }, { nameAr: 'مخ', nameEn: 'Brain', priceIqd: 2000 }] },
            ],
          },
          { key: 'pacha_tashreeb', nameAr: 'تشريب باچة', nameEn: 'Pacha tashreeb', descriptionAr: 'خبز مثرود بمرق الباچة', priceIqd: 5000, prepTimeMin: 12, taxonomy: 'rice_dishes' },
        ],
      },
      {
        nameAr: 'تمن ومرق',
        nameEn: 'Rice & stew',
        items: [
          { key: 'quzi', nameAr: 'قوزي على تمن', nameEn: 'Quzi on rice', descriptionAr: 'لحم غنم مطبوخ على تمن بالكشمش واللوز', priceIqd: 12000, prepTimeMin: 20, taxonomy: 'rice_dishes' },
          { key: 'dolma', nameAr: 'دولمة', nameEn: 'Dolma', descriptionAr: 'ورق عنب وبصل وفلفل محشي تمن ولحم', priceIqd: 6000, prepTimeMin: 15, taxonomy: 'rice_dishes' },
          { key: 'rice_qeema', nameAr: 'تمن وقيمة', nameEn: 'Rice with qeema', priceIqd: 5000, prepTimeMin: 10, taxonomy: 'rice_dishes' },
        ],
      },
      {
        nameAr: 'مشروبات',
        nameEn: 'Drinks',
        items: [
          { key: 'iraqi_tea', nameAr: 'چاي عراقي', nameEn: 'Iraqi tea', descriptionAr: 'استكان، ويا هيل', priceIqd: 500, prepTimeMin: 3, taxonomy: 'soft_drinks' },
          { key: 'shenina', nameAr: 'شنينة', nameEn: 'Shenina', priceIqd: 750, prepTimeMin: 1, taxonomy: 'soft_drinks' },
        ],
      },
    ],
  },
];

/** Stable ids for a seeded item, its groups and modifiers (1-based, matching the in-memory repository). */
export function seedItemId(restaurant: Pick<SeedRestaurant, 'orgId'>, item: Pick<SeedMenuItem, 'key'>): string {
  return `${restaurant.orgId}_${item.key}`;
}
