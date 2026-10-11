import type { Bakery, ShoppingFront, Stall } from './model';

/**
 * Aziziyah demo shops for the shopping screens until the shopping API serves them (round 2 data,
 * 2026-10-11, the same numbers as the concept boards Ali approved).
 */
const media = (name: string) => `/media/food/${name}`;

const abuHaider: Stall = {
  id: 'stall-abu-haider',
  name: 'بسطية أبو حيدر',
  area: 'شارع السوق',
  rating: 4.8,
  minutes: 8,
  postedAt: '6:12',
  photo: media('shop-produce-stall-1.webp'),
  items: [
    { id: 'tomato', name: 'طماطة', photo: media('shop-tomato-1.webp'), photoToday: true, soldBy: 'kg', priceIqd: 1000, yesterdayIqd: 1250, priceFromYesterday: false, piecesPerKg: [6, 7], piecesWord: 'طماطات' },
    { id: 'cucumber', name: 'خيار', photo: media('shop-cucumber-1.webp'), photoToday: true, soldBy: 'kg', priceIqd: 750, yesterdayIqd: 750, priceFromYesterday: false, piecesPerKg: [8, 10], piecesWord: 'خيارات' },
    { id: 'okra', name: 'باميا', photo: media('shop-okra-1.webp'), photoToday: true, soldBy: 'kg', priceIqd: 3000, yesterdayIqd: 2500, priceFromYesterday: false, piecesPerKg: null, piecesWord: null },
    { id: 'eggplant', name: 'بيتنجان', photo: media('shop-eggplant-1.webp'), photoToday: true, soldBy: 'kg', priceIqd: 1000, yesterdayIqd: 1000, priceFromYesterday: false, piecesPerKg: [3, 4], piecesWord: 'بيتنجانات' },
    { id: 'orange', name: 'برتقال', photo: media('shop-orange-1.webp'), photoToday: false, soldBy: 'kg', priceIqd: 1500, yesterdayIqd: 1500, priceFromYesterday: false, piecesPerKg: [5, 6], piecesWord: 'برتقالات' },
    { id: 'pomegranate', name: 'رمان', photo: media('shop-pomegranate-1.webp'), photoToday: true, soldBy: 'kg', priceIqd: 2000, yesterdayIqd: 2000, priceFromYesterday: false, piecesPerKg: [2, 3], piecesWord: 'رمانات' },
    { id: 'watermelon', name: 'رقي', photo: media('shop-watermelon-1.webp'), photoToday: true, soldBy: 'piece', priceIqd: 3500, yesterdayIqd: 3500, priceFromYesterday: true, piecesPerKg: null, piecesWord: null },
  ],
};

const hajJabbar: Stall = {
  id: 'stall-haj-jabbar',
  name: 'خضرة الحاج جبار',
  area: 'حي العسكري',
  rating: 4.6,
  minutes: 12,
  postedAt: '6:40',
  photo: media('shop-produce-stall-1.webp'),
  items: [
    { id: 'tomato', name: 'طماطة', photo: media('shop-tomato-1.webp'), photoToday: true, soldBy: 'kg', priceIqd: 1250, yesterdayIqd: 1250, priceFromYesterday: false, piecesPerKg: [6, 7], piecesWord: 'طماطات' },
    { id: 'eggplant', name: 'بيتنجان', photo: media('shop-eggplant-1.webp'), photoToday: true, soldBy: 'kg', priceIqd: 750, yesterdayIqd: 1000, priceFromYesterday: false, piecesPerKg: [3, 4], piecesWord: 'بيتنجانات' },
    { id: 'orange', name: 'برتقال', photo: media('shop-orange-1.webp'), photoToday: true, soldBy: 'kg', priceIqd: 1500, yesterdayIqd: 1250, priceFromYesterday: false, piecesPerKg: [5, 6], piecesWord: 'برتقالات' },
    { id: 'pomegranate', name: 'رمان', photo: media('shop-pomegranate-1.webp'), photoToday: true, soldBy: 'kg', priceIqd: 2000, yesterdayIqd: null, priceFromYesterday: false, piecesPerKg: [2, 3], piecesWord: 'رمانات' },
  ],
};

const abuAli: Bakery = {
  id: 'bakery-abu-ali',
  name: 'فرن أبو علي',
  street: 'خبز تنور وصمون، قرب الجسر',
  state: 'paused',
  closesAt: '10:00',
  resumesAt: '9:45',
  opensAt: null,
  minutes: 20,
  photo: media('shop-samoon-oven-1.webp'),
  items: [
    { id: 'hajri', name: 'صمون حجري', per: 4, priceIqd: 1000 },
    { id: 'tannour', name: 'خبز تنور', per: 3, priceIqd: 1000 },
  ],
};

const hajKadhim: Bakery = {
  id: 'bakery-haj-kadhim',
  name: 'فرن الحاج كاظم',
  street: 'صمون حجري، شارع المستشفى',
  state: 'open',
  closesAt: '11:00',
  resumesAt: null,
  opensAt: null,
  minutes: 15,
  photo: media('shop-samoon-oven-1.webp'),
  items: [
    { id: 'hajri', name: 'صمون حجري', per: 4, priceIqd: 1000 },
    { id: 'small', name: 'صمون صغار', per: 8, priceIqd: 1000 },
    { id: 'kaak', name: 'كعك بالسمسم', per: 10, priceIqd: 1000 },
  ],
};

export const DEMO_FRONT: ShoppingFront = {
  bakeriesOpen: 4,
  stalls: [abuHaider, hajJabbar],
  bakeries: [hajKadhim, abuAli],
};

/** Shops in the app a دوّرلي item can name (any kind: the list is not only food). */
export const DEMO_APP_SHOPS: readonly { id: string; name: string; kind: string }[] = [
  { id: 'shop-noor-library', name: 'مكتبة النور', kind: 'مكتبة' },
  { id: 'shop-shifa-pharmacy', name: 'صيدلية الشفاء', kind: 'صيدلية' },
  { id: 'shop-rafidain-mobiles', name: 'موبايلات الرافدين', kind: 'موبايلات' },
  { id: 'shop-amal-electric', name: 'كهربائيات الأمل', kind: 'كهربائيات' },
  { id: 'stall-abu-haider', name: 'بسطية أبو حيدر', kind: 'خضرة وفواكه' },
  { id: 'bakery-haj-kadhim', name: 'فرن الحاج كاظم', kind: 'فرن' },
];
