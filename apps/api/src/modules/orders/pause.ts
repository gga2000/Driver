/**
 * Per-merchant scheduled pause windows (edge-case review A.1): prayer defaults seeded by city
 * (Friday 11:45–13:15), shown as "مغلق مؤقتاً" on the card. Orders cannot be placed inside a
 * window, and an auto-reject that fires inside one does not count against the merchant's score.
 */
export interface PauseWindow {
  /** 0 = Sunday … 5 = Friday, 6 = Saturday — local time. */
  dow: number;
  /** "HH:MM" local, inclusive. */
  start: string;
  /** "HH:MM" local, exclusive; may be before `start` to wrap midnight. */
  end: string;
  reason?: string;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local day-of-week and minute-of-day at `at` in `timeZone`. */
export function localDowMinutes(at: Date, timeZone: string): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { dow: DOW[get('weekday')] ?? at.getUTCDay(), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** The window `at` falls in, if any. */
export function activePauseWindow(at: Date, windows: readonly PauseWindow[], timeZone: string): PauseWindow | null {
  const { dow, minutes } = localDowMinutes(at, timeZone);
  for (const w of windows) {
    const s = toMinutes(w.start);
    const e = toMinutes(w.end);
    if (s <= e) {
      if (w.dow === dow && minutes >= s && minutes < e) return w;
    } else if ((w.dow === dow && minutes >= s) || ((w.dow + 1) % 7 === dow && minutes < e)) {
      return w;
    }
  }
  return null;
}
