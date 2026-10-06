import { usualBandOf, type TodayPot, type Usual, type UsualBand } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { cityDayStart, insideHours, preorderSlots, type OpeningWindow } from '@/features/food/slots';
import { baghdadClock } from './daypart';

/**
 * Food habits on home (joy J7a) as plain data: which usual fits the hour («طلبك المعتاد؟»), whether
 * the «غدا الجمعة» card shows and for which slot, how a usual explains itself, and which of today's
 * pots the «العزيزية اليوم» strip draws. The server decides what a usual is (`orders.usuals`); here
 * only the clock is read (injected).
 */

const MIN = 60_000;
const THURSDAY = 4;
const FRIDAY = 5;
/** Thursday from this hour, the card offers tomorrow (Friday). */
export const FRIDAY_CARD_FROM_THURSDAY_HOUR = 16;
/** Friday until this hour, the card offers today. */
export const FRIDAY_CARD_UNTIL_FRIDAY_HOUR = 11;
/** Friday morning starts here (before it, it is still Thursday night out in town). */
const FRIDAY_MORNING_HOUR = 4;
/** Half-hour slots searched for the Friday booking. */
const FRIDAY_SLOTS = 48;

/** The usual that fits now: same band, and the same weekday for a weekday usual (those first). */
export function usualNow(usuals: readonly Usual[], now: Date): Usual | null {
  const c = baghdadClock(now);
  const band = usualBandOf(c.hour);
  return usuals.find((u) => u.kind === 'weekday' && u.weekday === c.dow && u.band === band) ?? usuals.find((u) => u.kind === 'band' && u.band === band) ?? null;
}

/** «غدا الجمعة»: Thursday from 16:00 offers tomorrow (1), Friday 04:00–11:00 offers today (0); otherwise none. */
export function fridayDay(now: Date): 0 | 1 | null {
  const c = baghdadClock(now);
  if (c.dow === THURSDAY && c.hour >= FRIDAY_CARD_FROM_THURSDAY_HOUR) return 1;
  if (c.dow === FRIDAY && c.hour >= FRIDAY_MORNING_HOUR && c.hour < FRIDAY_CARD_UNTIL_FRIDAY_HOUR) return 0;
  return null;
}

export interface FridaySlot {
  at: Date;
  /** The usual time fell in a pause (Friday prayer), so the slot moved past it. */
  movedForPrayer: boolean;
}

/**
 * The Friday half-hour nearest the usual's time that the kitchen can take: inside its hours, outside
 * its pause windows, at least the pre-order lead away. On a tie the later one (after prayer, not before).
 */
export function fridaySlot(now: Date, day: 0 | 1, atMinute: number, hours: readonly OpeningWindow[], pauses: readonly OpeningWindow[]): FridaySlot | null {
  const slots = preorderSlots(now, hours, day, { count: FRIDAY_SLOTS, pauses });
  if (slots.length === 0) return null;
  const target = cityDayStart(now, day).getTime() + atMinute * MIN;
  let best = slots[0]!;
  for (const s of slots) {
    const d = Math.abs(s.getTime() - target);
    const b = Math.abs(best.getTime() - target);
    if (d < b || (d === b && s.getTime() > best.getTime())) best = s;
  }
  return { at: best, movedForPrayer: pauses.length > 0 && insideHours(FRIDAY, atMinute, pauses) };
}

export interface FridayAhead {
  usual: Usual;
  day: 0 | 1;
  slot: FridaySlot;
}

/**
 * The «غدا الجمعة» card: only in its window, only for a Friday usual (lunch first, then the most
 * frequent), and only when its kitchen has a slot. `kitchen` gives the kitchen's hours and pauses
 * (from the restaurant list); unknown kitchens are skipped.
 */
export function fridayAhead(usuals: readonly Usual[], now: Date, kitchen: (merchantOrgId: string) => { hours: readonly OpeningWindow[]; pauses: readonly OpeningWindow[] } | null): FridayAhead | null {
  const day = fridayDay(now);
  if (day === null) return null;
  const friday = usuals
    .filter((u) => u.kind === 'weekday' && u.weekday === FRIDAY && (day === 1 || u.atMinute * MIN > now.getTime() - cityDayStart(now, 0).getTime()))
    .sort((a, b) => Number(b.band === 'lunch') - Number(a.band === 'lunch') || b.times - a.times);
  for (const usual of friday) {
    const k = usual.row.order.merchantOrgId ? kitchen(usual.row.order.merchantOrgId) : null;
    if (!k) continue;
    const slot = fridaySlot(now, day, usual.atMinute, k.hours, k.pauses);
    if (slot) return { usual, day, slot };
  }
  return null;
}

/** «مرتين» · «3 مرات» · «11 مرة» (natural Iraqi counts, like the minute forms). */
export function timesKey(n: number): MessageKey {
  if (n === 2) return 'usual.times_two';
  if (n >= 3 && n <= 10) return 'usual.times_few';
  return 'usual.times_many';
}

const WEEKDAY_KEYS: readonly MessageKey[] = ['usual.day_0', 'usual.day_1', 'usual.day_2', 'usual.day_3', 'usual.day_4', 'usual.day_5', 'usual.day_6'];
const BAND_KEYS: Readonly<Record<UsualBand, MessageKey>> = { morning: 'usual.band_morning', lunch: 'usual.band_lunch', evening: 'usual.band_evening', late: 'usual.band_late' };

/** Why the app thinks so («طلبته 3 مرات يوم الجمعة» / «طلبته مرتين وقت الغدا»): a usual always explains itself. */
export function usualReason(u: Pick<Usual, 'kind' | 'weekday' | 'band' | 'times'>): { key: MessageKey; times: MessageKey; when: MessageKey } {
  return {
    key: 'usual.reason',
    times: timesKey(u.times),
    when: u.kind === 'weekday' && u.weekday !== null ? WEEKDAY_KEYS[u.weekday]! : BAND_KEYS[u.band],
  };
}

/** The Friday card's question: breakfast, lunch or dinner by the usual's band. */
const FRIDAY_TITLES: Readonly<Record<'today' | 'tomorrow', Readonly<Record<'breakfast' | 'lunch' | 'dinner', MessageKey>>>> = {
  tomorrow: { breakfast: 'friday.title_tomorrow_breakfast', lunch: 'friday.title_tomorrow_lunch', dinner: 'friday.title_tomorrow_dinner' },
  today: { breakfast: 'friday.title_today_breakfast', lunch: 'friday.title_today_lunch', dinner: 'friday.title_today_dinner' },
};

export function fridayTitleKey(day: 0 | 1, band: UsualBand): MessageKey {
  const meal = band === 'morning' ? 'breakfast' : band === 'lunch' ? 'lunch' : 'dinner';
  return FRIDAY_TITLES[day === 1 ? 'tomorrow' : 'today'][meal];
}

/** «العزيزية اليوم»: the pots of kitchens open now, as the server orders them (at most `max`). */
export function visiblePots(pots: readonly TodayPot[] | undefined, max = 6): TodayPot[] {
  return (pots ?? []).filter((p) => p.restaurantOpen).slice(0, max);
}

/** «لحد 4:00 م»: a pot's "HH:MM" as today's instant, for the city's clock format. */
export function potUntilAt(until: string, now: Date): Date {
  const [h, m] = until.split(':').map(Number);
  return new Date(cityDayStart(now, 0).getTime() + ((h ?? 0) * 60 + (m ?? 0)) * MIN);
}
