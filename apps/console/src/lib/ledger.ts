import type { StatementLine } from '@driver/contracts';

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

/** Lines newest first (the API returns them oldest first with a running balance). */
export function newestFirst<T extends Pick<StatementLine, 'occurredAt' | 'id'>>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id));
}
