import type { SeedHours, SeedModifierGroup, SeedRestaurant } from './aziziyah-restaurants.js';

/**
 * DEMO ONLY: a café, a juice bar, a sweets shop and an ice cream shop, so the food doors (قهوة وچاي،
 * عصير وبارد، حلو وآيس كريم) have something behind them in the studio and the screenshots. They are
 * seeded by the customer demo API alone (`apps/customer/scripts/demo-api.mjs`), never by `pnpm db:seed`:
 * no real shop has signed up yet, and real shops join through the Console. Same shape as the launch
 * kitchens; prices are realistic 2026 Aziziyah prices in IQD.
 */

function daily(start: string, end: string): SeedHours[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start, end }));
}

const cupSize = (largeIqd: number): SeedModifierGroup => ({
  nameAr: 'الحجم',
  nameEn: 'Size',
  required: true,
  max: 1,
  options: [
    { nameAr: 'وسط', nameEn: 'Medium', priceIqd: 0 },
    { nameAr: 'كبير', nameEn: 'Large', priceIqd: largeIqd },
  ],
});

/** Sugar the Iraqi way (idea q2): optional, so no pick is the shop's usual; the app remembers the person's last pick. */
const sugar: SeedModifierGroup = {
  nameAr: 'السكر',
  nameEn: 'Sugar',
  required: false,
  max: 1,
  options: [
    { nameAr: 'سادة', nameEn: 'No sugar', priceIqd: 0 },
    { nameAr: 'وسط', nameEn: 'Medium', priceIqd: 0 },
    { nameAr: 'حلو', nameEn: 'Sweet', priceIqd: 0 },
  ],
};

/** Ice on the side (idea j3): a juice that rides a while arrives cold without going watery. */
const ice: SeedModifierGroup = {
  nameAr: 'الثلج',
  nameEn: 'Ice',
  required: false,
  max: 1,
  options: [
    { nameAr: 'الثلج بكوب لحاله', nameEn: 'Ice in a separate cup', priceIqd: 0 },
    { nameAr: 'بلا ثلج', nameEn: 'No ice', priceIqd: 0 },
  ],
};

/** Cardamom in Arabic coffee (q2). */
const cardamom: SeedModifierGroup = {
  nameAr: 'الهيل',
  nameEn: 'Cardamom',
  required: false,
  max: 1,
  options: [
    { nameAr: 'بالهيل', nameEn: 'With cardamom', priceIqd: 0 },
    { nameAr: 'بلا هيل', nameEn: 'No cardamom', priceIqd: 0 },
  ],
};

const byWeight = (halfIqd: number, kiloIqd: number): SeedModifierGroup => ({
  nameAr: 'الكمية',
  nameEn: 'Amount',
  required: true,
  max: 1,
  options: [
    { nameAr: 'ربع كيلو', nameEn: 'Quarter kilo', priceIqd: 0, servesMin: 2, servesMax: 3 },
    { nameAr: 'نص كيلو', nameEn: 'Half kilo', priceIqd: halfIqd, servesMin: 4, servesMax: 6 },
    { nameAr: 'كيلو', nameEn: 'One kilo', priceIqd: kiloIqd, servesMin: 8, servesMax: 12 },
  ],
});

const flavours: SeedModifierGroup = {
  nameAr: 'النكهات',
  nameEn: 'Flavours',
  required: true,
  min: 1,
  max: 2,
  options: [
    { nameAr: 'قيمر', nameEn: 'Qaimar (clotted cream)', priceIqd: 0 },
    { nameAr: 'فستق', nameEn: 'Pistachio', priceIqd: 250 },
    { nameAr: 'شوكولاتة', nameEn: 'Chocolate', priceIqd: 0 },
    { nameAr: 'فراولة', nameEn: 'Strawberry', priceIqd: 0 },
    { nameAr: 'مانگا', nameEn: 'Mango', priceIqd: 0 },
  ],
};

export const DEMO_SHOPS: readonly SeedRestaurant[] = [
  {
    key: 'dijla_cafe',
    orgId: 'org_aziziyah_dijla_cafe',
    nameAr: 'كافيه دجلة',
    nameEn: 'Dijla Café',
    cuisineAr: 'قهوة · چاي · كيك',
    tags: ['coffee', 'cake'],
    cityId: 'aziziyah',
    zoneKey: 'street_30',
    pin: { lat: 32.9101, lng: 45.0629 },
    minOrderIqd: 2000,
    prepMin: 8,
    hours: daily('07:00', '00:00'),
    ratingPlaceholder: { avg: 4.6, count: 38 },
    categories: [
      {
        nameAr: 'قهوة',
        nameEn: 'Coffee',
        items: [
          {
            key: 'arabic_coffee',
            nameAr: 'قهوة عربية',
            nameEn: 'Arabic coffee',
            descriptionAr: 'مرة بالهيل، ويا تمرتين',
            priceIqd: 1000,
            prepTimeMin: 4,
            taxonomy: 'coffee',
            modifierGroups: [sugar, cardamom],
          },
          {
            key: 'espresso',
            nameAr: 'اسبريسو',
            nameEn: 'Espresso',
            priceIqd: 1500,
            prepTimeMin: 3,
            taxonomy: 'coffee',
          },
          {
            key: 'cappuccino',
            nameAr: 'كابتشينو',
            nameEn: 'Cappuccino',
            descriptionAr: 'اسبريسو وحليب مرغّي',
            priceIqd: 2500,
            prepTimeMin: 5,
            taxonomy: 'coffee',
            modifierGroups: [cupSize(500), sugar],
          },
          {
            key: 'iced_latte',
            nameAr: 'لاتيه مثلج',
            nameEn: 'Iced latte',
            descriptionAr: 'حليب بارد وثلج وشوت اسبريسو',
            priceIqd: 3000,
            prepTimeMin: 5,
            taxonomy: 'coffee',
            modifierGroups: [cupSize(500)],
            labels: ['new'],
          },
          {
            key: 'nescafe',
            nameAr: 'نسكافيه بالحليب',
            nameEn: 'Nescafé with milk',
            priceIqd: 1500,
            prepTimeMin: 3,
            taxonomy: 'coffee',
            modifierGroups: [sugar],
          },
        ],
      },
      {
        nameAr: 'چاي',
        nameEn: 'Tea',
        items: [
          {
            key: 'iraqi_tea',
            nameAr: 'چاي عراقي',
            nameEn: 'Iraqi tea',
            descriptionAr: 'استكان، مهيّل',
            priceIqd: 500,
            prepTimeMin: 3,
            taxonomy: 'coffee',
            modifierGroups: [sugar],
          },
          {
            key: 'karak',
            nameAr: 'چاي كرك',
            nameEn: 'Karak tea',
            descriptionAr: 'چاي بالحليب والهيل والزعفران',
            priceIqd: 1500,
            prepTimeMin: 4,
            taxonomy: 'coffee',
            modifierGroups: [sugar],
          },
          {
            key: 'lemon_tea',
            nameAr: 'چاي ليمون (نومي بصرة)',
            nameEn: 'Dried-lime tea',
            priceIqd: 750,
            prepTimeMin: 3,
            taxonomy: 'coffee',
          },
        ],
      },
      {
        nameAr: 'كيك وكليچة',
        nameEn: 'Cake & kleicha',
        items: [
          {
            key: 'choc_cake',
            nameAr: 'كيك شوكولاتة',
            nameEn: 'Chocolate cake slice',
            priceIqd: 2000,
            prepTimeMin: 2,
            taxonomy: 'sweets',
          },
          {
            key: 'kleicha',
            nameAr: 'كليچة تمر',
            nameEn: 'Date kleicha (6 pieces)',
            descriptionAr: '6 حبات، خبز البيت',
            priceIqd: 2500,
            prepTimeMin: 2,
            taxonomy: 'sweets',
          },
        ],
      },
    ],
  },
  {
    key: 'rabee_juice',
    orgId: 'org_aziziyah_rabee_juice',
    nameAr: 'عصائر الربيع',
    nameEn: 'Al-Rabee Juice',
    cuisineAr: 'عصير طازج · ليمون · كوكتيل',
    tags: ['juice', 'smoothie'],
    cityId: 'aziziyah',
    zoneKey: 'centre',
    pin: { lat: 32.9057, lng: 45.0611 },
    minOrderIqd: 2000,
    prepMin: 6,
    hours: daily('10:00', '01:00'),
    ratingPlaceholder: { avg: 4.5, count: 52 },
    categories: [
      {
        nameAr: 'عصير طازج',
        nameEn: 'Fresh juice',
        items: [
          {
            key: 'orange',
            nameAr: 'عصير برتقال',
            nameEn: 'Orange juice',
            descriptionAr: 'يعصر بوقته',
            priceIqd: 2000,
            prepTimeMin: 4,
            taxonomy: 'juice',
            modifierGroups: [cupSize(1000), ice],
          },
          {
            key: 'pomegranate',
            nameAr: 'عصير رمان',
            nameEn: 'Pomegranate juice',
            priceIqd: 3000,
            prepTimeMin: 5,
            taxonomy: 'juice',
            modifierGroups: [cupSize(1000), ice],
          },
          {
            key: 'banana_milk',
            nameAr: 'موز بالحليب',
            nameEn: 'Banana milk',
            priceIqd: 2500,
            prepTimeMin: 4,
            taxonomy: 'juice',
            modifierGroups: [cupSize(1000), ice],
          },
          {
            key: 'carrot',
            nameAr: 'عصير جزر',
            nameEn: 'Carrot juice',
            priceIqd: 2000,
            prepTimeMin: 4,
            taxonomy: 'juice',
          },
        ],
      },
      {
        nameAr: 'بارد',
        nameEn: 'Cold drinks',
        items: [
          {
            key: 'lemon_mint',
            nameAr: 'ليمون بالنعناع',
            nameEn: 'Lemon mint',
            descriptionAr: 'ثلج مجروش ونعناع',
            priceIqd: 2000,
            prepTimeMin: 3,
            taxonomy: 'juice',
          },
          {
            key: 'mojito',
            nameAr: 'موهيتو',
            nameEn: 'Mojito (alcohol-free)',
            descriptionAr: 'ليمون ونعناع وصودا',
            priceIqd: 3000,
            prepTimeMin: 4,
            taxonomy: 'juice',
            labels: ['new'],
          },
          {
            key: 'cocktail',
            nameAr: 'كوكتيل فواكه',
            nameEn: 'Fruit cocktail',
            descriptionAr: 'طبقات موز وفراولة ومانگا وقشطة',
            priceIqd: 3500,
            prepTimeMin: 6,
            taxonomy: 'juice',
          },
        ],
      },
    ],
  },
  {
    key: 'zahraa_sweets',
    orgId: 'org_aziziyah_zahraa_sweets',
    nameAr: 'حلويات الزهراء',
    nameEn: 'Al-Zahraa Sweets',
    cuisineAr: 'كنافة · بقلاوة · زلابية',
    tags: ['sweets', 'kunafa', 'baklava', 'ice_cream'],
    cityId: 'aziziyah',
    zoneKey: 'nakheel_street',
    pin: { lat: 32.9021, lng: 45.0562 },
    minOrderIqd: 3000,
    prepMin: 10,
    hours: daily('09:00', '00:00'),
    ratingPlaceholder: { avg: 4.7, count: 61 },
    categories: [
      {
        nameAr: 'كنافة',
        nameEn: 'Kunafa',
        items: [
          {
            key: 'kunafa',
            nameAr: 'كنافة نابلسية',
            nameEn: 'Nabulsi kunafa',
            descriptionAr: 'جبن حار وقطر، تطلع من الفرن',
            priceIqd: 3000,
            prepTimeMin: 8,
            taxonomy: 'sweets',
          },
          {
            key: 'kunafa_qaimar',
            nameAr: 'كنافة بالقيمر',
            nameEn: 'Kunafa with qaimar',
            priceIqd: 4000,
            prepTimeMin: 8,
            taxonomy: 'sweets',
          },
        ],
      },
      {
        nameAr: 'بالكيلو',
        nameEn: 'By weight',
        items: [
          {
            key: 'baklava',
            nameAr: 'بقلاوة',
            nameEn: 'Baklava',
            descriptionAr: 'بالفستق والجوز',
            priceIqd: 5000,
            prepTimeMin: 3,
            taxonomy: 'sweets',
            modifierGroups: [byWeight(5000, 15000)],
            labels: ['family'],
          },
          {
            key: 'zalabia',
            nameAr: 'زلابية',
            nameEn: 'Zalabia',
            priceIqd: 2000,
            prepTimeMin: 3,
            taxonomy: 'sweets',
            modifierGroups: [byWeight(2000, 6000)],
          },
          {
            key: 'kleicha_mix',
            nameAr: 'كليچة مشكلة',
            nameEn: 'Mixed kleicha',
            descriptionAr: 'تمر وجوز وسمسم',
            priceIqd: 3000,
            prepTimeMin: 3,
            taxonomy: 'sweets',
            modifierGroups: [byWeight(3000, 9000)],
          },
        ],
      },
      {
        nameAr: 'آيس كريم',
        nameEn: 'Ice cream',
        items: [
          {
            key: 'qaimar_cup',
            nameAr: 'كوب آيس كريم قيمر',
            nameEn: 'Qaimar ice cream cup',
            priceIqd: 1500,
            prepTimeMin: 2,
            taxonomy: 'ice_cream',
          },
        ],
      },
    ],
  },
  {
    key: 'furat_icecream',
    orgId: 'org_aziziyah_furat_icecream',
    nameAr: 'آيس كريم الفرات',
    nameEn: 'Al-Furat Ice Cream',
    cuisineAr: 'آيس كريم · دوندرمة · ميلك شيك',
    tags: ['ice_cream'],
    cityId: 'aziziyah',
    zoneKey: 'centre',
    pin: { lat: 32.9046, lng: 45.0596 },
    minOrderIqd: 2000,
    prepMin: 3,
    hours: daily('12:00', '01:00'),
    ratingPlaceholder: { avg: 4.8, count: 44 },
    categories: [
      {
        nameAr: 'آيس كريم',
        nameEn: 'Ice cream',
        items: [
          {
            key: 'cone',
            nameAr: 'كون آيس كريم',
            nameEn: 'Ice cream cone',
            descriptionAr: 'كرتين، تختار النكهات',
            priceIqd: 1500,
            prepTimeMin: 2,
            taxonomy: 'ice_cream',
            modifierGroups: [flavours],
          },
          {
            key: 'cup',
            nameAr: 'كوب آيس كريم',
            nameEn: 'Ice cream cup',
            descriptionAr: 'ثلاث كرات',
            priceIqd: 2500,
            prepTimeMin: 2,
            taxonomy: 'ice_cream',
            modifierGroups: [flavours],
          },
          {
            key: 'dondurma',
            nameAr: 'دوندرمة بالفستق',
            nameEn: 'Pistachio dondurma',
            descriptionAr: 'مطاطية، بالسحلب والفستق',
            priceIqd: 2500,
            prepTimeMin: 2,
            taxonomy: 'ice_cream',
          },
        ],
      },
      {
        nameAr: 'ميلك شيك',
        nameEn: 'Milkshakes',
        items: [
          {
            key: 'milkshake',
            nameAr: 'ميلك شيك',
            nameEn: 'Milkshake',
            priceIqd: 3000,
            prepTimeMin: 4,
            taxonomy: 'ice_cream',
            modifierGroups: [flavours],
          },
        ],
      },
    ],
  },
];
