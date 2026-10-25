import { STORE_HOURS_RULES, type DayHours, type SetupStep } from '@driver/contracts';

/**
 * Console › المطاعم (Ali, 2026-10-21): the pure parts of setting a shop up for its owner — reading a
 * pasted menu, matching a dish to Driver's photo library, and the hours shortcuts. The screens are in
 * `components/stores/*`.
 */

// ───────────────────────── Arabic text ─────────────────────────

const EASTERN = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Eastern Arabic and Persian digits as 0–9 (a menu typed on a phone often has them). */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(EASTERN.includes(d) ? EASTERN.indexOf(d) : PERSIAN.indexOf(d)));
}

/** For matching only: no diacritics or tatweel, one alef, ه/ة and ى/ي alike, گ/ك and چ/ج alike. */
export function normalizeAr(s: string): string {
  return s
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/گ/g, 'ك')
    .replace(/چ/g, 'ج')
    .replace(/پ/g, 'ب')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ───────────────────────── «الصق المنيو» ─────────────────────────

export interface PastedDish {
  nameAr: string;
  priceIqd: number;
  categoryAr: string | null;
  /** The price was written short ("7") and read as thousands: worth a look. */
  short: boolean;
  line: number;
}

export interface PastedMenu {
  dishes: PastedDish[];
  /** Lines with a name but no price we could read (1-based line numbers). */
  unread: Array<{ line: number; text: string }>;
}

const THOUSANDS = /\s*(?:الف|ألف|آلاف|الاف|ألاف)\s*$/;
// The price is the last number on the line: "كباب 7000", "تكة لحم - 8,000 دينار", "شاورما ٣٠٠٠".
const PRICE_AT_END = /^(.*?)[\s:\-–—=.…|]*?(\d{1,3}(?:[,٬.]\d{3})+|\d+(?:\.\d+)?)\s*((?:الف|ألف|آلاف|الاف|ألاف))?\s*(?:دينار|د\.ع|ع\.د|IQD)?\s*$/i;
const SECTION_LINE = /^(?:#+\s*|[-=*]{2,}\s*)?(.+?)\s*(?::|：|[-=*]{2,})?\s*$/;

/**
 * Reads a menu pasted as text, one dish a line with its price at the end. A line with no number that
 * ends in a colon (or starts with #) opens a section for the lines after it. A price under 100 is read
 * as thousands (Iraqi menus write "7" for 7,000) and marked `short` so the screen can ask; 250 or 750
 * stay dinars (a side, a sandwich).
 */
export function parsePastedMenu(text: string): PastedMenu {
  const dishes: PastedDish[] = [];
  const unread: PastedMenu['unread'] = [];
  let section: string | null = null;
  westernDigits(text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (!line) return;
      const m = PRICE_AT_END.exec(line);
      const name = m?.[1]?.replace(/[\s:\-–—=.…|]+$/, '').trim() ?? '';
      if (m && name) {
        const digits = m[2]!.replace(/[,٬]/g, '');
        let price = Number(digits.includes('.') && /\.\d{3}$/.test(digits) ? digits.replace('.', '') : digits);
        const saidThousands = Boolean(m[3]) || THOUSANDS.test(line);
        let short = false;
        if (saidThousands || price < 100) {
          price = Math.round(price * 1000);
          short = !saidThousands;
        }
        if (Number.isFinite(price) && price > 0 && price <= 10_000_000) {
          dishes.push({ nameAr: name.slice(0, 80), priceIqd: price, categoryAr: section, short, line: i + 1 });
          return;
        }
      }
      if (/^#/.test(line) || /[:：]$/.test(line) || /^[-=*]{2,}.*[-=*]{2,}$/.test(line)) {
        const s = SECTION_LINE.exec(line)?.[1]?.replace(/[#:：\-=*]/g, '').trim();
        if (s) {
          section = s.slice(0, 40);
          return;
        }
      }
      unread.push({ line: i + 1, text: line });
    });
  return { dishes, unread };
}

// ───────────────────────── Driver's photo library ─────────────────────────

/**
 * Driver's dish photos (Ali approved 2026-10-08), served by the API at `/media/food/lib-<slug>-<n>.webp`.
 * The same list as the Merchant app's `features/menu/library-data.ts` (a test checks every file exists).
 */
export const LIBRARY_SECTIONS = ['grill', 'rice', 'breakfast', 'fast', 'sweets', 'drinks'] as const;
export type LibrarySection = (typeof LIBRARY_SECTIONS)[number];

export interface LibraryDish {
  slug: string;
  nameAr: string;
  words: readonly string[];
  section: LibrarySection;
  /** Which of `lib-<slug>-1/2/3` exist. */
  photos: readonly number[];
}

const D = (slug: string, nameAr: string, words: string[], section: LibrarySection, photos: number[] = [1, 2, 3]): LibraryDish => ({ slug, nameAr, words, section, photos });

export const LIBRARY: readonly LibraryDish[] = [
  D('masgouf', 'مسكوف', ['مسكوف', 'سمك'], 'grill'),
  D('kebab', 'كباب', ['كباب'], 'grill'),
  D('tikka', 'تكة', ['تكة', 'تكه'], 'grill', [1, 2]),
  D('mixed-grill', 'مشويات مشكلة', ['مشويات', 'مشكل'], 'grill'),
  D('chicken', 'دجاج مشوي', ['دجاج', 'فروج'], 'grill'),
  D('liver', 'معلاك', ['معلاك', 'كبدة', 'كبد'], 'grill'),
  D('quzi', 'قوزي', ['قوزي', 'قوزى'], 'rice'),
  D('timman-marag', 'تمن ومرق', ['تمن', 'مرق', 'رز'], 'rice'),
  D('biryani', 'برياني', ['برياني'], 'rice', [1, 2]),
  D('dolma', 'دولمة', ['دولمة', 'دولمه', 'محشي'], 'rice'),
  D('bamia', 'بامية', ['بامية', 'باميا'], 'rice'),
  D('qeema', 'قيمة', ['قيمة', 'قيمه'], 'rice'),
  D('tashreeb', 'تشريب', ['تشريب'], 'rice', [3]),
  D('pacha', 'باچة', ['باچة', 'باجة', 'پاچة', 'پاچه'], 'rice', [2, 3]),
  D('geymar', 'كيمر', ['كيمر', 'قيمر', 'قيمك'], 'breakfast'),
  D('bagilla', 'باگلة', ['باگلة', 'باقلاء', 'باقلة', 'باكلة'], 'breakfast'),
  D('lentil-soup', 'شوربة عدس', ['عدس', 'شوربة', 'شوربه'], 'breakfast'),
  D('kubba', 'كبة', ['كبة', 'كبه'], 'breakfast'),
  D('falafel', 'فلافل', ['فلافل'], 'breakfast'),
  D('hummus', 'حمص', ['حمص'], 'breakfast'),
  D('salad', 'زلاطة', ['زلاطة', 'سلطة', 'سلطه', 'زلاطه'], 'breakfast'),
  D('fries', 'چبس', ['چبس', 'جبس', 'بطاطا', 'فرايز'], 'breakfast'),
  D('shawarma', 'شاورما', ['شاورما', 'شاورمة', 'شاورمه'], 'fast'),
  D('zinger', 'زنگر', ['زنگر', 'زنجر', 'زنكر'], 'fast'),
  D('burger', 'برگر', ['برگر', 'برجر', 'بركر', 'همبركر'], 'fast'),
  D('pizza', 'بيتزا', ['بيتزا', 'پيتزا'], 'fast'),
  D('baklava', 'بقلاوة', ['بقلاوة', 'بقلاوه'], 'sweets'),
  D('kunafa', 'كنافة', ['كنافة', 'كنافه'], 'sweets'),
  D('zalabia', 'زلابية', ['زلابية', 'زلابيه'], 'sweets'),
  D('kleicha', 'كليچة', ['كليچة', 'كليجة', 'كليجه'], 'sweets', [1]),
  D('tea', 'چاي', ['چاي', 'شاي', 'جاي'], 'drinks'),
  D('laban', 'لبن', ['لبن', 'شنينة', 'شنينه'], 'drinks'),
  D('orange-juice', 'عصير برتقال', ['برتقال', 'عصير'], 'drinks'),
  D('cocktail', 'كوكتيل', ['كوكتيل'], 'drinks'),
];

/** The file name the API takes (`ops.stores.libraryPhoto`) and its path on the API. */
export const libraryFile = (slug: string, n: number): string => `lib-${slug}-${n}.webp`;
export const libraryPath = (slug: string, n: number): string => `/media/food/${libraryFile(slug, n)}`;

/** Library dishes whose words appear in the dish's name, best (longest word) first. */
export function librarySuggest(dishName: string): LibraryDish[] {
  const name = normalizeAr(dishName);
  if (!name) return [];
  const hits: Array<{ dish: LibraryDish; score: number }> = [];
  for (const dish of LIBRARY) {
    const best = Math.max(0, ...dish.words.map((w) => normalizeAr(w)).filter((w) => name.includes(w)).map((w) => w.length));
    if (best > 0) hits.push({ dish, score: best });
  }
  return hits.sort((a, b) => b.score - a.score).map((h) => h.dish);
}

// ───────────────────────── the seven steps ─────────────────────────

/** Where the team does each «جهّز محلك» step from the Console; `owner` steps are the owner's own. */
export const STEP_PLACE: Record<SetupStep, 'kind' | 'menu' | 'hours' | 'pickup' | 'owner'> = {
  kind: 'kind',
  menu: 'menu',
  photos: 'menu',
  hours: 'hours',
  // His payout details and his practice order on his own phone: the team never does these.
  money: 'owner',
  pickup: 'pickup',
  counter: 'owner',
};

// ───────────────────────── hours ─────────────────────────

/** Seven days, Sunday first, with `shifts` every day (a common start for a new shop). */
export function everyDay(start: string, end: string): DayHours[] {
  return Array.from({ length: 7 }, (_, dow) => ({ dow, shifts: [{ start, end }] }));
}

/** The day takes the previous day's shifts (Sunday takes Saturday's). */
export function sameAsDayBefore(days: readonly DayHours[], dow: number): DayHours[] {
  const prev = days.find((d) => d.dow === (dow + 6) % 7);
  return days.map((d) => (d.dow === dow ? { dow, shifts: (prev?.shifts ?? []).map((s) => ({ ...s })) } : d));
}

export function canAddShift(day: DayHours): boolean {
  return day.shifts.length < STORE_HOURS_RULES.maxShiftsPerDay;
}

/** Ordered Sunday first (the API sends them so; a hand-made list may not be). */
export function sundayFirst(days: readonly DayHours[]): DayHours[] {
  const byDow = new Map(days.map((d) => [d.dow, d]));
  return Array.from({ length: 7 }, (_, dow) => byDow.get(dow) ?? { dow, shifts: [] });
}

/**
 * A time as typed, made "HH:MM" (24 h): "4" → "04:00", "16.30" → "16:30", "١٢:٠٠" → "12:00", "24" →
 * "00:00" (midnight). Null when it is not a time. Typing, not an hour grid (Ali: no hour-grid pickers).
 */
export function readClock(text: string): string | null {
  const m = /^(\d{1,2})(?:[:.٫،,](\d{1,2}))?$/.exec(westernDigits(text).trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0'));
  if (h === 24 && min === 0) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
