import { orderTicketNumber, type TicketSummary } from '@driver/contracts';
import { normalize } from './command';

/**
 * The support inbox's smart views, search and unread markers. Pure (tested); the desk feeds it the
 * active queue from `support.list` (and the resolved list for "محلولة").
 */

export const SUPPORT_VIEWS = [
  'open',
  'mine',
  'unassigned',
  'breached',
  'disputes',
  'escalated',
  'waiting',
  'resolved',
] as const;
export type SupportView = (typeof SUPPORT_VIEWS)[number];

export function isSupportView(v: string | null | undefined): v is SupportView {
  return SUPPORT_VIEWS.includes(v as SupportView);
}

type Row = Pick<
  TicketSummary,
  | 'id'
  | 'status'
  | 'assigneeId'
  | 'slaState'
  | 'kind'
  | 'subject'
  | 'customerName'
  | 'orderId'
  | 'lastActivityAt'
>;

export function inView(row: Row, view: SupportView, me: string | null): boolean {
  const active = row.status !== 'resolved';
  switch (view) {
    case 'open':
      return active;
    case 'mine':
      return active && me !== null && row.assigneeId === me;
    case 'unassigned':
      return active && row.assigneeId === null;
    case 'breached':
      return active && row.slaState === 'breached';
    case 'disputes':
      return active && row.kind === 'dispute';
    case 'escalated':
      return row.status === 'escalated';
    case 'waiting':
      return row.status === 'waiting';
    case 'resolved':
      return row.status === 'resolved';
  }
}

/** Counts per view from the active queue (resolved comes from its own list, so it isn't counted). */
export function viewCounts(rows: readonly Row[], me: string | null): Record<SupportView, number> {
  const out = Object.fromEntries(SUPPORT_VIEWS.map((v) => [v, 0])) as Record<SupportView, number>;
  for (const r of rows)
    for (const v of SUPPORT_VIEWS) if (v !== 'resolved' && inView(r, v, me)) out[v] += 1;
  return out;
}

/** Subject, customer first name or the order number ("1284", "#1284"). Spelling-folded. */
export function matchesSearch(row: Row, query: string): boolean {
  const q = normalize(query.replace(/^#/, ''));
  if (!q) return true;
  if (row.orderId && orderTicketNumber(row.orderId).startsWith(q)) return true;
  return normalize(row.subject).includes(q) || normalize(row.customerName ?? '').includes(q);
}

export function filterQueue<T extends Row>(
  rows: readonly T[],
  view: SupportView,
  me: string | null,
  query: string,
): T[] {
  return rows.filter((r) => inView(r, view, me) && matchesSearch(r, query));
}

/** ticketId → the lastActivityAt (ms) the agent last saw. */
export type SeenMap = Record<string, number>;
export const SEEN_KEY = 'driver.console.support.seen';

/** Unread: an open ticket never opened here, or with activity since it was last opened. */
export function isUnread(
  row: Pick<TicketSummary, 'id' | 'status' | 'lastActivityAt'>,
  seen: SeenMap,
): boolean {
  if (row.status === 'resolved') return false;
  const at = seen[row.id];
  return at === undefined || row.lastActivityAt.getTime() > at;
}

export function markSeen(
  seen: SeenMap,
  row: Pick<TicketSummary, 'id' | 'lastActivityAt'>,
  keep = 300,
): SeenMap {
  const next: SeenMap = { ...seen, [row.id]: row.lastActivityAt.getTime() };
  const ids = Object.keys(next);
  if (ids.length <= keep) return next;
  // Forget the oldest so the store stays small.
  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1] - a[1])
      .slice(0, keep),
  );
}

/** "2 س 30 د", "40 د", "20 س" — the compact duration the SLA pill and the wall use. */
export function compactDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(Math.abs(ms) / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} د`;
  if (h >= 10 || m === 0) return `${h} س`;
  return `${h} س ${m} د`;
}

/** How much of the same-day window is left (0–1), for the SLA fuse. Resolved → 1 (met) or 0. */
export function slaFraction(
  row: Pick<TicketSummary, 'openedAt' | 'slaDueAt' | 'status' | 'slaState'>,
  now: Date,
): number {
  if (row.status === 'resolved') return row.slaState === 'met' ? 1 : 0;
  const total = row.slaDueAt.getTime() - row.openedAt.getTime();
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (row.slaDueAt.getTime() - now.getTime()) / total));
}
