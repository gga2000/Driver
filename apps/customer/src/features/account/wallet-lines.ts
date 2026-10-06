import type { WalletLine, WalletLineKind } from '@driver/contracts';
import { baghdadDay, dayKey, type DayKey } from '@/features/orders/history';

/**
 * Wallet transactions you can read (joy w8, audit W-08): grouped by Baghdad day, filtered by what
 * they were, and each line opening what it was — the order, the الرجعة pass, the top-up receipt.
 */
export type WalletFilter = 'all' | 'food' | 'rides' | 'rajaa' | 'topup' | 'points';
export const WALLET_FILTERS: readonly WalletFilter[] = ['all', 'food', 'rides', 'rajaa', 'topup', 'points'];

const KIND_FILTER: Partial<Record<WalletLineKind, WalletFilter>> = {
  food: 'food',
  grocery: 'food',
  errand: 'food',
  parcel: 'food',
  purchase: 'food',
  ride: 'rides',
  subscription: 'rides',
  seat: 'rajaa',
  topup: 'topup',
};

/** Which chip a line belongs to; credits, refunds and change follow the order they came with. */
export function filterOf(line: Pick<WalletLine, 'kind' | 'book' | 'bookingId' | 'orderId'>): WalletFilter | null {
  if (line.book === 'points') return 'points';
  const direct = KIND_FILTER[line.kind];
  if (direct) return direct;
  if (line.bookingId) return 'rajaa';
  if (line.orderId) return 'food';
  return null;
}

export function matches(line: Pick<WalletLine, 'kind' | 'book' | 'bookingId' | 'orderId'>, f: WalletFilter): boolean {
  return f === 'all' || filterOf(line) === f;
}

export interface WalletDay {
  id: string;
  day: DayKey;
  lines: WalletLine[];
}

/** Newest day first; lines keep the API's order (newest first) inside a day. */
export function walletDays(lines: readonly WalletLine[], filter: WalletFilter, now: Date): WalletDay[] {
  const out: WalletDay[] = [];
  for (const l of lines) {
    if (!matches(l, filter)) continue;
    const id = String(baghdadDay(l.occurredAt));
    const last = out[out.length - 1];
    if (last && last.id === id) last.lines.push(l);
    else out.push({ id, day: dayKey(l.occurredAt, now), lines: [l] });
  }
  return out;
}

/** Where a line opens: its order, its الرجعة pass, its top-up receipt; null when it is a line alone. */
export function lineHref(line: Pick<WalletLine, 'orderId' | 'bookingId' | 'topUpId'>): string | null {
  if (line.bookingId) return `/rajaa/pass/${line.bookingId}`;
  if (line.orderId) return `/order/${line.orderId}`;
  if (line.topUpId) return `/topup?id=${encodeURIComponent(line.topUpId)}`;
  return null;
}

/** A top-up older than this never gets the "money in" moment (a fresh install, an old top-up). */
const MONEY_IN_WINDOW_MS = 24 * 3_600_000;

/**
 * The "money in" moment (joy w7, audit W-07): the newest top-up that landed in the last day and was
 * not celebrated on this device yet (`seenId` = the last one shown). Null: nothing to show.
 */
export function moneyIn(lines: readonly WalletLine[], seenId: string | null, now: Date): WalletLine | null {
  const top = lines.filter((l) => l.kind === 'topup' && l.amount > 0).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
  if (!top || top.id === seenId) return null;
  return now.getTime() - top.occurredAt.getTime() <= MONEY_IN_WINDOW_MS ? top : null;
}
