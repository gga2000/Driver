import { CAP_DANGER_SHARE, CAP_WARN_SHARE, capState } from '@driver/contracts';
import type {
  DocumentsView,
  DriverDocumentKind,
  DriverDocumentStatus,
  DriverDocumentView,
  EarningsJobLine,
  EarningsPeriod,
  EarningsView,
  MainPhotoView,
  PartnerOnlineGate,
  ScoreMetric,
} from '@driver/contracts';
import { formatClock, formatRange, type Locale, type MessageKey } from '@driver/i18n';
import { pluralForm } from '@/features/work/logic';

/**
 * Pure rules behind the driver-account screens (الأرباح, التقييم, المستمسكات, التسجيل اليومي).
 * Plain Node, no React Native: unit-tested in logic.test.ts.
 */

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

// ───────────────────────── Baghdad local calendar ─────────────────────────

/** Asia/Baghdad is UTC+3 all year (no DST); the API's periods are cut on the same clock. */
export const BAGHDAD_OFFSET_MS = 3 * 3_600_000;
export const DAY_MS = 86_400_000;

export interface LocalParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

export function local(at: Date): LocalParts {
  const d = new Date(at.getTime() + BAGHDAD_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() };
}

/** Local midnight (as a UTC instant) of the day containing `at`. */
export function startOfLocalDay(at: Date): Date {
  const shifted = at.getTime() + BAGHDAD_OFFSET_MS;
  return new Date(shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - BAGHDAD_OFFSET_MS);
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime();
}

/**
 * 12-hour Baghdad clock with ص/م, Western digits: `7:30 م`, `12:05 ص` — the same as every other time in
 * the app (check-up item 8, Ali 2026-10-09: one way to say a time).
 */
export function clockTime(at: Date, locale: Locale = 'ar-IQ'): string {
  return formatClock(at, { locale });
}

/** 12-hour label of an hour of the day for chart ticks: 0 → 12, 13 → 1. */
export function hour12(hour: number): number {
  return hour % 12 === 0 ? 12 : hour % 12;
}

/** "3 تشرين الأول" */
export function dayMonth(at: Date, t: T): string {
  const p = local(at);
  return t('partner.date_day_month', { day: p.day, month: t(`partner.month_${p.month}` as MessageKey) });
}

export function weekdayName(at: Date, t: T, short = false): string {
  return t(`partner.weekday_${short ? 'short_' : ''}${local(at).weekday}` as MessageKey);
}

// ───────────────────────── earnings periods ─────────────────────────

/** "اليوم" · "أمس" · "الخميس 1 تشرين الأول" · "هالأسبوع" · "27 أيلول – 3 تشرين الأول" · "هالشهر" · "آب". */
export function rangeLabel(period: EarningsPeriod, range: { from: Date; to: Date }, now: Date, t: T): string {
  const from = range.from.getTime();
  if (period === 'day') {
    const today = startOfLocalDay(now).getTime();
    if (from === today) return t('partner.earn_range_today');
    if (from === today - DAY_MS) return t('partner.earn_range_yesterday');
    const p = local(range.from);
    return t('partner.earn_range_day', { weekday: weekdayName(range.from, t), day: p.day, month: t(`partner.month_${p.month}` as MessageKey) });
  }
  if (period === 'week') {
    const today = startOfLocalDay(now).getTime();
    const thisWeek = today - local(now).weekday * DAY_MS;
    if (from === thisWeek) return t('partner.earn_range_this_week');
    if (from === thisWeek - 7 * DAY_MS) return t('partner.earn_range_last_week');
    // Low end on the right in Arabic: «13 أيلول – 19 أيلول» reads 13 first.
    return formatRange(dayMonth(range.from, t), dayMonth(new Date(range.to.getTime() - 1), t), undefined, { spaced: true });
  }
  const f = local(range.from);
  const n = local(now);
  const monthsAgo = (n.year - f.year) * 12 + (n.month - f.month);
  if (monthsAgo === 0) return t('partner.earn_range_this_month');
  if (monthsAgo === 1) return t('partner.earn_range_last_month');
  const name = t(`partner.month_${f.month}` as MessageKey);
  return f.year === n.year ? name : `${name} ${f.year}`;
}

/** An instant inside the period before / after `range` (the API takes any anchor inside a period). */
export function prevAnchor(range: { from: Date }): Date {
  return new Date(range.from.getTime() - 1);
}
export function nextAnchor(range: { to: Date }): Date {
  return new Date(range.to.getTime());
}
/** The period still running (no "next" arrow). */
export function isCurrentPeriod(range: { to: Date }, now: Date): boolean {
  return range.to.getTime() > now.getTime();
}

/** Whether the period starting at `start` is the one running now (then the screen follows "now" live). */
export function periodContainsNow(period: EarningsPeriod, start: Date, now: Date): boolean {
  if (start.getTime() > now.getTime()) return false;
  if (period === 'day') return now.getTime() - start.getTime() < DAY_MS;
  if (period === 'week') return now.getTime() - start.getTime() < 7 * DAY_MS;
  const a = local(start);
  const b = local(now);
  return a.year === b.year && a.month === b.month;
}

/** A job line from a real job (trip or order), not a stand-alone adjustment. */
export function isJob(j: Pick<EarningsJobLine, 'tripId' | 'orderId'>): boolean {
  return j.tripId !== null || j.orderId !== null;
}

export interface ChartBucket {
  key: string;
  /** Tick label: hour (12-hour) for a day, short weekday for a week, day of month for a month. */
  tick: string;
  /** Long label for the tooltip ("الخميس", "الساعة 7", "12 تشرين الأول"). */
  label: string;
  amountIqd: number;
  jobs: number;
  from: Date;
}

/**
 * Bars for the earnings chart: hours of the day (from 6, or earlier when he worked earlier), days of
 * the week, or days of the month. Each job's net lands in the local hour/day it happened.
 */
export function chartBuckets(period: EarningsPeriod, range: { from: Date; to: Date }, jobs: readonly Pick<EarningsJobLine, 'at' | 'netIqd' | 'tripId' | 'orderId'>[], t: T): ChartBucket[] {
  const out: ChartBucket[] = [];
  if (period === 'day') {
    const firstHour = Math.min(6, ...jobs.map((j) => local(j.at).hour));
    for (let h = firstHour; h <= 23; h++) {
      out.push({ key: `h${h}`, tick: String(hour12(h)), label: t('partner.earn_hour', { hour: hour12(h) }), amountIqd: 0, jobs: 0, from: new Date(range.from.getTime() + h * 3_600_000) });
    }
    for (const j of jobs) {
      const b = out[local(j.at).hour - firstHour];
      if (!b) continue;
      b.amountIqd += j.netIqd;
      if (isJob(j)) b.jobs += 1;
    }
    return out;
  }
  const days = Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS);
  for (let i = 0; i < days; i++) {
    const from = new Date(range.from.getTime() + i * DAY_MS);
    const p = local(from);
    out.push({
      key: `d${i}`,
      tick: period === 'week' ? weekdayName(from, t, true) : String(p.day),
      label: period === 'week' ? weekdayName(from, t) : dayMonth(from, t),
      amountIqd: 0,
      jobs: 0,
      from,
    });
  }
  for (const j of jobs) {
    const i = Math.floor((startOfLocalDay(j.at).getTime() - range.from.getTime()) / DAY_MS);
    const b = out[i];
    if (!b) continue;
    b.amountIqd += j.netIqd;
    if (isJob(j)) b.jobs += 1;
  }
  return out;
}

export function bestBucket(buckets: readonly ChartBucket[]): ChartBucket | null {
  return buckets.reduce<ChartBucket | null>((best, b) => (b.amountIqd > 0 && (!best || b.amountIqd > best.amountIqd) ? b : best), null);
}

/** Whole-percent change against the previous period; null without a previous figure to compare. */
export function percentChange(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Pay components the ledger books under a generic type but names in its memo (night, rain, batch…). */
const MEMO_PAY_KEY: Record<string, MessageKey> = {
  night: 'partner.pay_night',
  weather: 'partner.pay_weather',
  rain: 'partner.pay_weather',
  peak: 'partner.pay_peak',
  batch_bonus: 'partner.pay_batch_bonus',
  pickup_compensation: 'partner.pay_pickup_compensation',
  rebroadcast_compensation: 'partner.pay_pickup_compensation',
  door_pickup: 'partner.pay_door_pickup',
  wait: 'partner.pay_wait',
};

/**
 * The name a component shows: the ledger's own label (`ledger.line.<type>`), refined by its memo
 * where the memo names the pay ("guarantee:…" → تكملة ضمان الشفت, "night" → إضافة الليل).
 */
export function componentLabel(c: { label_ar: string; memo: string | null }, t: T): string {
  const memo = (c.memo ?? '').split(':')[0] ?? '';
  if (memo === 'guarantee') return t('partner.earn_guarantee_memo');
  const key = MEMO_PAY_KEY[memo];
  return key ? t(key) : c.label_ar;
}

export function componentsKey(n: number): MessageKey {
  return ({ zero: 'partner.earn_components_one', one: 'partner.earn_components_one', few: 'partner.earn_components_few', many: 'partner.earn_components_many' } as const)[pluralForm(n)];
}

/** Last 4 characters of an id, upper-cased: a short reference he can read to support. */
export function shortRef(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
}

/** Breakdown rows of a period's totals, in reading order; empty rows dropped (net always shown). */
export function breakdownRows(totals: EarningsView['totals']): Array<{ key: MessageKey; amountIqd: number; strong?: boolean }> {
  const rows: Array<{ key: MessageKey; amountIqd: number; strong?: boolean }> = [
    { key: 'partner.earn_gross', amountIqd: totals.grossIqd },
    { key: 'partner.earn_tips', amountIqd: totals.tipsIqd },
    { key: 'partner.earn_bonuses', amountIqd: totals.bonusesIqd },
    { key: 'partner.earn_guarantee', amountIqd: totals.guaranteeTopUpsIqd },
    { key: 'partner.earn_take', amountIqd: -totals.takeIqd },
    { key: 'partner.earn_penalties', amountIqd: -totals.penaltiesIqd },
  ];
  return [...rows.filter((r) => r.amountIqd !== 0), { key: 'partner.earn_net', amountIqd: totals.netIqd, strong: true }];
}

// ───────────────────────── the cash cap ─────────────────────────

export type CapTone = 'success' | 'warning' | 'danger';

/**
 * P-05 honest cap colours: green while comfortable, amber from 70 % (the server's near-cap line), red
 * from 90 % and over the cap. `fill` is what counts against the cap (`owedIqd / capIqd`).
 */
export function capTone(cap: Pick<EarningsView['cap'], 'fill' | 'overCap'>): CapTone {
  if (cap.overCap || cap.fill >= CAP_DANGER_SHARE) return 'danger';
  if (cap.fill >= CAP_WARN_SHARE) return 'warning';
  return 'success';
}

export interface CashTruth {
  /** 0–1: what counts against the cap. The bar's length. */
  share: number;
  tone: CapTone;
  over: boolean;
  /** How far past the cap (0 when under). */
  overIqd: number;
  /** How much more before offers stop (0 when over). */
  leftIqd: number;
  /**
   * Why "بيدك" differs from "لازم تسلّم": his own pay rides in the cash he holds (`own`), or he owes
   * commission on top of the cash (`more`). Null when the two are equal.
   */
  heldNote: { kind: 'own' | 'more'; amountIqd: number } | null;
}

/**
 * What he already held before the period: the period's rows (collected, paid to restaurants, handed to
 * us) plus this add up to what he holds now, so the card's sum always closes.
 */
export function cashCarriedIqd(c: { heldIqd: number; collectedIqd: number; toMerchantsIqd: number; settledIqd: number }): number {
  return c.heldIqd - c.collectedIqd + c.toMerchantsIqd + c.settledIqd;
}

/**
 * One cash truth (P-05): "لازم تسلّم" is `owedIqd` (held cash net of what the platform owes him) — the
 * figure the cap counts — on every screen; the colour and the bar come from it alone.
 */
export function cashTruth(c: { owedIqd: number; heldIqd: number; capIqd: number; overCap: boolean }): CashTruth {
  const s = capState(c.owedIqd, c.capIqd, c.overCap);
  const diff = c.heldIqd - c.owedIqd;
  return {
    share: s.share,
    tone: s.tone,
    over: s.over,
    overIqd: s.overIqd,
    leftIqd: s.leftIqd,
    heldNote: diff > 0 ? { kind: 'own', amountIqd: diff } : diff < 0 ? { kind: 'more', amountIqd: -diff } : null,
  };
}

/** The next tier's cap when it is higher than his own (intercity caps are flat). */
export function nextTierCap(cap: Pick<EarningsView['cap'], 'tier' | 'capIqd' | 'byTier'>): { tier: 'silver' | 'gold'; capIqd: number } | null {
  const next = cap.tier === 'bronze' ? 'silver' : cap.tier === 'silver' ? 'gold' : null;
  if (!next || cap.byTier[next] <= cap.capIqd) return null;
  return { tier: next, capIqd: cap.byTier[next] };
}

// ───────────────────────── scorecard ─────────────────────────

/** "85%" for rates, "4.8" for the rating; completion's full mark reads "100%". */
export function metricFormat(key: ScoreMetric['key'], x: number): string {
  // Left-to-right isolate so "85%" keeps its sign after the digits inside Arabic text.
  return key === 'rating' ? x.toFixed(1) : `\u2066${Math.round(x * 100)}%\u2069`;
}

/**
 * Where a value sits on the metric's bar (0–1). The bar spans from a little under the zero mark to the
 * best possible (100 % or 5.0) so the target and the Silver line read as ticks on the same track.
 */
export function metricScale(m: Pick<ScoreMetric, 'key' | 'zeroAt' | 'fullAt'>): { lo: number; hi: number } {
  const hi = m.key === 'rating' ? 5 : 1;
  const lo = Math.max(m.key === 'rating' ? 1 : 0, m.zeroAt - (m.fullAt - m.zeroAt) * 0.6);
  return { lo, hi };
}
export function metricPos(m: Pick<ScoreMetric, 'key' | 'zeroAt' | 'fullAt'>, x: number): number {
  const { lo, hi } = metricScale(m);
  return Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
}

/** Points to the next tier (Silver at 70, Gold at 85 and 100 completed jobs). */
export function nextTierProgress(index: number, completedTrips: number): { key: MessageKey; points: number } | null {
  if (index < 70) return { key: 'partner.score_next_silver', points: 70 - index };
  if (index < 85) return { key: 'partner.score_next_gold', points: 85 - index };
  if (completedTrips < 100) return { key: 'partner.score_gold_trips', points: 0 };
  return null;
}

/** Bronze < 70 · Silver 70–84 · Gold ≥ 85 on the reliability index. */
export const TIER_STEPS = [
  { tier: 'bronze', from: 0, to: 70 },
  { tier: 'silver', from: 70, to: 85 },
  { tier: 'gold', from: 85, to: 100 },
] as const;

/**
 * Where an index sits on the tier track (0–1). The track draws the three tiers as equal steps so
 * each tier's name and cash cap reads whole under its own step (Silver and Gold are only 15 points
 * wide, too narrow for "150,000" on a phone); the marker moves linearly inside its step.
 */
export function tierTrackShare(index: number): number {
  const v = Math.max(0, Math.min(100, index));
  for (const [i, s] of TIER_STEPS.entries()) {
    if (v < s.to || i === TIER_STEPS.length - 1) return (i + (v - s.from) / (s.to - s.from)) / TIER_STEPS.length;
  }
  return 1;
}

/** Month one: day n of 30, share done, days until the card shows (day 31). */
export function observation(dayNumber: number): { day: number; share: number; daysLeft: number } {
  const day = Math.max(1, Math.min(30, dayNumber));
  return { day, share: day / 30, daysLeft: Math.max(1, 31 - dayNumber) };
}

export const METRIC_DESC: Record<ScoreMetric['key'], MessageKey> = {
  acceptance: 'partner.score_desc_acceptance',
  completion: 'partner.score_desc_completion',
  on_time: 'partner.score_desc_on_time',
  rating: 'partner.score_desc_rating',
  cash_return: 'partner.score_desc_cash_return',
};

/** The five components and their targets, for the month-one preview (scoring spec §1). */
export const METRIC_PREVIEW: ReadonlyArray<{ key: ScoreMetric['key']; target: string; weight: number }> = [
  { key: 'acceptance', target: '\u206685%\u2069', weight: 20 },
  { key: 'on_time', target: '\u206690%\u2069', weight: 20 },
  { key: 'completion', target: '\u2066100%\u2069', weight: 15 },
  { key: 'rating', target: '4.8', weight: 15 },
  { key: 'cash_return', target: '\u206695%\u2069', weight: 5 },
];

export const METRIC_NAME: Record<ScoreMetric['key'], MessageKey> = {
  acceptance: 'partner.score_metric_acceptance',
  completion: 'partner.score_metric_completion',
  on_time: 'partner.score_metric_on_time',
  rating: 'partner.score_metric_rating',
  cash_return: 'partner.score_metric_cash_return',
};

// ───────────────────────── documents ─────────────────────────

export type DocRowStatus = DriverDocumentStatus | 'missing';

export interface DocRow {
  kind: DriverDocumentKind;
  doc: DriverDocumentView | null;
  status: DocRowStatus;
  required: boolean;
}

const KIND_ORDER: readonly DriverDocumentKind[] = ['national_id_front', 'national_id_back', 'photo', 'licence', 'vehicle_registration', 'insurance'];
const ALWAYS_REQUIRED: ReadonlySet<DriverDocumentKind> = new Set(['national_id_front', 'national_id_back', 'photo']);
const URGENCY: Record<DocRowStatus, number> = { expired: 0, rejected: 1, missing: 2, expiring: 3, pending: 4, approved: 5 };

/**
 * One row per document kind he has or needs, most urgent first: expired, rejected, missing,
 * expiring, under review, approved. Insurance is never required (an "other" row, offered when absent).
 */
export function documentRows(view: Pick<DocumentsView, 'documents' | 'missing'>): DocRow[] {
  const rows: DocRow[] = [
    ...view.documents.map((d) => ({ kind: d.kind, doc: d, status: d.status as DocRowStatus, required: d.kind !== 'insurance' })),
    ...view.missing.filter((k) => !view.documents.some((d) => d.kind === k)).map((kind) => ({ kind, doc: null, status: 'missing' as const, required: true })),
  ];
  // Insurance is optional: offered as an "other" row until he has one on file.
  if (!rows.some((r) => r.kind === 'insurance')) rows.push({ kind: 'insurance', doc: null, status: 'missing', required: false });
  return rows.sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

export function isAlwaysRequired(kind: DriverDocumentKind): boolean {
  return ALWAYS_REQUIRED.has(kind);
}

export type DocsSummary = 'blocked' | 'action' | 'review' | 'ok';

export function docsSummary(view: Pick<DocumentsView, 'documents' | 'missing' | 'blocksOnline'>): DocsSummary {
  if (view.blocksOnline || view.documents.some((d) => d.status === 'expired')) return 'blocked';
  if (view.missing.length > 0 || view.documents.some((d) => d.status === 'rejected' || d.status === 'expiring')) return 'action';
  if (view.documents.some((d) => d.status === 'pending')) return 'review';
  return 'ok';
}

export const DOC_TONE: Record<DocRowStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  approved: 'success',
  pending: 'info',
  expiring: 'warning',
  rejected: 'danger',
  expired: 'danger',
  missing: 'neutral',
};

export const DOC_STATUS_KEY: Record<DocRowStatus, MessageKey> = {
  approved: 'partner.docs_status_approved',
  pending: 'partner.docs_status_pending',
  expiring: 'partner.docs_status_expiring',
  rejected: 'partner.docs_status_rejected',
  expired: 'partner.docs_status_expired',
  missing: 'partner.docs_status_missing',
};

/** What the row's button does: nothing while it is fine or under review. */
export function docAction(status: DocRowStatus): MessageKey | null {
  if (status === 'missing') return 'partner.docs_upload';
  if (status === 'rejected') return 'partner.docs_reupload';
  if (status === 'expired' || status === 'expiring') return 'partner.docs_renew';
  return null;
}

/** "باقي 12 يوم" · "باقي يوم واحد" · "انتهى اليوم" · "انتهى قبل 3 يوم"; null without an expiry. */
export function expiryText(days: number | null, t: T): string | null {
  if (days === null) return null;
  if (days > 1) return t('partner.docs_days_left', { n: days });
  if (days === 1) return t('partner.docs_day_left');
  if (days === 0) return t('partner.docs_expired_today');
  return t('partner.docs_expired_ago', { n: -days });
}

/** Kinds printed with an expiry date (asked on upload). */
export function hasExpiry(kind: DriverDocumentKind): boolean {
  return kind === 'licence' || kind === 'vehicle_registration' || kind === 'insurance';
}

/** Last day of `month` (1–12) in `year`, as the end of that local day: what "valid until 10/2027" means. */
export function expiryFromMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1) - BAGHDAD_OFFSET_MS - 1);
}

// ───────────────────────── online gate ─────────────────────────

export type GateKind = 'checkin' | 'locked' | 'document';

/** The one thing blocking him, worst first: a lock-out, then an expired document, then the check-in. */
export function gateKind(gate: PartnerOnlineGate | null | undefined): GateKind | null {
  if (!gate || gate.canGoOnline) return null;
  const codes = new Set(gate.reasons.map((r) => r.code));
  if (codes.has('checkin_locked')) return 'locked';
  if (codes.has('document_expired')) return 'document';
  if (codes.has('checkin_required')) return 'checkin';
  return null;
}

/** "m:ss" left on a check-in challenge. */
export function secondsLeftOf(expiresAt: Date, now: number): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now) / 1000));
}

// ───────────────────────── main photo (Ali, 2026-10-06) ─────────────────────────

export type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * The main photo's one-line state for the account row and the photo screen: «تنتظر الموافقة» /
 * «مقبولة» / «مرفوضة: {reason}», or «ما عندك صورة بعد». `short` drops the reason (a pill).
 */
export function mainPhotoStatus(view: MainPhotoView | undefined, t: T, opts: { short?: boolean } = {}): { label: string; tone: PillTone } {
  switch (view?.state) {
    case 'pending':
      return { label: t('partner.mainphoto_state_pending'), tone: 'info' };
    case 'approved':
      return { label: t('partner.mainphoto_state_approved'), tone: 'success' };
    case 'rejected': {
      const reason = view.latest?.rejectReason?.trim();
      return { label: !opts.short && reason ? t('partner.mainphoto_state_rejected', { reason }) : t('partner.mainphoto_state_rejected_short'), tone: 'danger' };
    }
    default:
      return { label: t('partner.mainphoto_state_none'), tone: 'warning' };
  }
}

/** What to say under the photos: what customers see while the latest one is under review or refused. */
export function mainPhotoNote(view: MainPhotoView | undefined): MessageKey {
  if (view?.state === 'pending') return view.approved ? 'partner.mainphoto_pending_keep' : 'partner.mainphoto_pending_first';
  if (view?.state === 'rejected' && view.approved) return 'partner.mainphoto_rejected_keep';
  return view?.approved ? 'partner.mainphoto_customers_see' : 'partner.mainphoto_customers_see_initial';
}

/**
 * Partner redesign r4: «يسوق ويانا من 3 أشهر» on his public page — the same rule the rider's profile
 * uses (whole 30.44-day months; a year from 12). Null without a start date.
 */
export function memberSpan(since: Date | null, now: number): { unit: 'new' | 'months' | 'years'; n: number } | null {
  if (!since) return null;
  const months = Math.floor((now - since.getTime()) / (30.44 * 86_400_000));
  if (months < 1) return { unit: 'new', n: 0 };
  if (months < 12) return { unit: 'months', n: months };
  return { unit: 'years', n: Math.floor(months / 12) };
}

// ───────────────────────── his best (partner redesign e3 / e4 / e5) ─────────────────────────

export type DayPart = 'morning' | 'noon' | 'afternoon' | 'night';

/** Iraqi parts of the day for an hour 0–24: الصبح 4–12, الظهر 12–15, العصر 15–18, بالليل 18–4. */
export function dayPart(hour: number): DayPart {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 4 && h < 12) return 'morning';
  if (h >= 12 && h < 15) return 'noon';
  if (h >= 15 && h < 18) return 'afternoon';
  return 'night';
}

/**
 * «الخميس 7–11 بالليل» / «الجمعة 4 العصر – 8 بالليل»: the weekday and the window on the 12-hour clock,
 * the part of the day said once when both ends share it. The end hour names the part the window
 * reaches into (11 بالليل is the hour that ends at 11).
 */
export function bestWindowLabel(w: { weekday: number; fromHour: number; toHour: number }, t: T, locale: Locale = 'ar-IQ'): string {
  const day = t(`partner.weekday_${w.weekday}` as MessageKey);
  const fromPart = dayPart(w.fromHour);
  const toPart = dayPart(w.toHour - 1);
  const part = (p: DayPart) => t(`partner.best_part_${p}` as MessageKey);
  // formatRange keeps the start on the right in Arabic, whatever surrounds it.
  const range =
    fromPart === toPart
      ? t('partner.best_range_one', { range: formatRange(hour12(w.fromHour), hour12(w.toHour), locale), part: part(fromPart) })
      : t('partner.best_range_two', { range: formatRange(`${hour12(w.fromHour)} ${part(fromPart)}`, `${hour12(w.toHour)} ${part(toPart)}`, locale, { spaced: true }) });
  return `${day} ${range}`;
}

/** The order's tip on a job line (green, e5): the sum of its tip components; 0 without one. */
export function jobTipIqd(job: Pick<EarningsJobLine, 'components'>): number {
  return job.components.filter((c) => c.type === 'tip').reduce((s, c) => s + c.amountIqd, 0);
}

// ───────────────────────── the score in five parts (partner redesign a4 / f6) ─────────────────────────

export interface ScorePart {
  key: ScoreMetric['key'];
  /** Points he has of this part, whole; the five add up to his index. */
  points: number;
  /** What this part is worth of the 100, whole; the parts with data add up to 100. */
  max: number;
  /** No samples yet: the part is left out of the 100 (the server leaves it out of the index too). */
  noData: boolean;
}

/** Whole numbers that add up to `total`, closest to `exact` (largest remainder). */
function apportion(exact: readonly number[], total: number): number[] {
  const floors = exact.map((x) => Math.floor(x));
  let left = total - floors.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i]! += 1;
    left -= 1;
  }
  return floors;
}

/**
 * His index as five parts of 100 (f6): each part's weight over the parts that have data (the server's
 * own formula: index = 100 × Σ score·weight ÷ Σ weight), in whole points that add up exactly — the
 * maxima to 100 and the points to his index. Biggest part first.
 */
export function scoreParts(metrics: readonly Pick<ScoreMetric, 'key' | 'value' | 'score' | 'weight'>[], index: number): ScorePart[] {
  const withData = metrics.filter((m) => m.value !== null);
  const possible = withData.reduce((s, m) => s + m.weight, 0);
  if (possible <= 0) return metrics.map((m) => ({ key: m.key, points: 0, max: 0, noData: true }));
  const maxes = apportion(
    withData.map((m) => (100 * m.weight) / possible),
    100,
  );
  const points = apportion(
    withData.map((m) => (100 * m.score * m.weight) / possible),
    Math.round(index),
  );
  const parts: ScorePart[] = withData.map((m, i) => ({ key: m.key, max: maxes[i]!, points: Math.min(points[i]!, maxes[i]!), noData: false }));
  for (const m of metrics) if (m.value === null) parts.push({ key: m.key, points: 0, max: 0, noData: true });
  return parts.sort((a, b) => Number(a.noData) - Number(b.noData) || b.max - a.max);
}

/**
 * a4: the part that costs him most this week, when it costs 3 points or more; null when nothing does
 * (the card then says he is doing well).
 */
export function weakestPart(parts: readonly ScorePart[]): ScorePart | null {
  let worst: ScorePart | null = null;
  for (const p of parts) if (!p.noData && (!worst || p.max - p.points > worst.max - worst.points)) worst = p;
  return worst && worst.max - worst.points >= 3 ? worst : null;
}

// ───────────────────────── account hub and home papers (partner redesign a1 / a3) ─────────────────────────

/** a3: papers reach home only in their last 14 days (the papers page warns from 30). */
export const HOME_PAPERS_DAYS = 14;

/** a3: the paper that runs out soonest within `HOME_PAPERS_DAYS`, still valid; null when none does. */
export function papersReminder(view: Pick<DocumentsView, 'documents'> | undefined, days = HOME_PAPERS_DAYS): { kind: DriverDocumentKind; days: number } | null {
  let best: { kind: DriverDocumentKind; days: number } | null = null;
  for (const d of view?.documents ?? []) {
    if (d.status !== 'expiring' || d.daysToExpiry === null || d.daysToExpiry < 0 || d.daysToExpiry > days) continue;
    if (!best || d.daysToExpiry < best.days) best = { kind: d.kind, days: d.daysToExpiry };
  }
  return best;
}

export type HubTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'accent';

/** a1: the papers row's pill: the one thing that matters most about his papers. */
export function papersPill(view: Pick<DocumentsView, 'documents' | 'missing' | 'blocksOnline'> | undefined, t: T): { label: string; tone: HubTone } | null {
  if (!view) return null;
  const rows = documentRows(view).filter((r) => r.required);
  const worst = rows[0];
  if (!worst || worst.status === 'approved') return { label: t('partner.a1_papers_ok'), tone: 'success' };
  if (worst.status === 'expiring' && worst.doc?.daysToExpiry != null) return { label: t('partner.a1_papers_days', { n: worst.doc.daysToExpiry }), tone: 'warning' };
  return { label: t(DOC_STATUS_KEY[worst.status]), tone: DOC_TONE[worst.status] };
}

/** a1: the check-in row's pill. */
export function checkInPill(s: { verifiedToday: boolean; lockedOut: boolean; required: boolean } | undefined, t: T): { label: string; tone: HubTone } | null {
  if (!s) return null;
  if (s.lockedOut) return { label: t('partner.a1_checkin_locked'), tone: 'danger' };
  if (s.verifiedToday) return { label: t('partner.a1_checkin_done'), tone: 'success' };
  return s.required ? { label: t('partner.a1_checkin_needed'), tone: 'accent' } : null;
}
