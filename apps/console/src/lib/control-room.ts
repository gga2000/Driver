import type { ApprovalItem, BannerSeverity, KillScope, LaunchMetric, SlaState, TicketSummary, ZoneCapacityView, ZoneLoadState } from '@driver/contracts';
import { t } from '@driver/i18n';
import { formatIqd } from './format';
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

/** When a switch comes back by itself; `midnight` = the next Baghdad midnight (UTC+3). */
export function expiryAt(key: ExpiryKey, now: Date): Date | undefined {
  switch (key) {
    case '30m':
      return new Date(now.getTime() + 30 * MIN);
    case '1h':
      return new Date(now.getTime() + 60 * MIN);
    case '2h':
      return new Date(now.getTime() + 120 * MIN);
    case 'midnight': {
      const local = new Date(now.getTime() + 180 * MIN);
      const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
      return new Date(next - 180 * MIN);
    }
    default:
      return undefined;
  }
}

/** The refusal customers see when the switch has no message of its own (mirrors the API's defaults). */
export function defaultRefusal(scope: KillScope, label: string): string {
  switch (scope) {
    case 'vertical':
      return t('console.ctl_refusal_vertical', { name: label });
    case 'zone':
      return t('console.ctl_refusal_zone', { name: label });
    case 'restaurant':
      return t('console.ctl_refusal_restaurant', { name: label });
    case 'corridor':
      return t('console.ctl_refusal_corridor', { name: label });
  }
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
