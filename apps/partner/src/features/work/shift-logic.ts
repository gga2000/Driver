import type { ShiftSummary } from '@driver/contracts';
import { formatClock, formatDay, formatDuration, pluralKey, type MessageKey } from '@driver/i18n';
import { clockLabel, windowLabel } from '@/features/intercity/logic';
import { amountParam } from '@/lib/money';

/**
 * End of shift (audit S-4), pure: the words and numbers the summary screen and the shared picture
 * show. Every number is the server's (`driverAccount.shiftSummary`); this only arranges them on the
 * city's clock. Plain Node (unit-tested).
 */

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** "من 3:00 م لـ 7:00 م · 4 ساعات" */
export function shiftRange(s: Pick<ShiftSummary, 'from' | 'to' | 'onlineMinutes'>, t: T): string {
  return t('partner.shiftsum_range', { from: formatClock(s.from), to: formatClock(s.to), duration: formatDuration(s.onlineMinutes * 60_000) });
}

export interface ShiftStat {
  key: 'jobs' | 'online' | 'tips' | 'best';
  label: string;
  value: string;
  sub?: string;
}

/**
 * The stat tiles in reading order: jobs, time online, tips (only when there were some), best hour
 * (only with jobs). Tips are a real ledger line, so "0" is hidden rather than shown as a gap.
 */
export function shiftStats(s: ShiftSummary, t: T): ShiftStat[] {
  const out: ShiftStat[] = [
    { key: 'jobs', label: t('partner.shiftsum_jobs'), value: String(s.jobs) },
    { key: 'online', label: t('partner.shiftsum_online'), value: formatDuration(s.onlineMinutes * 60_000) },
  ];
  if (s.tipsIqd > 0) out.push({ key: 'tips', label: t('partner.shiftsum_tips'), value: `${amountParam(s.tipsIqd)} ${t('quote.currency')}` });
  if (s.bestHour) {
    out.push({
      key: 'best',
      label: t('partner.shiftsum_best_hour'),
      // The hour's start only ("10:00 ص"): a "10:00–11:00 ص" range flips in an RTL tile and wraps its ص.
      value: clockLabel(s.bestHour.from),
      sub: t('partner.shiftsum_best_hour_sub', { amount: amountParam(s.bestHour.netIqd) }),
    });
  }
  return out;
}

/** "اليوم كله: 15,000 دينار · 7 طلبات" — only when the day holds more than this shift. */
export function dayLine(s: ShiftSummary, t: T): string | null {
  if (s.day.jobs === s.jobs && s.day.netIqd === s.netIqd) return null;
  // The count is {n}, not the amount before it: pick the form by the jobs.
  return t(pluralKey('partner.shiftsum_day', s.day.jobs), { amount: amountParam(s.day.netIqd), n: s.day.jobs });
}

/** "أكثر طلبات بين 1:00 و3:00 م" */
export function tomorrowLine(s: ShiftSummary, t: T): string | null {
  if (!s.tomorrow) return null;
  const [from, to] = windowLabel(s.tomorrow.from, s.tomorrow.to).split('–');
  return t('partner.shiftsum_tomorrow', { from: from ?? '', to: to ?? '' });
}

/** What the shared picture says, top to bottom (the same numbers as the screen). */
export interface ShareCardModel {
  title: string;
  date: string;
  net: string;
  currency: string;
  perHour: string | null;
  stats: Array<{ label: string; value: string }>;
  tag: string;
}

export function shareCardModel(s: ShiftSummary, t: T, now: Date = new Date()): ShareCardModel {
  return {
    title: t('partner.shiftsum_share_caption'),
    date: `${formatDay(s.to, now)} · ${shiftRange(s, t)}`,
    net: amountParam(s.netIqd),
    currency: t('quote.currency'),
    perHour: s.perHourIqd !== null ? t('partner.shiftsum_per_hour', { amount: amountParam(s.perHourIqd) }) : null,
    stats: shiftStats(s, t)
      .filter((x) => x.key !== 'tips')
      .map((x) => ({ label: x.label, value: x.value })),
    tag: t('partner.shiftsum_brand_tag'),
  };
}

/** The file name the picture is saved under on the web: `driver-day-2026-10-05.png` (Baghdad date). */
export function shareFileName(s: Pick<ShiftSummary, 'to'>): string {
  const local = new Date(s.to.getTime() + 180 * 60_000).toISOString().slice(0, 10);
  return `driver-day-${local}.png`;
}
