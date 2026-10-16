import type { DayHours } from '@driver/contracts';
import { WEEK_ORDER } from '@/features/hours/logic';

export interface WeekRun {
  /** First and last day of the run (0 = Sunday), Saturday-first like the hours screen. */
  from: number;
  to: number;
  shifts: DayHours['shifts'];
}

const sameShifts = (a: DayHours['shifts'], b: DayHours['shifts']) => a.length === b.length && a.every((s, i) => s.start === b[i]!.start && s.end === b[i]!.end);

/**
 * The week in a few lines for the top of المحل (h3): days in a row with the same hours fold into one
 * line, «السبت–الخميس · 12 الظهر – 12 بالليل», then «الجمعة · 1:15 الظهر – 12 بالليل». Pure, tested.
 */
export function weekRuns(days: readonly DayHours[]): WeekRun[] {
  const out: WeekRun[] = [];
  for (const dow of WEEK_ORDER) {
    const shifts = days.find((d) => d.dow === dow)?.shifts ?? [];
    const last = out.at(-1);
    if (last && sameShifts(last.shifts, shifts)) last.to = dow;
    else out.push({ from: dow, to: dow, shifts });
  }
  return out;
}
