/**
 * Baghdad local calendar helpers (Asia/Baghdad is UTC+3 all year, no DST). Used where a rule is
 * stated in local days: "sold out today" resets at the next local midnight, daily check-in, earnings
 * by day / week (Sunday start, the Iraqi work week and the payout day) / month.
 */
export const BAGHDAD_OFFSET_MIN = 180;

const DAY_MS = 86_400_000;

function shift(at: Date, offsetMin: number): Date {
  return new Date(at.getTime() + offsetMin * 60_000);
}

/** `2026-10-03` for the local day containing `at`. */
export function localDateKey(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): string {
  return shift(at, offsetMin).toISOString().slice(0, 10);
}

/** UTC instant of the local midnight starting the day that contains `at`. */
export function startOfLocalDay(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): Date {
  const local = shift(at, offsetMin);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnight - offsetMin * 60_000);
}

export function nextLocalMidnight(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): Date {
  return new Date(startOfLocalDay(at, offsetMin).getTime() + DAY_MS);
}

/** 0 = Sunday … 6 = Saturday, local. */
export function localDow(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): number {
  return shift(at, offsetMin).getUTCDay();
}

export function localHour(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): number {
  return shift(at, offsetMin).getUTCHours();
}

/** Local minutes since midnight. */
export function localMinutes(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): number {
  const l = shift(at, offsetMin);
  return l.getUTCHours() * 60 + l.getUTCMinutes();
}

/** Sunday 00:00 local of the week containing `at`. */
export function startOfLocalWeek(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): Date {
  const day = startOfLocalDay(at, offsetMin);
  return new Date(day.getTime() - localDow(at, offsetMin) * DAY_MS);
}

/** The first Sunday 00:00 local strictly after `at` ("consequences apply the following Sunday"). */
export function nextLocalSunday(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): Date {
  return new Date(startOfLocalWeek(at, offsetMin).getTime() + 7 * DAY_MS);
}

export function startOfLocalMonth(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): Date {
  const local = shift(at, offsetMin);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - offsetMin * 60_000);
}

export function startOfNextLocalMonth(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): Date {
  const local = shift(at, offsetMin);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - offsetMin * 60_000);
}

/** [from, to) of the local day / Sunday-start week / month containing `at`. */
export function localPeriod(period: 'day' | 'week' | 'month', at: Date, offsetMin = BAGHDAD_OFFSET_MIN): { from: Date; to: Date } {
  if (period === 'day') {
    const from = startOfLocalDay(at, offsetMin);
    return { from, to: new Date(from.getTime() + DAY_MS) };
  }
  if (period === 'week') {
    const from = startOfLocalWeek(at, offsetMin);
    return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
  }
  return { from: startOfLocalMonth(at, offsetMin), to: startOfNextLocalMonth(at, offsetMin) };
}
