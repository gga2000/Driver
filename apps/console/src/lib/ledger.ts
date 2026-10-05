import type { StatementLine } from '@driver/contracts';
import { t } from '@driver/i18n';

/** Pure helpers for the driver ledger page. */

export interface CapUsage {
  /** owed / cap as a percentage (can exceed 100). */
  percent: number;
  /** Bar width, clamped to 0–100. */
  barPercent: number;
  over: boolean;
  /** ≥ 80 %: the Partner app starts warning (partner.cap_warning). */
  warn: boolean;
}

export function capUsage(owedIqd: number, capIqd: number, overCapFlag?: boolean): CapUsage {
  const owed = Math.max(0, owedIqd);
  const percent = capIqd > 0 ? Math.round((owed / capIqd) * 100) : owed > 0 ? 100 : 0;
  const over = overCapFlag ?? owed > capIqd;
  return { percent, barPercent: Math.min(100, Math.max(0, percent)), over, warn: !over && percent >= 80 };
}

/** In / out totals of a set of statement lines. */
export function sumLines(lines: readonly Pick<StatementLine, 'amountIqd'>[]): { inIqd: number; outIqd: number; netIqd: number } {
  let inIqd = 0;
  let outIqd = 0;
  for (const l of lines) {
    if (l.amountIqd >= 0) inIqd += l.amountIqd;
    else outIqd += -l.amountIqd;
  }
  return { inIqd, outIqd, netIqd: inIqd - outIqd };
}

// ───────────────────────── the statement in words (K-16) ─────────────────────────

export type StatementTab = 'cash' | 'earnings';

/**
 * A running balance said the way finance says it, never with a sign. Cash: a negative `cash:`
 * balance is cash in his hands that isn't his ("بيده 48,400"); positive means he handed over more
 * than he held ("له 2,000"). Earnings: positive is owed to him ("له"), negative he owes ("عليه").
 */
export function balanceWords(tab: StatementTab, balanceIqd: number): { key: 'holds' | 'owed_to' | 'owes' | 'square'; amountIqd: number } {
  if (balanceIqd === 0) return { key: 'square', amountIqd: 0 };
  if (tab === 'cash') return balanceIqd < 0 ? { key: 'holds', amountIqd: -balanceIqd } : { key: 'owed_to', amountIqd: balanceIqd };
  return balanceIqd > 0 ? { key: 'owed_to', amountIqd: balanceIqd } : { key: 'owes', amountIqd: -balanceIqd };
}

/** Handing cash over: to the company (round, agent, ZainCash) or to a restaurant. Marked in the statement. */
export const HANDOVER_TYPES: ReadonlySet<string> = new Set(['driver_settlement', 'merchant_paid_by_courier', 'debt_settled']);

export function isHandover(line: Pick<StatementLine, 'type'>): boolean {
  return HANDOVER_TYPES.has(line.type);
}

/**
 * Which column a line goes in. Cash: money coming into his hands (a negative amount on `cash:`) is
 * "استلم", money leaving them "سلّم". Earnings: "له" when it adds to what we owe him, "عليه" when it
 * takes away (commission, penalties).
 */
export function lineSide(tab: StatementTab, amountIqd: number): 'in' | 'out' {
  if (tab === 'cash') return amountIqd < 0 ? 'in' : 'out';
  return amountIqd >= 0 ? 'in' : 'out';
}

/**
 * A line's memo for people: the round's reference in words ("جولة الاستلام D-118"), free text as
 * written, and machine keys ("handover-demo-1", "idem:…") left out (they stay on hover).
 */
export function memoWords(memo: string | null | undefined): string | null {
  const m = (memo ?? '').trim();
  if (!m) return null;
  const round = /^ops_round:(.+)$/.exec(m);
  if (round) return t('console.ledger_memo_round', { ref: round[1]! });
  if (/^[\w.:/-]+$/.test(m)) return null;
  return m;
}

export interface DayGroup<T> {
  key: string;
  lines: T[];
}

/** Lines (already newest first) grouped under their day, newest day first. */
export function groupByDay<T extends Pick<StatementLine, 'occurredAt'>>(lines: readonly T[], keyOf: (d: Date) => string): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const l of lines) {
    const key = keyOf(l.occurredAt);
    const last = out.at(-1);
    if (last && last.key === key) last.lines.push(l);
    else out.push({ key, lines: [l] });
  }
  return out;
}

/** Lines newest first (the API returns them oldest first with a running balance). */
export function newestFirst<T extends Pick<StatementLine, 'occurredAt' | 'id'>>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id));
}
