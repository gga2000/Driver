import { AZIZIYAH_LANDMARKS, AZIZIYAH_ZONES, foldArabic, searchScore, westernDigits, type IntercityDirection, type LaunchService } from '@driver/contracts';
import { bandWords } from '@/features/home/daypart';
import type { RideVertical, Spot } from '@/features/ride/logic';

/**
 * One box for the whole town (joy h4, discovery D-04, idea 4-4): what a search query means beyond
 * food, read from folded whole words so «بغدادي» (a dish) never becomes Baghdad:
 *  - «بغداد», «الكوت», «كراج», «رجعة», «سفر»         → a الرجعة card (next car, «احجز»);
 *  - «تكسي», «تاكسي», «تكتك» (+ «للسوق», «لشارع 30»)  → a ride row, the destination filled in;
 *  - a zone or landmark said exactly («شارع ٣٠»)      → «تكسي لـ شارع 30»;
 *  - «فطور», «غدا», «عشا», «حلو», «عصير»…              → a meal: dish words and kitchen tags;
 *  - «سوق», «خضرة», «خط», «مدرسة», «طرد»               → the coming-soon sheet.
 * Pure (no React), so the matcher is tested on its own. The screen shows these as a «خدمات» group
 * above the kitchens and dishes.
 */
export type MealKey = 'breakfast' | 'lunch' | 'dinner' | 'sweet' | 'drink';

export type SearchIntent =
  | { kind: 'rajaa'; cityId: 'baghdad' | 'kut'; direction: IntercityDirection }
  | { kind: 'ride'; vertical: RideVertical; to: Spot | null }
  | { kind: 'meal'; meal: MealKey; words: readonly string[]; tags: readonly string[] }
  | { kind: 'soon'; service: Exclude<LaunchService, 'errand'> };

const f = (words: readonly string[]) => new Set(words.map(foldArabic));

const CITY: ReadonlyArray<[Set<string>, 'baghdad' | 'kut']> = [
  [f(['بغداد']), 'baghdad'],
  [f(['الكوت', 'كوت']), 'kut'],
];
const RAJAA_WORDS = f(['كراج', 'گراج', 'رجعة', 'الرجعة', 'سفر', 'سفرة']);
/** «الرجعة» is the way back to Aziziyah only (n1). */
const BACK_WORDS = f(['رجعة', 'الرجعة']);
const TAXI = f(['تكسي', 'تاكسي', 'تكسى']);
const TUKTUK = f(['تكتك', 'توكتوك', 'تكتوك']);
/** Small words between a ride word and where to: «تكسي الى السوق», «تكسي من البيت». */
const FILLER = f(['الى', 'إلى', 'لل', 'ل', 'على', 'عند', 'يم', 'من', 'اريد', 'أريد', 'ابي', 'هسة', 'هسه']);
const FROM = foldArabic('من');

const MEALS: ReadonlyArray<{ meal: MealKey; words: Set<string>; dishes: readonly string[]; tags: readonly string[] }> = [
  { meal: 'breakfast', words: f(['فطور', 'ريوگ', 'ريوك', 'صبحية']), dishes: bandWords({ key: 'dawn', friday: false }), tags: ['breakfast', 'pacha'] },
  { meal: 'lunch', words: f(['غدا', 'غداء', 'الغدا']), dishes: bandWords({ key: 'lunch', friday: false }), tags: ['rice', 'stew'] },
  { meal: 'dinner', words: f(['عشا', 'عشاء', 'العشا']), dishes: bandWords({ key: 'dinner', friday: false }), tags: ['grill', 'kebab', 'shawarma'] },
  { meal: 'sweet', words: f(['حلو', 'حلويات', 'حلوى', 'حلويه']), dishes: ['كنافة', 'بقلاوة', 'زلابية', 'حلاوة', 'بسبوسة', 'كيك'], tags: ['dessert'] },
  { meal: 'drink', words: f(['مشروب', 'مشروبات', 'عصير', 'عصائر']), dishes: ['عصير', 'ليمون', 'لبن', 'شنينة', 'چاي'], tags: [] },
];

const SOON: ReadonlyArray<[Set<string>, 'grocery' | 'khat' | 'parcel']> = [
  [f(['سوق', 'السوق', 'خضرة', 'خضار', 'بقالة', 'مسواك']), 'grocery'],
  [f(['خط', 'خطوط', 'مدرسة', 'المدرسة', 'دوام', 'الدوام']), 'khat'],
  [f(['طرد', 'طرود', 'غراض']), 'parcel'],
];

/** Drop the attached «لل/ل» of «للسوق», «لشارع» (only on words long enough to carry one). */
function stripTo(word: string): string {
  if (word.length > 3 && word.startsWith('لل')) return word.slice(2);
  if (word.length > 3 && word.startsWith('ل')) return word.slice(1);
  return word;
}

interface Place {
  spot: Spot;
  names: readonly string[];
}

const PLACES: readonly Place[] = [
  ...AZIZIYAH_ZONES.map(
    (z): Place => ({
      spot: { id: `zone:${z.id}`, kind: 'zone', title: westernDigits(z.name_ar), zoneId: z.id, pin: { lat: z.lat, lng: z.lng } },
      names: [z.name_ar],
    }),
  ),
  ...AZIZIYAH_LANDMARKS.map(
    (l): Place => ({
      spot: { id: `landmark:${l.key}`, kind: 'landmark', title: westernDigits(l.name_ar), zoneId: l.zoneId, pin: { lat: l.lat, lng: l.lng }, landmarkKind: l.kind },
      names: [l.name_ar, ...(l.aliases_ar ?? [])],
    }),
  ),
];

/**
 * The zone or landmark a phrase names. `exact` (no ride word typed): only a whole name or alias, so
 * «مطعم» never turns into a ride to «معمل سوس مطعم عبدالله». After a ride word, every word has to
 * start a word of the name. Landmarks win ties (a named place is more precise than a zone centre).
 */
export function placeFor(phrase: string, exact: boolean): Spot | null {
  const q = foldArabic(phrase);
  if (q.length < 2) return null;
  let best: { spot: Spot; score: number } | null = null;
  for (const p of PLACES) {
    const score = Math.max(...p.names.map((n) => searchScore(q, n)));
    if (score < (exact ? 3 : 2)) continue;
    if (!best || score > best.score || (score === best.score && p.spot.kind === 'landmark' && best.spot.kind !== 'landmark')) best = { spot: p.spot, score };
  }
  return best?.spot ?? null;
}

export function searchIntents(query: string): SearchIntent[] {
  const words = foldArabic(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const has = (set: Set<string>) => words.some((w) => set.has(w) || set.has(stripTo(w)));
  const out: SearchIntent[] = [];

  // Trips by city (n3): «لبغداد» is the way there, «من بغداد» the way back, and a bare «بغداد» shows
  // the next cars both ways (there first). «الرجعة» is the way back; «كراج» or «سفرة» both ways.
  const both = (cityId: 'baghdad' | 'kut') => {
    out.push({ kind: 'rajaa', cityId, direction: 'from_aziziyah' }, { kind: 'rajaa', cityId, direction: 'to_aziziyah' });
  };
  for (const [set, cityId] of CITY) {
    const i = words.findIndex((w) => set.has(w) || set.has(stripTo(w)));
    if (i === -1) continue;
    if (words[i - 1] === FROM) out.push({ kind: 'rajaa', cityId, direction: 'to_aziziyah' });
    else if (!set.has(words[i]!)) out.push({ kind: 'rajaa', cityId, direction: 'from_aziziyah' });
    else both(cityId);
  }
  if (out.length === 0 && has(RAJAA_WORDS) && !words.some((w) => TAXI.has(w) || TUKTUK.has(w))) {
    if (has(BACK_WORDS)) out.push({ kind: 'rajaa', cityId: 'baghdad', direction: 'to_aziziyah' });
    else both('baghdad');
  }

  // Rides: a vehicle word, and whatever follows as the destination.
  const vertical: RideVertical | null = words.some((w) => TUKTUK.has(w)) ? 'tuktuk' : words.some((w) => TAXI.has(w)) ? 'taxi' : null;
  if (vertical) {
    const rest = words.filter((w) => !TAXI.has(w) && !TUKTUK.has(w) && !FILLER.has(w)).map(stripTo);
    out.push({ kind: 'ride', vertical, to: rest.length > 0 ? placeFor(rest.join(' '), false) : null });
  } else {
    const to = placeFor(words.join(' '), true);
    if (to) out.push({ kind: 'ride', vertical: 'taxi', to });
  }

  for (const m of MEALS) if (has(m.words)) out.push({ kind: 'meal', meal: m.meal, words: m.dishes, tags: m.tags });
  if (!vertical) for (const [set, service] of SOON) if (words.every((w) => set.has(w))) out.push({ kind: 'soon', service });
  return out;
}
