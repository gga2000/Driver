import type { ApprovalItem, BannerSeverity, ControlsView, KillScope, KillSwitchView, LaunchMetric, SlaState, TicketSummary, Vertical, ZoneCapacityView, ZoneLoadState } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { formatClock, formatIqd } from './format';
import type { ChipTone } from '@/components/ui';
import { compactDuration } from './support-views';

/**
 * Pure helpers for the launch control room pages (controls, approvals, support, finance, wall), kept
 * out of React so they are unit-tested in node.
 */

const MIN = 60_000;

/** Gauge colour per zone load state. */
export function gaugeTone(state: ZoneLoadState): { bar: string; chip: ChipTone } {
  switch (state) {
    case 'full':
      return { bar: 'bg-bad', chip: 'bad' };
    case 'busy':
      return { bar: 'bg-accent', chip: 'warn' };
    case 'off':
      return { bar: 'bg-faint', chip: 'neutral' };
    default:
      return { bar: 'bg-ok', chip: 'done' };
  }
}

const STATE_RANK: Record<ZoneLoadState, number> = { full: 0, off: 1, busy: 2, ok: 3 };

/** Zones that need eyes first: full, switched off, busy, then throttled by load, then the rest by name. */
export function sortZones(zones: readonly ZoneCapacityView[]): ZoneCapacityView[] {
  return [...zones].sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      Number(b.maxActive !== null) - Number(a.maxActive !== null) ||
      b.load - a.load ||
      b.active - a.active ||
      a.name_ar.localeCompare(b.name_ar, 'ar'),
  );
}

/** Gauge fill 0–100 (a zone over its cap shows full). */
export function gaugePct(z: Pick<ZoneCapacityView, 'maxActive' | 'active'>): number {
  if (!z.maxActive) return 0;
  return Math.min(100, Math.round((z.active / z.maxActive) * 100));
}

export type ExpiryKey = 'none' | '30m' | '1h' | '2h' | 'midnight';
export const EXPIRY_KEYS: readonly ExpiryKey[] = ['none', '30m', '1h', '2h', 'midnight'];

/** Up to the next 5 minutes, so the customer reads "11:30", not "11:27". */
const ceil5 = (ms: number) => new Date(Math.ceil(ms / (5 * MIN)) * 5 * MIN);

/** When a switch comes back by itself (rounded up to 5 minutes); `midnight` = the next Baghdad midnight (UTC+3). */
export function expiryAt(key: ExpiryKey, now: Date): Date | undefined {
  switch (key) {
    case '30m':
      return ceil5(now.getTime() + 30 * MIN);
    case '1h':
      return ceil5(now.getTime() + 60 * MIN);
    case '2h':
      return ceil5(now.getTime() + 120 * MIN);
    case 'midnight': {
      const local = new Date(now.getTime() + 180 * MIN);
      const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
      return new Date(next - 180 * MIN);
    }
    default:
      return undefined;
  }
}

/**
 * The refusal customers see (K-13, mirrors the API's `refusalFor`): with an end time it says when the
 * service comes back ("موقّفة لحد الساعة 11:30 م"), without one it says to try later. No "إن شاء الله"
 * in a time.
 */
export function defaultRefusal(scope: KillScope, label: string, until?: Date | null): string {
  const time = until ? formatClock(until) : null;
  switch (scope) {
    case 'vertical':
      return time ? t('console.ctl_refusal_vertical_until', { name: label, time }) : t('console.ctl_refusal_vertical', { name: label });
    case 'zone':
      return time ? t('console.ctl_refusal_zone_until', { name: label, time }) : t('console.ctl_refusal_zone', { name: label });
    case 'restaurant':
      return time ? t('console.ctl_refusal_restaurant_until', { name: label, time }) : t('console.ctl_refusal_restaurant', { name: label });
    case 'corridor':
      return time ? t('console.ctl_refusal_corridor_until', { name: label, time }) : t('console.ctl_refusal_corridor', { name: label });
  }
}

/** Verticals a zone switch can stop one at a time (rides and deliveries that start in a zone). */
export const ZONE_VERTICALS: readonly Vertical[] = ['food', 'grocery', 'errand', 'parcel', 'taxi', 'tuktuk'];

/**
 * One cell of the zone × service matrix: `on` (running), `off` (this switch is on), `zone` (the whole
 * zone is stopped), `city` (the service is stopped in every zone). `sw` is the switch to restore.
 */
export type CellState = 'on' | 'off' | 'zone' | 'city';
export interface MatrixCell {
  state: CellState;
  sw: KillSwitchView | null;
}

export function matrixCell(view: Pick<ControlsView, 'switches' | 'verticals'>, zoneKey: string, vertical: Vertical | null): MatrixCell {
  const live = view.switches.filter((s) => s.active && s.scope === 'zone' && s.key === zoneKey);
  const whole = live.find((s) => s.vertical === null) ?? null;
  if (vertical === null) return whole ? { state: 'off', sw: whole } : { state: 'on', sw: null };
  const own = live.find((s) => s.vertical === vertical) ?? null;
  if (own) return { state: 'off', sw: own };
  if (whole) return { state: 'zone', sw: whole };
  if (view.verticals.some((v) => v.key === vertical && v.killed)) return { state: 'city', sw: null };
  return { state: 'on', sw: null };
}

/** A zone needs a row in the short matrix: stopped (wholly or one service), capped, or busy. */
export function zoneNeedsRow(view: Pick<ControlsView, 'switches'>, z: ZoneCapacityView): boolean {
  return z.killed || z.maxActive !== null || z.state !== 'ok' || view.switches.some((s) => s.active && s.scope === 'zone' && s.key === z.zoneKey);
}

/** The switch that is on for a whole-city target (vertical, restaurant, corridor), if any. */
export function activeSwitch(view: Pick<ControlsView, 'switches'>, scope: KillScope, key: string): KillSwitchView | null {
  return view.switches.find((s) => s.active && s.scope === scope && s.key === key && (scope !== 'zone' || s.vertical === null)) ?? null;
}

/** "يرجع الساعة 11:30 م" / "لحد ما ترجّعه" for a switch that is on. */
export function switchUntil(s: Pick<KillSwitchView, 'expiresAt'>): string {
  return s.expiresAt ? t('console.ctl_back_at', { time: formatClock(s.expiresAt) }) : t('console.ctl_back_by_hand');
}

// ───────────────────────── dispatch modes (moved here from /dispatch, K-14) ─────────────────────────

/** What each dispatch mode does, in one line, for the confirm dialog. */
export function modeExplainKey(mode: 'broadcast' | 'auto' | 'suggest'): MessageKey {
  return `console.ctl_mode_explain_${mode}` as MessageKey;
}

// ───────────────────────── money in words (K-16) ─────────────────────────

/**
 * Where a courier's cash stands against the cap (money spec §4: amber from 70 %, red from 90 %, over
 * at 100 %). The word goes beside the bar so the level never rides on colour alone.
 */
export type CashLevel = 'ok' | 'near' | 'edge' | 'over';
export function cashLevel(fill: number, overCap: boolean): CashLevel {
  if (overCap || fill >= 1) return 'over';
  if (fill >= 0.9) return 'edge';
  if (fill >= 0.7) return 'near';
  return 'ok';
}

export const CASH_LEVEL_CLS: Record<CashLevel, { bar: string; text: string }> = {
  ok: { bar: 'bg-ok-solid', text: 'text-muted' },
  near: { bar: 'bg-warn-solid', text: 'text-warn' },
  edge: { bar: 'bg-bad-solid', text: 'text-bad' },
  over: { bar: 'bg-bad-solid', text: 'text-bad' },
};

/** "لازم يسلّم 52,000 دينار" / "له 2,000 دينار" / "ماكو حساب": what the courier owes, in words. */
export function owedWords(owedIqd: number): string {
  if (owedIqd > 0) return t('console.fin_owes', { amount: formatIqd(owedIqd) });
  if (owedIqd < 0) return t('console.fin_is_owed', { amount: formatIqd(-owedIqd) });
  return t('console.fin_square');
}

/** "للمطعم 120,000 دينار" / "على المطعم 4,250 دينار" / "ماكو حساب". */
export function merchantWords(payableIqd: number): string {
  if (payableIqd > 0) return t('console.fin_to_merchant', { amount: formatIqd(payableIqd) });
  if (payableIqd < 0) return t('console.fin_from_merchant', { amount: formatIqd(-payableIqd) });
  return t('console.fin_square');
}

/** Net of a ledger check in words: "ماكو فرق" or "فرق 250". */
export function netWords(net: number): string {
  return net === 0 ? t('console.fin_no_gap') : t('console.fin_gap', { amount: formatIqd(Math.abs(net)) });
}

// ───────────────────────── wall ─────────────────────────

/**
 * The playbook §6 targets as numbers, for the bullet bar under each tile: `lower` = smaller is better.
 * The label beside the bar is the server's `target_ar`; these only place the marks.
 */
export const WALL_TARGETS: Partial<Record<LaunchMetric['key'], { target: number; better: 'lower' | 'higher'; max: number }>> = {
  median_delivery: { target: 35, better: 'lower', max: 60 },
  acceptance: { target: 0.85, better: 'higher', max: 1 },
  disputes_24h: { target: 0, better: 'lower', max: 5 },
  orders_day: { target: 30, better: 'higher', max: 60 },
  rajaa_seats: { target: 20, better: 'higher', max: 40 },
};

/** Value and target marks on a 0–100 track (the value clamps; a scale grows to fit a big value). */
export function bullet(key: LaunchMetric['key'], value: number | null): { value: number; target: number } | null {
  const spec = WALL_TARGETS[key];
  if (!spec || value === null) return null;
  const max = Math.max(spec.max, value * 1.1, spec.target * 1.25);
  return { value: Math.min(100, Math.round((value / max) * 100)), target: Math.round((spec.target / max) * 100) };
}

/** The wall stops being trusted after 2 minutes without a fresh read (S-K6). */
export const WALL_STALE_MS = 120_000;
export function wallStale(updatedAt: number, now: number): boolean {
  return updatedAt > 0 && now - updatedAt > WALL_STALE_MS;
}

/** "4 تشرين الأول" (+ the year when asked) for an ISO day: Arabic month names, Western digits (K-15). */
export function arabicDay(isoDate: string, withYear = false): string {
  return new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'Asia/Baghdad' }).format(new Date(`${isoDate.slice(0, 10)}T12:00:00+03:00`));
}

/** Day labels for the orders strip: "ج 2/10" style is ambiguous, so the weekday in Arabic + day number. */
export function dayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00+03:00`);
  const wd = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { weekday: 'long', timeZone: 'Asia/Baghdad' }).format(d);
  return `${wd} ${Number(isoDate.slice(8, 10))}`;
}

// ───────────────────────── approvals ─────────────────────────

/** The item after `id` once it is decided (the next one down, else the one above, else none). */
export function nextAfter<T extends { id: string }>(items: readonly T[], id: string): T | null {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return items[0] ?? null;
  return items[i + 1] ?? items[i - 1] ?? null;
}

/** "ربع ساعة" / "نص ساعة" / "ساعة" / "20 دقيقة" — the wait as the refusal says it. */
export function waitLabel(min: number): string {
  if (min === 15) return t('console.wait_quarter');
  if (min === 30) return t('console.wait_half');
  if (min === 60) return t('console.wait_hour');
  return t('console.wait_min', { n: min });
}

/** The throttle refusal customers get (mirrors the API's `throttleMessage`). */
export function throttlePreview(etaMin: number, mode: 'refuse' | 'queue'): string {
  const wait = waitLabel(etaMin);
  return mode === 'queue' ? t('console.ctl_throttle_queue', { wait }) : t('console.ctl_throttle_refuse', { wait });
}

export const ETA_CHOICES: readonly number[] = [10, 15, 20, 30, 45, 60];

/** Banner end choices: within the day, as the API allows (≤ 24 h). */
export const BANNER_HOURS: readonly number[] = [1, 2, 4, 8, 12, 24];

export function bannerTone(s: BannerSeverity): ChipTone {
  return s === 'critical' ? 'bad' : s === 'warning' ? 'warn' : 'live';
}

/** Upload read URLs come back relative to the API (`/files/<id>?…`): resolve them against its origin. */
export function fileUrl(url: string, apiUrl: string): string {
  try {
    return new URL(url, new URL(apiUrl).origin).toString();
  } catch {
    return url;
  }
}

/** "قبل 12 د" / "قبل 3 س" / "قبل يومين" for queue ages. */
export function ageLabel(from: Date, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - from.getTime()) / MIN));
  if (min < 1) return t('console.age_now');
  if (min < 60) return t('console.age_min', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('console.age_hours', { n: h });
  return t('console.age_days', { n: Math.floor(h / 24) });
}

/** SLA clock for a ticket row: time left (or over) to the same-day deadline, as a compact duration. */
export function slaClock(t0: Pick<TicketSummary, 'slaDueAt' | 'slaState' | 'status'>, now: Date): { text: string; tone: ChipTone } {
  if (t0.status === 'resolved') return { text: t(t0.slaState === 'met' ? 'console.sla_met' : 'console.sla_late'), tone: t0.slaState === 'met' ? 'done' : 'bad' };
  const ms = t0.slaDueAt.getTime() - now.getTime();
  // K-12: "متأخرة 20 س" / "باقي 2 س 30 د" — a duration, never something that reads like a clock time.
  const time = compactDuration(ms);
  if (ms < 0) return { text: t('console.sla_over', { time }), tone: 'bad' };
  return { text: t('console.sla_left', { time }), tone: ms < 3_600_000 ? 'warn' : 'neutral' };
}

export function slaTone(s: SlaState): ChipTone {
  return s === 'breached' ? 'bad' : s === 'due_soon' ? 'warn' : s === 'met' ? 'done' : 'neutral';
}

/** Quick refund amounts the agent can still give (multiples of 250, within what is available). */
export function refundChips(availableIqd: number): number[] {
  return [1000, 2000, 5000, 10_000, 25_000].filter((n) => n <= availableIqd);
}

/** Groups the queue by kind for the filter chips, keeping the API's oldest-first order inside. */
export function approvalCounts(items: readonly ApprovalItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.kind] = (out[i.kind] ?? 0) + 1;
  return out;
}

/** Wall tile tone: met target, missed, or not enough data yet. */
export function metricTone(m: Pick<LaunchMetric, 'ok'>): 'ok' | 'bad' | 'pending' {
  return m.ok === null ? 'pending' : m.ok ? 'ok' : 'bad';
}

/** Bar heights for the orders-per-day strip (0–100, the busiest day full). */
export function dayBars(days: ReadonlyArray<{ orders: number }>): number[] {
  const max = Math.max(1, ...days.map((d) => d.orders));
  return days.map((d) => Math.round((d.orders / max) * 100));
}

/** `12,500 د.ع` compact money for dense tables. */
export function iqdShort(n: number): string {
  return `${formatIqd(n)}`;
}

/** Saves a CSV string the API produced as a file (UTF-8 with its BOM). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
