import { CITY_UTC_OFFSET_MIN } from '@driver/i18n';
import type { MessageKey } from '@driver/i18n';
import type { ChipTone } from '@/components/ui';
import { formatClock, formatDayClock } from '@/lib/format';

/**
 * Console › المناوبة: the roster form picks a day and a shift in Aziziyah time (UTC+3 all year; Iraq
 * has no daylight saving). The two working shifts are the ones Ali named on 2026-10-06 (06:00–15:00,
 * 15:00–02:00); a whole day covers a Friday or Saturday with one person.
 */
export type ShiftPreset = 'morning' | 'evening' | 'day';

export const SHIFT_PRESETS: readonly ShiftPreset[] = ['morning', 'evening', 'day'];
export const PRESET_KEY: Record<ShiftPreset, MessageKey> = {
  morning: 'console.oncall_preset_morning',
  evening: 'console.oncall_preset_evening',
  day: 'console.oncall_preset_day',
};
/** Start hour and length, Aziziyah time. */
const PRESET_HOURS: Record<ShiftPreset, { start: number; hours: number }> = {
  morning: { start: 6, hours: 9 },
  evening: { start: 15, hours: 11 },
  day: { start: 6, hours: 24 },
};

/** `2026-10-09` (the date input's value) and a preset → the shift's start and end instants. */
export function shiftWindow(
  day: string,
  preset: ShiftPreset,
): { startsAt: Date; endsAt: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const { start, hours } = PRESET_HOURS[preset];
  const startsAt = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), start) - CITY_UTC_OFFSET_MIN * 60_000,
  );
  return { startsAt, endsAt: new Date(startsAt.getTime() + hours * 3_600_000) };
}

/** Today's date in Aziziyah as the date input wants it. */
export function cityToday(now: Date): string {
  return new Date(now.getTime() + CITY_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** `7/10 · 6:00 ص – 3:00 م`; the end carries its own day when the shift runs past midnight. */
export function shiftSpan(startsAt: Date, endsAt: Date): string {
  const sameDay = cityToday(startsAt) === cityToday(new Date(endsAt.getTime() - 1));
  return `${formatDayClock(startsAt)} – ${sameDay ? formatClock(endsAt) : formatDayClock(endsAt)}`;
}

export type ShiftState = 'now' | 'later' | 'over' | 'removed';
export const STATE_KEY: Record<ShiftState, MessageKey> = {
  now: 'console.oncall_state_now',
  later: 'console.oncall_state_later',
  over: 'console.oncall_state_over',
  removed: 'console.oncall_state_removed',
};
export const STATE_TONE: Record<ShiftState, ChipTone> = {
  now: 'live',
  later: 'neutral',
  over: 'done',
  removed: 'done',
};

export function shiftState(
  s: { startsAt: Date; endsAt: Date; endedAt: Date | null },
  now: Date,
): ShiftState {
  if (s.endedAt) return 'removed';
  if (s.endsAt.getTime() <= now.getTime()) return 'over';
  if (s.startsAt.getTime() > now.getTime()) return 'later';
  return 'now';
}

export const DESK_KEY: Record<'sos' | 'cash', MessageKey> = {
  sos: 'console.oncall_desk_sos',
  cash: 'console.oncall_desk_cash',
};
export const RANK_KEY: Record<number, MessageKey> = {
  1: 'console.oncall_rank_1',
  2: 'console.oncall_rank_2',
};
