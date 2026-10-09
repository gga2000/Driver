import type { ActivityEntry, MerchantDaySummary } from '@driver/contracts';
import type { TKey } from '@/lib/i18n-core';
import { clock12 } from '@/lib/time';

/**
 * S-M6 · the end-of-day card (UI/UX audit merchant-and-console §8), free of React Native so it is
 * unit-tested: when the board shows it, its four facts, the advice line and the image it shares.
 * The numbers come from the server (`merchantAdmin.daySummary`); nothing here computes money.
 */

export const DAY_DISMISSED_KEY = 'driver.merchant.day_dismissed';
const KEEP = 14;

/** One card per store and day: "تمام" hides it on this device. */
export function dayCardKey(merchantOrgId: string, localDate: string): string {
  return `${merchantOrgId}:${localDate}`;
}

export function parseDismissed(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-KEEP) : [];
  } catch {
    return [];
  }
}

export function addDismissed(list: readonly string[], key: string): string[] {
  return [...list.filter((k) => k !== key), key].slice(-KEEP);
}

/** The board shows the card when the server says it is due and this device hasn't said "تمام". */
export function showDayCard(s: Pick<MerchantDaySummary, 'merchantOrgId' | 'localDate' | 'due'> | undefined, dismissed: readonly string[]): boolean {
  return Boolean(s?.due) && !dismissed.includes(dayCardKey(s!.merchantOrgId, s!.localDate));
}

export interface DayFact {
  key: 'orders' | 'missed' | 'on_time' | 'net';
  label: TKey;
  /** What the fact says, ready for `t()`: a counted phrase or an amount. */
  value: { key: TKey; params: Record<string, number> } | { amountIqd: number };
  tone: 'text' | 'danger' | 'success' | 'muted';
  /** The one bold number of the card. */
  hero?: boolean;
}

/** "42 طلب · فاتك 0 · وقتك مضبوط 91% · الصافي 512,000 دينار" as four facts (the net only for the owner). */
export function dayFacts(s: Pick<MerchantDaySummary, 'orders' | 'missed' | 'onTimeShare' | 'netIqd'>): DayFact[] {
  const out: DayFact[] = [
    { key: 'orders', label: 'merchant.day.orders_label', value: { key: 'merchant.day.orders', params: { count: s.orders } }, tone: 'text' },
    { key: 'missed', label: 'merchant.day.missed_label', value: { key: 'merchant.day.missed', params: { count: s.missed } }, tone: s.missed > 0 ? 'danger' : 'success' },
  ];
  if (s.onTimeShare !== null) {
    const pct = Math.round(s.onTimeShare * 100);
    out.push({ key: 'on_time', label: 'merchant.day.on_time_label', value: { key: 'merchant.day.on_time', params: { percent: pct } }, tone: pct >= 75 ? 'success' : 'danger' });
  } else {
    out.push({ key: 'on_time', label: 'merchant.day.on_time_label', value: { key: 'merchant.day.on_time_none', params: {} }, tone: 'muted' });
  }
  if (s.netIqd !== null) out.push({ key: 'net', label: 'merchant.day.net_label', value: { amountIqd: s.netIqd }, tone: 'text', hero: true });
  return out;
}

const ADVICE: Record<NonNullable<MerchantDaySummary['advice']>['kind'], TKey> = {
  missed: 'merchant.day.advice_missed',
  prep_late: 'merchant.day.advice_prep_late',
  prep_uneven: 'merchant.day.advice_prep_uneven',
  prep_early: 'merchant.day.advice_prep_early',
  rejected: 'merchant.day.advice_rejected',
  honest: 'merchant.day.advice_honest',
};

/** The one advice line (Insights' verdicts on the day's own numbers), or null. */
export function adviceLine(a: MerchantDaySummary['advice']): { key: TKey; params: Record<string, number> } | null {
  if (!a) return null;
  const params: Record<string, number> = {};
  if (a.minutes !== null) params['minutes'] = a.minutes;
  if (a.percent !== null) params['percent'] = a.percent;
  return { key: ADVICE[a.kind], params };
}

/** The calendar day before `YYYY-MM-DD` (pure date arithmetic, no time zone). */
export function dayBefore(localDate: string): string {
  const d = new Date(`${localDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * "اليوم" at close; "البارحة" when the card shows after midnight for the day that ended — and only
 * when it really is the day before the shop's own today (day-one d01: `todayKey` is the Baghdad day of
 * the server clock). Any other day gets no word, just its date (null), never a wrong «البارحة».
 */
export function dayTitleKey(s: Pick<MerchantDaySummary, 'reason' | 'localDate'>, todayKey: string): TKey | null {
  if (s.localDate === todayKey) return 'merchant.day.title_today';
  if (s.localDate === dayBefore(todayKey)) return 'merchant.day.title_yesterday';
  return null;
}

/**
 * Day-one d01: where the day's card goes on the board. While orders wait it is one line
 * («البارحة: 35 طلب ›», the full card a tap away), never on top of the orders; the full card only when
 * the shop is closed (or outside its hours) or nothing is waiting.
 */
export function dayCardMode(p: { show: boolean; waiting: number; closed: boolean }): 'none' | 'line' | 'full' {
  if (!p.show) return 'none';
  return p.closed || p.waiting === 0 ? 'full' : 'line';
}

// ───────────────────────── «منو سوّى شنو» (owner only) ─────────────────────────

type Translate = (key: TKey, params?: Record<string, string | number>) => string;

/** Rows shown before «شوف الكل». */
export const ACTIVITY_COLLAPSED = 8;

/** «انت» for the viewer, «تلقائي» for what the system did, «موظف سابق» when the name is gone. */
export function activityWho(e: Pick<ActivityEntry, 'who'>, t: Translate): string {
  if (!e.who) return t('merchant.activity.auto');
  if (e.who.you) return t('merchant.activity.you');
  return e.who.name ?? t('merchant.activity.former');
}

const REJECT_REASON_LABEL: Readonly<Record<string, TKey>> = {
  sold_out: 'merchant.reject.reason_sold_out',
  too_busy: 'merchant.reject.reason_busy',
  busy: 'merchant.reject.reason_busy',
  closed: 'merchant.reject.reason_closed',
};

/** A stored reject reason in the kitchen's words: the sheet's choices, or what was typed for «غيره». */
export function rejectReasonText(reason: string | null, t: Translate): string | null {
  if (!reason) return null;
  const label = REJECT_REASON_LABEL[reason];
  if (label) return t(label);
  if (reason.startsWith('other:')) return reason.slice('other:'.length).trim() || null;
  return null;
}

/** What happened, without who: «رفض #6347 (زحمة)», «خلص اليوم: كص». */
export function activityAction(e: ActivityEntry, t: Translate): string {
  const number = e.orderNumber ?? '';
  const dish = e.dishName ?? t('merchant.activity.dish_unknown');
  switch (e.kind) {
    case 'accept':
      return t('merchant.activity.do_accept', { number });
    case 'auto_accept':
      return t('merchant.activity.do_auto_accept', { number });
    case 'partial':
      return t('merchant.activity.do_partial', { number });
    case 'reject': {
      const reason = rejectReasonText(e.reason, t);
      return reason ? t('merchant.activity.do_reject_reason', { number, reason }) : t('merchant.activity.do_reject', { number });
    }
    case 'auto_reject':
      return t('merchant.activity.do_auto_reject', { number });
    case 'ready':
      return t('merchant.activity.do_ready', { number });
    case 'extend':
      return t('merchant.activity.do_extend', { number });
    case 'hand_over':
      return t('merchant.activity.do_hand_over', { number });
    case 'sold_out':
      return e.until ? t('merchant.activity.do_sold_out_today', { dish }) : t('merchant.activity.do_sold_out', { dish });
    case 'back_on':
      return t('merchant.activity.do_back_on', { dish });
  }
}

export interface ActivityRow {
  key: string;
  who: string;
  action: string;
  time: string;
  /** «منتظر · رفض #6347 · 9:41 م»: the row as one line (screen readers, tests). */
  line: string;
  /** What the system did by itself reads quieter. */
  auto: boolean;
}

/** The feed's rows, as the server ordered them (newest first). */
export function activityRows(entries: readonly ActivityEntry[], t: Translate): ActivityRow[] {
  return entries.map((e, i) => {
    const who = activityWho(e, t);
    const action = activityAction(e, t);
    const time = clock12(e.at);
    return { key: `${e.at.getTime()}:${e.kind}:${e.orderId ?? e.dishName ?? ''}:${i}`, who, action, time, line: `${who} · ${action} · ${time}`, auto: e.who === null };
  });
}

/** Collapsed after `ACTIVITY_COLLAPSED` rows until «شوف الكل». */
export function visibleActivity<T>(rows: readonly T[], expanded: boolean): { rows: readonly T[]; hidden: number } {
  if (expanded || rows.length <= ACTIVITY_COLLAPSED) return { rows, hidden: 0 };
  return { rows: rows.slice(0, ACTIVITY_COLLAPSED), hidden: rows.length - ACTIVITY_COLLAPSED };
}

const WHO_KEY: Record<Exclude<ActivityEntry['kind'], 'sold_out' | 'back_on'>, TKey> = {
  accept: 'merchant.who.accept',
  auto_accept: 'merchant.who.auto_accept',
  partial: 'merchant.who.partial',
  reject: 'merchant.who.reject',
  auto_reject: 'merchant.who.auto_reject',
  ready: 'merchant.who.ready',
  extend: 'merchant.who.extend',
  hand_over: 'merchant.who.hand_over',
};

/**
 * The order sheet's one muted line, «قبله منتظر 9:32 م · جهّزه علي 9:51 م» (oldest first). Owner
 * only: null for staff (the server refuses them anyway) and when nothing was pressed yet.
 */
export function orderWhoLine(entries: readonly ActivityEntry[] | undefined, owner: boolean, t: Translate): string | null {
  if (!owner || !entries) return null;
  const parts: string[] = [];
  for (const e of entries) {
    if (e.kind === 'sold_out' || e.kind === 'back_on') continue;
    parts.push(t(WHO_KEY[e.kind], { who: activityWho(e, t), time: clock12(e.at) }));
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
