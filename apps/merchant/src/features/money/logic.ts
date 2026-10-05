import { orderTicketNumber, type MerchantCashAccount, type MerchantDispute, type MoneyHeadline, type SettlementRequestView, type StatementOrderLine, type WeeklyStatement } from '@driver/contracts';
import type { TKey } from '@/lib/i18n-core';
import { localDayKey, startOfLocalWeek } from '@/lib/calendar';

/**
 * Money screen logic (pure, tested): the exposure bar, who holds the cash, the "اطلب فلوسك"
 * progress, the statement grouped by day and dispute deadlines.
 */

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

/**
 * Exposure bar (decisions §3, cap 300,000 by default): fill 0–1 and its tone. Clamped (M-07): a
 * negative balance is an empty bar and the room left is the whole cap — never "304,250 left of 300,000".
 */
export function exposure(balanceIqd: number, capIqd: number): { fill: number; tone: Tone; leftIqd: number; over: boolean } {
  const cap = Math.max(1, capIqd);
  const held = Math.max(0, balanceIqd);
  const fill = Math.min(1, held / cap);
  const over = held >= cap;
  return { fill, tone: over || fill >= 0.9 ? 'danger' : fill >= 0.65 ? 'warning' : 'success', leftIqd: Math.max(0, cap - held), over };
}

/**
 * M-07: the balance in plain words. `owed` — Driver holds money for the merchant (he can ask for it);
 * `owe` — negative: he took his orders' cash from the couriers and Driver's commission is left on him,
 * taken off his next money (nothing to pay, nothing to ask for); `zero` — nothing either way.
 */
export function balanceState(balanceIqd: number): { kind: 'owed' | 'owe' | 'zero'; amountIqd: number } {
  if (balanceIqd > 0) return { kind: 'owed', amountIqd: balanceIqd };
  if (balanceIqd < 0) return { kind: 'owe', amountIqd: -balanceIqd };
  return { kind: 'zero', amountIqd: 0 };
}

/**
 * Why "اطلب فلوسك" can't be pressed (M-07: a disabled button always says why), or null when it can.
 */
export function requestBlocker(account: Pick<MerchantCashAccount, 'balanceIqd' | 'request'>): 'open' | 'owe' | 'zero' | null {
  if (account.request && account.request.state !== 'handed_over') return 'open';
  if (account.balanceIqd < 0) return 'owe';
  if (account.balanceIqd === 0) return 'zero';
  return null;
}

export interface HolderRow {
  key: string;
  kind: 'courier' | 'platform';
  name: string | null;
  amountIqd: number;
  /** Share of the positive balance, 0–1 (bar length). */
  share: number;
}

/** Couriers holding the cash (largest first) then Driver's part; shares of the balance for the bars. */
export function holderRows(account: Pick<MerchantCashAccount, 'holders' | 'heldByPlatformIqd' | 'balanceIqd'>): HolderRow[] {
  const total = Math.max(1, account.holders.reduce((s, h) => s + h.amountIqd, 0) + account.heldByPlatformIqd);
  const rows: HolderRow[] = account.holders.map((h) => ({ key: h.courierId, kind: 'courier', name: h.name, amountIqd: h.amountIqd, share: h.amountIqd / total }));
  if (account.heldByPlatformIqd > 0) rows.push({ key: 'platform', kind: 'platform', name: null, amountIqd: account.heldByPlatformIqd, share: account.heldByPlatformIqd / total });
  return rows;
}

/** Index of the step in progress (0 requested, 1 on the way, 2 handed over) and whether all are done. */
export function requestProgress(r: Pick<SettlementRequestView, 'state'>): { current: 0 | 1 | 2; done: boolean } {
  if (r.state === 'handed_over') return { current: 2, done: true };
  if (r.state === 'on_the_way') return { current: 1, done: false };
  return { current: 0, done: false };
}

/** Whether "اطلب فلوسك" can be pressed: something is owed and no request is still open. */
export function canRequest(account: Pick<MerchantCashAccount, 'balanceIqd' | 'request'>): boolean {
  return account.balanceIqd > 0 && (!account.request || account.request.state === 'handed_over');
}

/**
 * The ticket number the kitchen calls out (same FNV-1a as the API's board `ticketNumber`), so the
 * statement and disputes name an order the way the board and the printed receipt did.
 */
export function ticketNumber(orderId: string): string {
  return orderTicketNumber(orderId);
}

export interface StatementDay {
  key: string;
  at: Date;
  lines: StatementOrderLine[];
  orders: number;
  itemsIqd: number;
  commissionIqd: number;
  netIqd: number;
}

/** Statement lines grouped by Baghdad day, newest day first, lines newest first. */
export function statementDays(lines: readonly StatementOrderLine[]): StatementDay[] {
  const byDay = new Map<string, StatementDay>();
  for (const l of lines) {
    const key = localDayKey(l.at);
    const d = byDay.get(key) ?? { key, at: l.at, lines: [], orders: 0, itemsIqd: 0, commissionIqd: 0, netIqd: 0 };
    d.lines.push(l);
    d.orders += 1;
    d.itemsIqd += l.itemsIqd;
    d.commissionIqd += l.commissionIqd;
    d.netIqd += l.netIqd;
    byDay.set(key, d);
  }
  return [...byDay.values()]
    .map((d) => ({ ...d, lines: [...d.lines].sort((a, b) => b.at.getTime() - a.at.getTime()) }))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** `weekOf` for the statement: this week minus `back` weeks (any instant inside it). */
export function weekAnchor(now: number, back: number): Date {
  return new Date(startOfLocalWeek(now) - back * 7 * 86_400_000 + 12 * 3_600_000);
}

export type DisputeStatus = 'waiting' | 'contested' | 'accepted' | 'default_applied';

export interface DisputeClock {
  status: DisputeStatus;
  /** Whole hours left (rounded down) while waiting; null otherwise. */
  hoursLeft: number | null;
  minutesLeft: number | null;
  urgent: boolean;
}

/** Where a dispute stands for the merchant, and how long is left to answer (48 h from opening). */
export function disputeClock(d: Pick<MerchantDispute, 'response' | 'respondBy'>, now: number): DisputeClock {
  if (d.response) return { status: d.response.decision === 'contest' ? 'contested' : 'accepted', hoursLeft: null, minutesLeft: null, urgent: false };
  if (!d.respondBy) return { status: 'waiting', hoursLeft: null, minutesLeft: null, urgent: false };
  const left = d.respondBy.getTime() - now;
  if (left <= 0) return { status: 'default_applied', hoursLeft: null, minutesLeft: null, urgent: false };
  return { status: 'waiting', hoursLeft: Math.floor(left / 3_600_000), minutesLeft: Math.max(1, Math.ceil(left / 60_000)), urgent: left < 12 * 3_600_000 };
}

/** Disputes still waiting for the owner (the tab badge). */
export function waitingCount(disputes: readonly Pick<MerchantDispute, 'response' | 'respondBy'>[], now: number): number {
  return disputes.filter((d) => disputeClock(d, now).status === 'waiting').length;
}

/** Minutes "جاهز" came after the promise (positive = late), or null when either is missing. */
export function lateMinutes(promisedReadyAt: Date | null, readyAt: Date | null): number | null {
  if (!promisedReadyAt || !readyAt) return null;
  return Math.round((readyAt.getTime() - promisedReadyAt.getTime()) / 60_000);
}

/** A contest needs a note; an accept doesn't. */
export function canSendAnswer(decision: 'accept_default' | 'contest' | null, note: string): boolean {
  if (decision === 'accept_default') return true;
  return decision === 'contest' && note.trim().length >= 3;
}

/**
 * S-M5 · the money pill in one line, from the server's headline: what to say, in which tone, and
 * what a tap does. "إلك 87,500 دينار · توصلك الليلة ويا الدليفري" (with "اطلب فلوسك"), "عليك 4,250
 * دينار عمولة · تنخصم من الجاية" (a tap opens the Money screen that explains), "فلوسك جاية قبل 9:40 م".
 */
export interface MoneyPill {
  tone: 'neutral' | 'warning' | 'success';
  /** The bold part: the amount, or the promise. */
  main: { key: TKey; amountIqd?: number; time?: Date };
  /** The rest of the line after " · ", or null. */
  sub: TKey | null;
  /** owed → "اطلب فلوسك" beside it; otherwise a tap opens the Money screen. */
  action: 'request' | 'open_money';
}

const ARRIVES_KEY: Record<NonNullable<MoneyHeadline['arrives']>, TKey> = {
  tonight_courier: 'merchant.moneypill.arrives_tonight_courier',
  on_request: 'merchant.moneypill.arrives_on_request',
  zaincash_daily: 'merchant.moneypill.arrives_zaincash_daily',
  bank_weekly: 'merchant.moneypill.arrives_bank_weekly',
};

export function moneyPill(h: MoneyHeadline): MoneyPill {
  switch (h.kind) {
    case 'owed':
      return { tone: 'neutral', main: { key: 'merchant.moneypill.owed', amountIqd: h.amountIqd }, sub: h.arrives ? ARRIVES_KEY[h.arrives] : null, action: 'request' };
    case 'owe':
      return { tone: 'warning', main: { key: 'merchant.moneypill.owe', amountIqd: h.amountIqd }, sub: 'merchant.moneypill.owe_when', action: 'open_money' };
    case 'requested':
      return h.by
        ? { tone: 'success', main: { key: 'merchant.moneypill.requested', time: h.by }, sub: null, action: 'open_money' }
        : { tone: 'success', main: { key: 'merchant.moneypill.requested_pending' }, sub: null, action: 'open_money' };
    case 'zero':
      return { tone: 'neutral', main: { key: 'merchant.money.pill_zero' }, sub: null, action: 'open_money' };
  }
}

/**
 * M-17 · the bridge row under the weekly totals: "رصيد أول الأسبوع + الصافي − اللي استلمته ±
 * تعديلات = رصيد آخر الأسبوع". The server sends the adjustments; this lays the terms out and says
 * whether they add up (they always should: a false here is a bug worth seeing in a test).
 */
export interface BridgeTerm {
  key: 'opening' | 'net' | 'settled' | 'adjustments' | 'closing';
  label: TKey;
  amountIqd: number;
  /** The sign shown before the term ('' for the first). */
  op: '' | '+' | '−' | '=';
}

export function statementBridge(s: Pick<WeeklyStatement, 'openingIqd' | 'closingIqd' | 'totals'>): { terms: BridgeTerm[]; adds: boolean } {
  const adj = s.totals.adjustmentsIqd ?? 0;
  const terms: BridgeTerm[] = [
    { key: 'opening', label: 'merchant.bridge.opening', amountIqd: s.openingIqd, op: '' },
    { key: 'net', label: 'merchant.bridge.net', amountIqd: s.totals.netIqd, op: '+' },
    { key: 'settled', label: 'merchant.bridge.settled', amountIqd: s.totals.settledIqd, op: '−' },
  ];
  if (adj !== 0) terms.push({ key: 'adjustments', label: 'merchant.bridge.adjustments', amountIqd: adj, op: '+' });
  terms.push({ key: 'closing', label: 'merchant.bridge.closing', amountIqd: s.closingIqd, op: '=' });
  return { terms, adds: s.openingIqd + s.totals.netIqd - s.totals.settledIqd + adj === s.closingIqd };
}
