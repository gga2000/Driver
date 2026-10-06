import type { MoneyRules, PeakShift } from './ledger-rules.js';

/**
 * G-91 launch shift guarantee (money §2, edge-case review #91), pure: the city's shifts as instants
 * (Ali, 2026-10-06: 06:00–15:00 and 15:00–02:00 Baghdad time; one crosses midnight), and what one
 * shift earns a driver. Built on 2026-10-06 for the server to pay, then
 * switched off by Ali the same day until he decides (`MoneyRules.guarantee.enabled: false`). The rule:
 * per shift, if he accepted ≥ 85 % of the offers he answered or let expire, cancelled at most
 * once after accepting and completed at least 3 jobs, the platform tops his earnings for the jobs of
 * that shift up to 10,000 دينار (the difference, never a flat bonus), paid on the Sunday run.
 * Shared by the API (which posts it) and the simulator (which checks it); the apps only show the
 * server's numbers. docs/api/shift-guarantee.md has the full rule.
 */

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/**
 * One shift on the day it starts. `id` is `2026-10-04:evening`, the ledger memo's tail
 * (`guarantee:<id>`); a shift past midnight keeps its start date (that one ends 02:00 on the 5th).
 */
export interface PeakWindow {
  id: string;
  peak: string;
  /** Local calendar day the shift starts on, `YYYY-MM-DD`. */
  localDate: string;
  from: Date;
  to: Date;
}

/**
 * Every shift that overlaps `[from, to)`, oldest first, on the city's clock (`offsetMin` east of UTC).
 * The day before `from` is looked at too: its shift past midnight may still be running at `from`.
 */
export function peakWindows(range: { from: Date; to: Date }, peaks: readonly PeakShift[], offsetMin: number): PeakWindow[] {
  const out: PeakWindow[] = [];
  const offsetMs = offsetMin * MIN_MS;
  const firstLocal = new Date(range.from.getTime() + offsetMs);
  // A shift ends by the end of the day after it starts (`PeakShift.endMin` ≤ 2880): one day back is enough.
  let midnight = Date.UTC(firstLocal.getUTCFullYear(), firstLocal.getUTCMonth(), firstLocal.getUTCDate()) - offsetMs - DAY_MS;
  for (; midnight < range.to.getTime(); midnight += DAY_MS) {
    const localDate = new Date(midnight + offsetMs).toISOString().slice(0, 10);
    for (const p of [...peaks].sort((a, b) => a.startMin - b.startMin)) {
      const from = midnight + p.startMin * MIN_MS;
      const to = midnight + p.endMin * MIN_MS;
      if (to <= range.from.getTime() || from >= range.to.getTime()) continue;
      out.push({ id: `${localDate}:${p.key}`, peak: p.key, localDate, from: new Date(from), to: new Date(to) });
    }
  }
  return out;
}

/** The shift `at` falls in (00:30 is still the previous day's shift past midnight), or null between shifts. */
export function peakWindowAt(at: Date, peaks: readonly PeakShift[], offsetMin: number): PeakWindow | null {
  return peakWindows({ from: at, to: new Date(at.getTime() + 1) }, peaks, offsetMin)[0] ?? null;
}

/** What happened in one shift, as the server counts it (docs/api/shift-guarantee.md). */
export interface GuaranteeStats {
  /** Offers he accepted, declined or let time out in the shift. */
  offers: number;
  accepted: number;
  /** Jobs he cancelled after accepting, in the shift. */
  cancelsAfterAccept: number;
  /** Jobs (trips) he completed in the shift. */
  completedJobs: number;
  /** What he earned on those jobs: pay and tips less the platform's take; penalties are not topped up. */
  earningsIqd: number;
}

export interface GuaranteeCheck {
  /** accepted ÷ offers; null without offers. */
  acceptance: number | null;
  meets: { acceptance: boolean; cancels: boolean; jobs: boolean };
  qualified: boolean;
  /** Completed jobs still missing for the jobs condition (0 when met). */
  jobsToGo: number;
  /** The platform's top-up: `max(0, amount − earnings)` when qualified, else 0. Never more than the amount. */
  topUpIqd: number;
}

/** Acceptance is compared on whole numbers (basis points), so exactly 85 % is 85 %, whatever the float. */
const BP = 10_000;

/**
 * The G-91 rule for one shift. No offers at all means no acceptance to judge: not qualified (the
 * conservative reading — a shift with jobs always has accepted offers). The switch off (`enabled`)
 * qualifies nobody.
 */
export function shiftGuarantee(s: GuaranteeStats, g: MoneyRules['guarantee']): GuaranteeCheck {
  const acceptance = s.offers > 0 ? s.accepted / s.offers : null;
  const meets = {
    acceptance: s.offers > 0 && s.accepted * BP >= Math.round(g.minAcceptance * BP) * s.offers,
    cancels: s.cancelsAfterAccept <= g.maxCancelsAfterAccept,
    jobs: s.completedJobs >= g.minCompletedJobs,
  };
  const qualified = g.enabled && meets.acceptance && meets.cancels && meets.jobs;
  return {
    acceptance,
    meets,
    qualified,
    jobsToGo: Math.max(0, g.minCompletedJobs - s.completedJobs),
    topUpIqd: qualified ? Math.min(g.amountIqd, Math.max(0, g.amountIqd - s.earningsIqd)) : 0,
  };
}

/** The ledger memo of a shift's top-up line: `guarantee:2026-10-04:evening`. */
export function guaranteeMemo(windowId: string): string {
  return `guarantee:${windowId}`;
}
