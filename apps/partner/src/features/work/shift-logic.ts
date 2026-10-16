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
  key: 'jobs' | 'online' | 'tips' | 'best' | 'km';
  label: string;
  value: string;
  sub?: string;
}

/**
 * The stat tiles in reading order: jobs, time online, tips (only when there were some), best hour
 * (only with jobs). Tips are a real ledger line, so "0" is hidden rather than shown as a gap.
 */
export function shiftStats(s: ShiftSummary, t: T, opts: { wholeDay?: boolean } = {}): ShiftStat[] {
  const out: ShiftStat[] = [{ key: 'jobs', label: t('partner.shiftsum_jobs'), value: String(s.jobs) }];
  // «يومك» (e7) counts from midnight: that is not time he worked, so no "time online" there.
  if (!opts.wholeDay) out.push({ key: 'online', label: t('partner.shiftsum_online'), value: formatDuration(s.onlineMinutes * 60_000) });
  // «يومك» (e7): straight-line km between the stops; the road is never shorter, so «أكثر من».
  if (s.minKm !== null && s.minKm > 0) out.push({ key: 'km', label: t('partner.e5_km'), value: t('partner.e5_km_value', { km: s.minKm }) });
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
  /** «الزبائن قالوا عني: «سريع»» — the word customers picked most this shift (e7); null without one. */
  quote: string | null;
  tag: string;
}

export function shareCardModel(s: ShiftSummary, t: T, now: Date = new Date(), opts: { wholeDay?: boolean } = {}): ShareCardModel {
  return {
    title: t('partner.shiftsum_share_caption'),
    date: opts.wholeDay ? formatDay(s.to, now) : `${formatDay(s.to, now)} · ${shiftRange(s, t)}`,
    net: amountParam(s.netIqd),
    currency: t('quote.currency'),
    perHour: s.perHourIqd !== null && !opts.wholeDay ? t('partner.shiftsum_per_hour', { amount: amountParam(s.perHourIqd) }) : null,
    // Three columns: jobs, the km when known, then the best hour (or time online).
    stats: shiftStats(s, t, opts)
      .filter((x) => x.key !== 'tips' && !(x.key === 'online' && s.minKm !== null && s.minKm > 0 && s.bestHour))
      .map((x) => ({ label: x.label, value: x.value })),
    quote: s.compliments[0] ? t('partner.e5_share_quote', { word: t(`compliment.${s.compliments[0].key}`) }) : null,
    tag: t('partner.shiftsum_brand_tag'),
  };
}

/** The file name the picture is saved under on the web: `driver-day-2026-10-05.png` (Baghdad date). */
export function shareFileName(s: Pick<ShiftSummary, 'to'>): string {
  const local = new Date(s.to.getTime() + 180 * 60_000).toISOString().slice(0, 10);
  return `driver-day-${local}.png`;
}
