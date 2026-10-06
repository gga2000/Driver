import type { GuaranteeWindowView } from '@driver/contracts';
import { formatClock, pluralKey, type MessageKey } from '@driver/i18n';
import { amountParam } from '@/lib/money';

/**
 * G-91 shift guarantee lines (audit S-3 goal-gradient, S-4 summary), pure. Every number is the
 * server's (`driverAccount.guarantee` / `shiftSummary.guarantee`): how many jobs are left, whether
 * acceptance or cancels already rule the shift out, what was earned and when it is paid. Nothing is
 * a target the server did not set, and nothing shows when the shift earns nothing. Plain Node
 * (unit-tested).
 */

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export type GuaranteeTone = 'progress' | 'warning' | 'earned' | 'paid';

export interface GuaranteeLine {
  id: string;
  text: string;
  tone: GuaranteeTone;
}

const PEAK_KEY: Record<string, MessageKey> = {
  day: 'partner.guarantee_peak_day',
  evening: 'partner.guarantee_peak_evening',
};

/**
 * Ali's shifts (2026-10-06): "شفت النهار" (06:00–15:00) / "شفت الليل" (15:00–02:00); any other
 * configured shift reads "الشفت".
 */
export function peakName(peak: string, t: T): string {
  return t(PEAK_KEY[peak] ?? 'partner.guarantee_peak_other');
}

/**
 * The one line a shift gets, or null. Live: out on cancels (it cannot come back) → says so; below
 * the acceptance line → the line and his number (he can still recover); jobs missing → "باقي طلبين";
 * all met → topped up by Sunday unless he already earned above the amount. Ended: only a real
 * top-up (waiting for Sunday, or paid); a shift that earned nothing shows nothing.
 */
export function guaranteeLine(w: GuaranteeWindowView, t: T): GuaranteeLine | null {
  const rule = w.rule;
  const peak = peakName(w.peak, t);
  const amount = amountParam(rule.amountIqd);
  if (w.status === 'paid') return w.topUpIqd > 0 ? { id: w.id, tone: 'paid', text: t('partner.guarantee_paid', { peak, amount: amountParam(w.topUpIqd) }) } : null;
  if (w.status === 'ended') return w.qualified && w.topUpIqd > 0 ? { id: w.id, tone: 'earned', text: t('partner.guarantee_pending', { peak, amount: amountParam(w.topUpIqd) }) } : null;
  if (!w.meets.cancels) return { id: w.id, tone: 'warning', text: t('partner.guarantee_lost_cancels', { peak, max: rule.maxCancelsAfterAccept }) };
  if (w.acceptance !== null && !w.meets.acceptance) {
    return { id: w.id, tone: 'warning', text: t('partner.guarantee_acceptance', { peak, min: Math.round(rule.minAcceptance * 100), pct: Math.floor(w.acceptance * 100 + 1e-9) }) };
  }
  if (w.jobsToGo > 0) return { id: w.id, tone: 'progress', text: t(pluralKey('partner.guarantee_to_go', w.jobsToGo), { peak, amount, n: w.jobsToGo }) };
  if (!w.qualified) return null;
  if (w.earningsIqd >= rule.amountIqd) return { id: w.id, tone: 'earned', text: t('partner.guarantee_above', { peak, amount }) };
  return { id: w.id, tone: 'progress', text: t('partner.guarantee_secured', { peak, amount, time: formatClock(w.to) }) };
}

/** The shift summary's lines: one per guarantee shift it overlapped that has something to say, oldest first. */
export function guaranteeLines(windows: readonly GuaranteeWindowView[], t: T): GuaranteeLine[] {
  return windows.map((w) => guaranteeLine(w, t)).filter((l): l is GuaranteeLine => l !== null);
}
