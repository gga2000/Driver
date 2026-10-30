import type { CustomerFilter, CustomerSegment, PhoneRevealReason, ProfileSignal, StoryItem } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import type { ChipTone } from '@/components/ui';
import { formatIqd } from './format';

/**
 * «الناس» (Ali 2026-10-21): the words and small sums behind the customers list and the customer and
 * driver profiles. Keys are built from enum values with their whole prefix named, so the strings
 * subset keeps exactly these groups (scripts/locale-subset.mjs).
 */

export const CUSTOMER_FILTERS: readonly CustomerFilter[] = ['all', 'new', 'regular', 'lapsed', 'issue', 'frozen'];
export const REVEAL_REASONS: readonly PhoneRevealReason[] = ['call_about_order', 'call_back', 'safety', 'account_help'];

export const filterLabel = (f: CustomerFilter) => t(`console.ppl_filter_${f}` as MessageKey);
export const segmentLabel = (s: CustomerSegment) => t(`console.ppl_seg_${s}` as MessageKey);
export const revealReasonLabel = (r: PhoneRevealReason) => t(`console.ppl_reason_${r}` as MessageKey);
export const storyKindLabel = (k: StoryItem['kind']) => t(`console.ppl_story_kind_${k}` as MessageKey);

const SEGMENT_TONE: Record<CustomerSegment, ChipTone> = {
  frozen: 'bad',
  issue: 'bad',
  new: 'live',
  regular: 'ready',
  active: 'done',
  lapsed: 'warn',
  quiet: 'neutral',
};
export const segmentTone = (s: CustomerSegment): ChipTone => SEGMENT_TONE[s];

/** «+96477*****44» (identity's mask) as people read a number here: «077•••••44». */
export function localMasked(masked: string | null): string | null {
  if (!masked) return null;
  return masked.replace(/^\+964/, '0').replace(/\*/g, '•');
}

/** A whole E.164 number as dialled in Iraq: «0770 123 4567». */
export function localPhone(e164: string): string {
  const local = e164.replace(/^\+964/, '0');
  return local.length === 11 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : local;
}

/** «9 بالليل», «12 الظهر», «7 الصبح» for a Baghdad hour 0–23. */
export function hourWords(h: number): string {
  const n = h % 12 === 0 ? 12 : h % 12;
  const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 15 ? 'noon' : h < 19 ? 'evening' : 'night';
  return t(`console.ppl_hour_${part}` as MessageKey, { n });
}

/** One sentence per signal for «شنو لازم تعرف». */
export function signalText(s: ProfileSignal): string {
  switch (s.key) {
    case 'late_orders':
      return t('console.ppl_sig_late_orders', { n: s.n ?? 0 });
    case 'credits':
      return t('console.ppl_sig_credits', { n: s.n ?? 0, amount: formatIqd(s.iqd ?? 0) });
    case 'cancels_high':
      return t('console.ppl_sig_cancels_high', { pct: s.n ?? 0 });
    case 'rates_well':
      return t('console.ppl_sig_rates_well', { avg: ((s.n ?? 0) / 10).toFixed(1) });
    case 'rates_low':
      return t('console.ppl_sig_rates_low', { avg: ((s.n ?? 0) / 10).toFixed(1) });
    case 'peak_hour':
      return t('console.ppl_sig_peak_hour', { from: hourWords(s.n ?? 0), to: hourWords(((s.n ?? 0) + 2) % 24) });
    case 'open_ticket':
      return t('console.ppl_sig_open_ticket', { n: s.n ?? 0 });
    case 'lapsed':
      return t('console.ppl_sig_lapsed', { n: s.n ?? 0 });
    case 'new_customer':
      return t('console.ppl_sig_new_customer');
    case 'frozen':
      return t('console.ppl_sig_frozen');
  }
}

/** Scale `values` to bar heights 0–`max` px (a non-zero value is never thinner than 2 px). */
export function barHeights(values: readonly number[], max: number): number[] {
  const top = Math.max(...values, 0);
  return values.map((v) => (top === 0 || v === 0 ? 0 : Math.max(2, Math.round((v / top) * max))));
}

/** One of 5 saffron steps (0 = empty) for a heat cell. */
export function heatStep(v: number, top: number): 0 | 1 | 2 | 3 | 4 {
  if (v <= 0 || top <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((v / top) * 4))) as 1 | 2 | 3 | 4;
}

/** Up / down against a reference, rounded, for a stat's delta line; null when there is nothing to compare. */
export function versus(value: number | null, ref: number | null): number | null {
  if (value === null || ref === null || ref === 0) return null;
  return Math.round(((value - ref) / ref) * 100);
}

/** «كل 6 يوم», or «أقل من يوم» for someone who orders several times a day. */
export function everyText(days: number): string {
  return days < 1 ? t('console.ppl_every_less') : t('console.ppl_every_days', { n: Math.round(days) });
}
