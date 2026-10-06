import { SEASON_MAX_DAYS, type PublicSeason, type SeasonDayTimes, type SeasonHomeCard, type SeasonKind, type Timetable, type TimetableTimes } from '@driver/contracts';
import { localDateKey } from '../../shared/local-time.js';
import type { QuietRecord } from './controls.repository.js';
import { formatHhMm, iftarTimes, type IftarOverrides } from './prayer-times.js';
import { SEASON_RULES, type SeasonRules } from './season.config.js';

/**
 * The season system's thinking (customer joy J6), pure: which periods cover a Baghdad day, what
 * the apps may do (`composeSeason`), when offers wait (`promoHold`), and what a new period must
 * satisfy (`checkNewSeason`). `ControlsService` loads the rows, caches and audits.
 *
 * Precedence: a quiet day wins every switch (and hides festive cards) but never hides the Ramadan
 * times, which are service. Among the others Eid > a special Friday > Ramadan for the switches;
 * the home card prefers Ramadan's (the countdown is useful on a day both communities share).
 */

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const LOUD: PublicSeason = { quiet: false, celebrations: true, sounds: true, promos: true, quietUntil: null, kind: 'ordinary', accent: true, ramadan: null, homeCard: null };
const SWITCH_ORDER: readonly SeasonKind[] = ['eid', 'friday_special', 'ramadan'];

/** The calendar day after a YYYY-MM-DD (UTC date arithmetic: no time zone involved). */
export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

function inPlace(r: QuietRecord, cityId: string | undefined): boolean {
  return r.cityId === null || !cityId || r.cityId === cityId;
}

/** Live periods covering `day` in this city, by kind (the longest-running first, as J1a). */
function covering(rows: readonly QuietRecord[], day: string, cityId: string | undefined): Map<SeasonKind, QuietRecord> {
  const found = new Map<SeasonKind, QuietRecord>();
  const live = rows.filter((r) => !r.clearedAt && r.startsOn <= day && day <= r.endsOn && inPlace(r, cityId)).sort((a, b) => b.endsOn.localeCompare(a.endsOn));
  for (const r of live) if (!found.has(r.kind)) found.set(r.kind, r);
  return found;
}

function placeOf(cityId: string | undefined, rules: SeasonRules) {
  return (cityId ? rules.places[cityId] : undefined) ?? rules.defaultPlace;
}

/** Both timetables' times for "now" in a Ramadan period. */
function ramadanTimes(period: QuietRecord, now: Date, cityId: string | undefined, rules: SeasonRules): Record<Timetable, TimetableTimes> {
  const day = localDateKey(now);
  const opts = { place: placeOf(cityId, rules), shiaOffsetMin: period.shiaOffsetMin, overrides: period.iftarOverrides, rules };
  const today = iftarTimes(day, opts);
  const tomorrowDay = nextDay(day);
  const tomorrow = tomorrowDay <= period.endsOn ? iftarTimes(tomorrowDay, opts) : null;
  const one = (tt: Timetable): TimetableTimes => ({
    iftarAt: today[tt].iftarAt,
    suhoorUntil: now < today[tt].fajrAt ? today[tt].fajrAt : (tomorrow?.[tt].fajrAt ?? null),
    slotAt: new Date(today[tt].iftarAt.getTime() - rules.iftarSlotLeadMin * MINUTE_MS),
  });
  return { sunni: one('sunni'), shia: one('shia') };
}

function cardOf(r: QuietRecord | undefined): SeasonHomeCard | null {
  if (!r || r.kind === 'quiet' || !r.homeCard) return null;
  if (r.kind === 'friday_special' && !r.homeCardAr) return null;
  return { kind: r.kind, text_ar: r.homeCardAr };
}

export interface ComposeInput {
  rows: readonly QuietRecord[];
  now: Date;
  cityId?: string | undefined;
  timetable?: Timetable | undefined;
  rules?: SeasonRules;
}

/** What an open app may do now, and what it may show (`system.season`). */
export function composeSeason({ rows, now, cityId, timetable, rules = SEASON_RULES }: ComposeInput): PublicSeason {
  const day = localDateKey(now);
  const on = covering(rows, day, cityId);
  const quiet = on.get('quiet');
  const ramadanRow = on.get('ramadan');
  const lead = SWITCH_ORDER.map((k) => on.get(k)).find((r) => r !== undefined);

  let ramadan: PublicSeason['ramadan'] = null;
  if (ramadanRow) {
    const timetables = ramadanTimes(ramadanRow, now, cityId, rules);
    const picked = timetable ? timetables[timetable] : null;
    ramadan = { day, timetable: timetable ?? null, iftarAt: picked?.iftarAt ?? null, suhoorUntil: picked?.suhoorUntil ?? null, timetables };
  }
  // On a quiet day only the Ramadan card (calm, useful) may stay.
  const homeCard = quiet ? cardOf(ramadanRow) : (cardOf(ramadanRow) ?? cardOf(on.get('eid')) ?? cardOf(on.get('friday_special')));

  if (quiet) return { quiet: true, celebrations: false, sounds: false, promos: false, quietUntil: quiet.endsOn, kind: 'quiet', accent: false, ramadan, homeCard };
  if (!lead) return { ...LOUD, ramadan, homeCard };
  return { quiet: false, celebrations: lead.celebrations, sounds: lead.sounds, promos: lead.promos, quietUntil: null, kind: lead.kind, accent: lead.accent, ramadan, homeCard };
}

/** Why an offer may not go out now: suppressed (quiet day, a season with offers off) or held until after iftar. */
export type PromoHold = { reason: 'quiet_day' } | { reason: 'season' } | { reason: 'iftar'; until: Date };

/**
 * The notify engine's gate for `marketing` deliveries. Offers wait from `promoHoldBeforeIftarMin`
 * before the earliest timetable's iftar until the latest one, so nobody fasting gets food offers in
 * the last minutes (research 6 §5), whichever timetable they follow.
 */
export function promoHold({ rows, at, cityId, rules = SEASON_RULES }: { rows: readonly QuietRecord[]; at: Date; cityId?: string | undefined; rules?: SeasonRules }): PromoHold | null {
  const s = composeSeason({ rows, now: at, cityId, rules });
  if (s.quiet) return { reason: 'quiet_day' };
  if (!s.promos) return { reason: 'season' };
  if (s.ramadan) {
    const iftars = [s.ramadan.timetables.sunni.iftarAt.getTime(), s.ramadan.timetables.shia.iftarAt.getTime()];
    const from = Math.min(...iftars) - rules.promoHoldBeforeIftarMin * MINUTE_MS;
    const until = Math.max(...iftars);
    if (at.getTime() >= from && at.getTime() < until) return { reason: 'iftar', until: new Date(until) };
  }
  return null;
}

/** What a new period asks for (the input's season fields). */
export interface NewSeason {
  kind: SeasonKind;
  startsOn: string;
  endsOn: string;
  cityId?: string | null | undefined;
  celebrations?: boolean | undefined;
  sounds?: boolean | undefined;
  promos?: boolean | undefined;
  accent?: boolean | undefined;
  homeCard?: boolean | undefined;
  homeCardAr?: string | null | undefined;
  shiaOffsetMin?: number | null | undefined;
}

/** Whole days from one YYYY-MM-DD to another, inclusive of both. */
function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** A new period's problem, or null. `live` = periods not cleared that end today or later. */
export function checkNewSeason(input: NewSeason, today: string, live: readonly QuietRecord[]): 'season_invalid' | 'season_overlap' | null {
  if (input.startsOn < today || input.endsOn < input.startsOn || spanDays(input.startsOn, input.endsOn) > SEASON_MAX_DAYS[input.kind]) return 'season_invalid';
  if (input.kind === 'quiet' && input.homeCardAr) return 'season_invalid';
  if (input.kind === 'friday_special' && input.homeCard === true && !input.homeCardAr) return 'season_invalid';
  if (input.kind === 'quiet') return null;
  const city = input.cityId ?? null;
  const clash = live.some(
    (r) => !r.clearedAt && r.kind === input.kind && r.startsOn <= input.endsOn && input.startsOn <= r.endsOn && (r.cityId === null || city === null || r.cityId === city),
  );
  return clash ? 'season_overlap' : null;
}

/** The stored switches of a new period: quiet forces everything off; the others default on. */
export function normalizeSeason(input: Omit<NewSeason, 'startsOn' | 'endsOn'>): Pick<QuietRecord, 'kind' | 'celebrations' | 'sounds' | 'promos' | 'accent' | 'homeCard' | 'homeCardAr' | 'shiaOffsetMin'> {
  if (input.kind === 'quiet') return { kind: 'quiet', celebrations: false, sounds: false, promos: false, accent: false, homeCard: false, homeCardAr: null, shiaOffsetMin: null };
  const text = input.homeCardAr ?? null;
  return {
    kind: input.kind,
    celebrations: input.celebrations ?? true,
    sounds: input.sounds ?? true,
    promos: input.promos ?? true,
    accent: input.accent ?? true,
    homeCard: input.kind === 'friday_special' ? (input.homeCard ?? true) && text !== null : (input.homeCard ?? true),
    homeCardAr: text,
    shiaOffsetMin: input.kind === 'ramadan' ? (input.shiaOffsetMin ?? null) : null,
  };
}

/** Arabic names of the kinds, as the audit log says them. */
export const SEASON_KIND_AR: Record<SeasonKind, string> = { quiet: 'أيام هدوء', ramadan: 'رمضان', eid: 'العيد', friday_special: 'جمعة خاصة' };
/** Neutral names of the timetables (never one "the" time). */
export const TIMETABLE_AR: Record<Timetable, string> = { sunni: 'توقيت أهل السنة', shia: 'توقيت الشيعة' };

/** The overrides with one day's time on one timetable set (or removed with null); empty days drop out. */
export function withIftarOverride(overrides: IftarOverrides, day: string, timetable: Timetable, time: string | null): IftarOverrides {
  const next: IftarOverrides = { ...overrides };
  const entry: Partial<Record<Timetable, string>> = { ...overrides[day] };
  if (time) entry[timetable] = time;
  else delete entry[timetable];
  if (Object.keys(entry).length > 0) next[day] = entry;
  else delete next[day];
  return next;
}

/** Every day of a Ramadan period on both timetables (Console); empty for other kinds. */
export function seasonDays(r: QuietRecord, cityId?: string, rules: SeasonRules = SEASON_RULES): SeasonDayTimes[] {
  if (r.kind !== 'ramadan') return [];
  const opts = { place: placeOf(cityId ?? r.cityId ?? undefined, rules), shiaOffsetMin: r.shiaOffsetMin, overrides: r.iftarOverrides, rules };
  const out: SeasonDayTimes[] = [];
  for (let day = r.startsOn; day <= r.endsOn; day = nextDay(day)) {
    const t = iftarTimes(day, opts);
    out.push({
      day,
      sunni: { iftar: formatHhMm(t.sunni.iftarAt), suhoor: formatHhMm(t.sunni.fajrAt), overridden: t.sunni.overridden },
      shia: { iftar: formatHhMm(t.shia.iftarAt), suhoor: formatHhMm(t.shia.fajrAt), overridden: t.shia.overridden },
    });
  }
  return out;
}
