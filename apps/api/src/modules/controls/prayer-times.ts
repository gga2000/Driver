import type { Timetable } from '@driver/contracts';
import { BAGHDAD_OFFSET_MIN } from '../../shared/local-time.js';
import { SEASON_RULES, type PrayerPlace } from './season.config.js';

/**
 * Iftar (maghrib) and suhoor (fajr) times for Ramadan mode (customer joy J6, research 6 E3).
 *
 * Method: the standard low-precision solar position (the USNO almanac formulas also used by
 * praytimes.org): mean anomaly and mean longitude from days since J2000, ecliptic longitude,
 * obliquity, right ascension → equation of time and declination. The hour angle at which the sun's
 * centre is `angle` degrees below the horizon gives each event; solar noon = 12 h − equation of time
 * − longitude/15. Three fixed-point passes evaluate the sun at the event itself. Accuracy is about a
 * minute, well inside the rounding below. Sunset uses 0.833° (refraction + the sun's semidiameter).
 *
 * Asia/Baghdad is UTC+3 all year (no DST), so a Baghdad date maps to fixed UTC instants.
 */

const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const SUNSET_ANGLE_DEG = 0.833;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const sin = (d: number) => Math.sin(d * DEG);
const cos = (d: number) => Math.cos(d * DEG);
const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Declination (degrees) and equation of time (hours) at Julian day `jd`. */
function sunPosition(jd: number): { decl: number; eqtH: number } {
  const d = jd - J2000;
  const g = mod(357.529 + 0.98560028 * d, 360);
  const q = mod(280.459 + 0.98564736 * d, 360);
  const l = mod(q + 1.915 * sin(g) + 0.02 * sin(2 * g), 360);
  const e = 23.439 - 0.00000036 * d;
  const raH = mod(Math.atan2(cos(e) * sin(l), cos(l)) / DEG / 15, 24);
  const eqtH = mod(q / 15 - raH + 12, 24) - 12;
  const decl = Math.asin(sin(e) * sin(l)) / DEG;
  return { decl, eqtH };
}

/** UTC hours (from the date's 0h UTC) when the sun is `angle`° below the horizon; `dir` −1 morning, +1 evening. */
function eventUtcHours(jd0: number, place: PrayerPlace, angle: number, dir: -1 | 1, guessH: number): number {
  let h = guessH;
  for (let pass = 0; pass < 3; pass++) {
    const { decl, eqtH } = sunPosition(jd0 + h / 24);
    const noon = 12 - eqtH - place.lng / 15;
    const cosH = (-sin(angle) - sin(decl) * sin(place.lat)) / (cos(decl) * cos(place.lat));
    // Never outside [-1, 1] at Iraq's latitudes; clamped so a far-north city can't yield NaN.
    h = noon + (dir * Math.acos(Math.min(1, Math.max(-1, cosH)))) / DEG / 15;
  }
  return h;
}

/** Fajr, sunrise and sunset (exact instants) on a Baghdad calendar day. */
export function solarDay(day: string, place: PrayerPlace, fajrAngleDeg: number): { fajr: Date; sunrise: Date; sunset: Date } {
  const midnightUtc = Date.parse(`${day}T00:00:00Z`);
  const jd0 = midnightUtc / DAY_MS + 2440587.5;
  const at = (h: number) => new Date(midnightUtc + h * 3_600_000);
  // Guesses in UTC hours: fajr ≈ 02, sunrise ≈ 03–04, sunset ≈ 14–15 for UTC+3.
  return {
    fajr: at(eventUtcHours(jd0, place, fajrAngleDeg, -1, 2)),
    sunrise: at(eventUtcHours(jd0, place, SUNSET_ANGLE_DEG, -1, 3.5)),
    sunset: at(eventUtcHours(jd0, place, SUNSET_ANGLE_DEG, 1, 14.5)),
  };
}

/** Ops overrides of the iftar time: `{ "YYYY-MM-DD": { shia: "17:57" } }`, Baghdad wall clock. */
export type IftarOverrides = Record<string, Partial<Record<Timetable, string>>>;

export interface IftarOptions {
  place?: PrayerPlace;
  /** A Ramadan period's own Shia offset; null/absent = the rules' default. */
  shiaOffsetMin?: number | null;
  overrides?: IftarOverrides;
  rules?: Pick<typeof SEASON_RULES, 'maghribOffsetMin' | 'fajrAngleDeg' | 'defaultPlace'>;
}

export interface DayTimes {
  iftarAt: Date;
  fajrAt: Date;
  /** Iftar comes from an ops override, not the sun. */
  overridden: boolean;
}

const ceilMinute = (d: Date) => new Date(Math.ceil(d.getTime() / MINUTE_MS) * MINUTE_MS);
const floorMinute = (d: Date) => new Date(Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS);

/** The UTC instant of "HH:MM" Baghdad time on `day`. */
export function baghdadAt(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.parse(`${day}T00:00:00Z`) + (h * 60 + m - BAGHDAD_OFFSET_MIN) * MINUTE_MS);
}

/** "17:39": the Baghdad wall clock of an instant (24 h, for the Console and logs). */
export function formatHhMm(d: Date): string {
  return new Date(d.getTime() + BAGHDAD_OFFSET_MIN * MINUTE_MS).toISOString().slice(11, 16);
}

/**
 * Iftar and fajr on both timetables for one Baghdad day. Iftar = sunset + the timetable's offset,
 * rounded UP to the minute (never early to break the fast); fajr is rounded DOWN (never late to stop
 * eating). An ops override replaces one timetable's iftar on that day only.
 */
export function iftarTimes(day: string, opts: IftarOptions): Record<Timetable, DayTimes> {
  const rules = opts.rules ?? SEASON_RULES;
  const place = opts.place ?? rules.defaultPlace;
  const offsets: Record<Timetable, number> = { sunni: rules.maghribOffsetMin.sunni, shia: opts.shiaOffsetMin ?? rules.maghribOffsetMin.shia };
  const one = (tt: Timetable): DayTimes => {
    const sun = solarDay(day, place, rules.fajrAngleDeg[tt]);
    const override = opts.overrides?.[day]?.[tt];
    return {
      iftarAt: override ? baghdadAt(day, override) : ceilMinute(new Date(sun.sunset.getTime() + offsets[tt] * MINUTE_MS)),
      fajrAt: floorMinute(sun.fajr),
      overridden: Boolean(override),
    };
  };
  return { sunni: one('sunni'), shia: one('shia') };
}
