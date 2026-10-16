import { foldArabic } from '@driver/contracts';
import type { PotPlace } from './gallery';
import type { RamadanPhase } from './ramadan-day';

/**
 * «وقت العزيزية» (joy h1, discovery D-02 and idea 4-1): the town's rhythm, read from a clock in
 * Baghdad time (Iraq keeps UTC+3 all year). It drives the home's greeting line, the order of the
 * cuisine circles, which kitchens sort first and the words of the daypart band's dishes. Pure, with
 * the clock passed in, so every boundary is tested.
 *
 *   dawn 04–11 · lunch 11–16 · asr 16–19 · dinner 19–23 · late 23–04
 */
export type DaypartKey = 'dawn' | 'lunch' | 'asr' | 'dinner' | 'late';

export interface Daypart {
  key: DaypartKey;
  /** Friday in Baghdad (the family lunch, «غدا الجمعة»). */
  friday: boolean;
  /** Baghdad wall clock, for the band and tests. */
  hour: number;
  minute: number;
}

/** Iraq: UTC+3, no daylight saving. */
export const BAGHDAD_UTC_OFFSET_MIN = 180;
const FRIDAY = 5;

/** The Baghdad wall clock and weekday (0 = Sunday) of an instant. */
export function baghdadClock(now: Date): { hour: number; minute: number; dow: number } {
  const local = new Date(now.getTime() + BAGHDAD_UTC_OFFSET_MIN * 60_000);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes(), dow: local.getUTCDay() };
}

export function daypartKeyAt(hour: number): DaypartKey {
  if (hour >= 4 && hour < 11) return 'dawn';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 19) return 'asr';
  if (hour >= 19 && hour < 23) return 'dinner';
  return 'late';
}

export function daypart(now: Date): Daypart {
  const c = baghdadClock(now);
  return { key: daypartKeyAt(c.hour), friday: c.dow === FRIDAY, hour: c.hour, minute: c.minute };
}

/** Friday lunch has its own line and dishes (big platters for the family). */
function isFridayLunch(d: Pick<Daypart, 'key' | 'friday'>): boolean {
  return d.friday && d.key === 'lunch';
}

export type GreetingKey =
  | `home.daypart.${DaypartKey | 'friday_lunch'}`
  | `home.daypart.${DaypartKey | 'friday_lunch'}_anon`
  | `home.daypart.quiet_${'dawn' | 'lunch' | 'evening' | 'late'}`
  | `home.daypart.quiet_${'dawn' | 'lunch' | 'evening' | 'late'}_anon`
  | 'home.daypart.late_closed'
  | 'home.daypart.late_closed_anon'
  | `home.ramadan.${RamadanPhase | 'quiet'}`
  | `home.ramadan.${RamadanPhase | 'quiet'}_anon`;

/**
 * The greeting line's locale key. On a quiet day (mourning, set in the Console) there is no playful
 * line («سهرانين؟», «شي خفيف للعصر؟», «غدا الجمعة للعائلة»): only a plain good morning or evening.
 * `named` = the person told us their name (the `{name}` variant). `closed` = every kitchen is closed
 * right now: late at night the line can't say «هذني فاتحين», so it says they're back in the morning.
 * `ramadan` = where the fast is (home roast 4): «رمضان كريم» in the day, iftar, sweets, suhoor, never
 * «وقت الغدا»; on a quiet day only «رمضان كريم».
 */
export function greetingKey(d: Pick<Daypart, 'key' | 'friday'>, opts: { quiet: boolean; named: boolean; closed?: boolean; ramadan?: RamadanPhase | null }): GreetingKey {
  const suffix = opts.named ? '' : '_anon';
  if (opts.ramadan && opts.quiet) return `home.ramadan.quiet${suffix}`;
  if (opts.ramadan && !(opts.closed && d.key === 'late')) return `home.ramadan.${opts.ramadan}${suffix}`;
  if (opts.quiet) {
    const plain = d.key === 'dawn' ? 'dawn' : d.key === 'lunch' ? 'lunch' : d.key === 'late' ? 'late' : 'evening';
    return `home.daypart.quiet_${plain}${suffix}`;
  }
  if (opts.closed && d.key === 'late') return `home.daypart.late_closed${suffix}`;
  const key = isFridayLunch(d) ? 'friday_lunch' : d.key;
  return `home.daypart.${key}${suffix}`;
}

export type BandTitleKey = `home.band.${DaypartKey | 'friday_lunch'}` | `home.ramadan_band.${RamadanPhase}`;

/** The daypart band's title (a dish row, not a second greeting). Quiet days: no Friday flourish. */
export function bandTitleKey(d: Pick<Daypart, 'key' | 'friday'>, quiet: boolean, ramadan: RamadanPhase | null = null): BandTitleKey {
  if (ramadan) return `home.ramadan_band.${ramadan}`;
  return `home.band.${!quiet && isFridayLunch(d) ? 'friday_lunch' : d.key}`;
}

/**
 * Dish words for the band, most typical first. The server returns only real dishes whose name starts
 * with one of them, from kitchens open now (`catalog.picks`) — the words never invent a dish.
 */
const BAND_WORDS: Record<DaypartKey | 'friday_lunch', readonly string[]> = {
  dawn: ['باچة', 'كاهي', 'قيمر', 'بيض', 'مخلمة', 'تشريب', 'منقوشة', 'فلافل', 'چاي'],
  lunch: ['تمن', 'قوزي', 'دولمة', 'مرق', 'وجبة', 'دجاج', 'مشكّل'],
  friday_lunch: ['مشكّل', 'قوزي', 'كيلو', 'دولمة', 'وجبة', 'تمن'],
  asr: ['فلافل', 'منقوشة', 'لحم بعجين', 'شاورما', 'لفة', 'عصير'],
  dinner: ['كباب', 'تكة', 'مشكّل', 'شاورما', 'شيش', 'كبد'],
  late: ['شاورما', 'فلافل', 'لفة', 'عربي شاورما', 'منقوشة', 'كباب'],
};

/** Ramadan's dishes: iftar's all day (the last hours too), sweets and tea after it, suhoor's at night. */
const RAMADAN_WORDS: Record<RamadanPhase, readonly string[]> = {
  fast: ['شوربة', 'تمر', 'دولمة', 'تمن', 'مرق', 'كبة', 'سمبوسة', 'لبن', 'عصير'],
  iftar_soon: ['شوربة', 'تمر', 'دولمة', 'تمن', 'مرق', 'كبة', 'سمبوسة', 'لبن', 'عصير'],
  after_iftar: ['زلابية', 'بقلاوة', 'كنافة', 'داطلي', 'حلاوة', 'محلبي', 'چاي', 'عصير', 'آيس'],
  suhoor: ['كاهي', 'قيمر', 'بيض', 'لبن', 'جبن', 'تمر', 'فلافل', 'منقوشة'],
};

export function bandWords(d: Pick<Daypart, 'key' | 'friday'>, ramadan: RamadanPhase | null = null): readonly string[] {
  if (ramadan) return RAMADAN_WORDS[ramadan];
  return BAND_WORDS[isFridayLunch(d) ? 'friday_lunch' : d.key];
}

/**
 * The day's pots lead the hour's food at meal times only; at other hours they follow its dishes. In
 * Ramadan they lead in the day (the iftar pot), stay out of the sweets after iftar, and follow suhoor's.
 */
export function potPlace(d: Pick<Daypart, 'key'>, ramadan: RamadanPhase | null = null): PotPlace {
  if (ramadan) return ramadan === 'after_iftar' ? 'none' : ramadan === 'suhoor' ? 'after' : 'first';
  return d.key === 'lunch' || d.key === 'dinner' ? 'first' : 'after';
}

/** Cuisine words that suit each daypart, in order (the kitchens' own cuisine lines). */
const CUISINE_ORDER: Record<DaypartKey, readonly string[]> = {
  dawn: ['باچة', 'ريوگ', 'فطور', 'مناقيش', 'فلافل'],
  lunch: ['تمن ومرق', 'مشويات', 'دجاج', 'كباب'],
  asr: ['فلافل', 'مناقيش', 'شاورما'],
  dinner: ['كباب', 'تكة', 'مشويات', 'شاورما', 'كبد'],
  late: ['شاورما', 'فلافل', 'كباب', 'تكة'],
};

/**
 * The cuisine circles in daypart order: words that suit the hour first (in that order), the rest
 * after them as they were. Matching is folded (باچة = باجه).
 */
export function orderForDaypart(terms: readonly string[], key: DaypartKey): string[] {
  const prefs = CUISINE_ORDER[key].map(foldArabic);
  const rank = (term: string) => {
    const f = foldArabic(term);
    const i = prefs.findIndex((p) => f === p || f.startsWith(p));
    return i === -1 ? prefs.length : i;
  };
  return terms
    .map((term, i) => ({ term, i, r: rank(term) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.term);
}

/** Kitchen tags that suit each daypart, in order. */
const KITCHEN_TAGS: Record<DaypartKey, readonly string[]> = {
  dawn: ['breakfast', 'pacha', 'pastry'],
  lunch: ['rice', 'stew', 'grill', 'chicken'],
  asr: ['falafel', 'pastry', 'shawarma', 'sandwiches'],
  dinner: ['grill', 'kebab', 'tikka', 'shawarma'],
  late: ['shawarma', 'falafel', 'sandwiches'],
};

/** Lower = shows earlier at this hour (the first of the kitchen's tags that suits it). */
export function kitchenRank(tags: readonly string[], key: DaypartKey): number {
  const prefs = KITCHEN_TAGS[key];
  const hits = tags.map((t) => prefs.indexOf(t)).filter((i) => i >= 0);
  return hits.length > 0 ? Math.min(...hits) : prefs.length;
}

/** The band shows only with at least this many real dishes (idea 4-1 risk: never a thin, odd row). */
export const BAND_MIN_DISHES = 2;
export const BAND_MAX_DISHES = 3;
