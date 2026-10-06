import type { PublicSeason, RamadanToday, Timetable, TimetableTimes } from '@driver/contracts';

const MINUTE_MS = 60_000;

/** Today's times on the person's timetable; null outside Ramadan or before they pick (never assumed). */
export function timesFor(ramadan: RamadanToday | null, pick: Timetable | null): TimetableTimes | null {
  return ramadan && pick ? ramadan.timetables[pick] : null;
}

/** What the Ramadan card says right now. */
export type RamadanLine = { kind: 'iftar'; minutes: number; at: Date } | { kind: 'suhoor'; at: Date } | { kind: 'none' };

/**
 * Before dawn: suhoor until fajr. In the day: the countdown to iftar (whole minutes, rounded up so it
 * never reads 0 before the adhan). After iftar: suhoor until tomorrow's fajr. On the last evening
 * (no suhoor) nothing more than the greeting.
 */
export function ramadanLine(times: TimetableTimes, now: Date): RamadanLine {
  const suhoor = times.suhoorUntil;
  if (suhoor && now < suhoor && suhoor < times.iftarAt) return { kind: 'suhoor', at: suhoor };
  if (now < times.iftarAt) return { kind: 'iftar', minutes: Math.ceil((times.iftarAt.getTime() - now.getTime()) / MINUTE_MS), at: times.iftarAt };
  if (suhoor && now < suhoor) return { kind: 'suhoor', at: suhoor };
  return { kind: 'none' };
}

/** The home card, decided from the season and the person's pick. */
export type SeasonCardModel =
  | { kind: 'ramadan'; title: string | null; accent: boolean; line: RamadanLine | 'pick' }
  | { kind: 'eid'; title: string | null; accent: boolean }
  | { kind: 'friday_special'; title: string; accent: boolean };

/** Null when today has no card (ordinary days, quiet days without Ramadan). `title` null = the app's words. */
export function seasonCard(season: PublicSeason, pick: Timetable | null, now: Date): SeasonCardModel | null {
  const card = season.homeCard;
  if (!card) return null;
  if (card.kind === 'ramadan') {
    if (!season.ramadan) return null;
    const times = timesFor(season.ramadan, pick);
    return { kind: 'ramadan', title: card.text_ar, accent: season.accent, line: times ? ramadanLine(times, now) : 'pick' };
  }
  if (card.kind === 'eid') return { kind: 'eid', title: card.text_ar, accent: season.accent };
  return card.text_ar ? { kind: 'friday_special', title: card.text_ar, accent: season.accent } : null;
}

/** A delivery time offered at checkout; `iftar` marks the «على الفطور» slot. */
export interface CheckoutSlot {
  at: Date;
  iftar: boolean;
}

/**
 * The schedule list with the iftar slot (the server's `slotAt`, a little before the adhan) in time
 * order, when it is at least `leadMin` away. A half-hour slot at the same minute becomes the iftar one.
 */
export function withIftarSlot(slots: readonly Date[], times: TimetableTimes | null, now: Date, leadMin: number): CheckoutSlot[] {
  const plain = slots.map((at) => ({ at, iftar: false }));
  if (!times || times.slotAt.getTime() - now.getTime() < leadMin * MINUTE_MS) return plain;
  const rest = plain.filter((s) => s.at.getTime() !== times.slotAt.getTime());
  return [...rest, { at: times.slotAt, iftar: true }].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** How long before the adhan the iftar slot arrives, in whole minutes. */
export function iftarLeadMinutes(times: TimetableTimes): number {
  return Math.round((times.iftarAt.getTime() - times.slotAt.getTime()) / MINUTE_MS);
}
