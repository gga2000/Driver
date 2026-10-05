import { CHANGE_RULES, changeDue, changeToWalletProblem, tenderOptions, type HandoverProof } from '@driver/contracts';

/**
 * "الخردة علينا" at the door (UI/UX audit partner S-2; Phase 3, 2026-10-05). Pure rules behind the
 * cash helper (plain Node, unit-tested): which notes to offer, the change to hand back, whether the
 * rest may go to the customer's wallet, and the hand-over the server is sent. The server checks the
 * same rules again (`changeToWalletProblem`) and decides.
 */

export interface DoorChip {
  amountIqd: number;
  /** The note the customer said at checkout ("الزبون گال"). */
  stated: boolean;
  /** The exact amount ("بالضبط"). */
  exact: boolean;
}

/**
 * "الزبون دفع:" — the customer's stated note first, then the exact amount and the notes above it
 * (5,000 / 10,000 / 20,000 / 25,000 / 50,000), no repeats; "غير" (the pad) comes after these.
 */
export function doorChips(collectIqd: number, tenderIqd?: number | null): DoorChip[] {
  const out: DoorChip[] = [];
  const seen = new Set<number>();
  const push = (amountIqd: number, stated: boolean) => {
    if (seen.has(amountIqd) || amountIqd < collectIqd) return;
    seen.add(amountIqd);
    out.push({ amountIqd, stated, exact: amountIqd === collectIqd });
  };
  if (tenderIqd) push(tenderIqd, true);
  for (const n of tenderOptions(collectIqd)) push(n, false);
  return out;
}

/** The job card line: "الزبون يدفع بـ 25,000 · جهّز 7,250 خردة" (null without a stated note). */
export function tenderLine(collectIqd: number, tenderIqd?: number | null): { tenderIqd: number; changeIqd: number } | null {
  if (!tenderIqd || collectIqd <= 0) return null;
  return { tenderIqd, changeIqd: changeDue(tenderIqd, collectIqd) };
}

export interface DoorState {
  /** What the customer handed over. */
  paidIqd: number;
  /** Change to hand back (0 when exact). */
  changeIqd: number;
  /** "ما عندي خردة" may put the change in the customer's wallet (cash order, ≤ cap, in 250s). */
  walletAllowed: boolean;
  /** Why not, when there is change but the wallet is not allowed. */
  walletBlock: 'above_cap' | 'not_step' | null;
  /** Below the amount to collect (the pad): he can't confirm yet. */
  short: boolean;
}

export function doorState(collectIqd: number, paidIqd: number): DoorState {
  const changeIqd = changeDue(paidIqd, collectIqd);
  const problem = changeIqd > 0 ? changeToWalletProblem({ paymentMethod: 'cash', totalIqd: collectIqd, collectedIqd: paidIqd, changeToWalletIqd: changeIqd }) : null;
  return {
    paidIqd,
    changeIqd,
    walletAllowed: changeIqd > 0 && problem === null,
    walletBlock: problem === 'above_cap' ? 'above_cap' : problem === 'not_step' ? 'not_step' : null,
    short: paidIqd < collectIqd,
  };
}

/**
 * What `trips.completeStop` records: with change handed back, the amount he keeps (the order's cash
 * total); with no change, the whole note and the rest as `changeToWalletIqd`.
 */
export function doorHandover(collectIqd: number, paidIqd: number, noChange: boolean): Pick<HandoverProof, 'cashCollectedIqd' | 'changeToWalletIqd'> {
  const s = doorState(collectIqd, paidIqd);
  if (noChange && s.walletAllowed) return { cashCollectedIqd: paidIqd, changeToWalletIqd: s.changeIqd };
  return { cashCollectedIqd: collectIqd };
}

/** The wallet cap shown when the change is too big for it (25,000). */
export const WALLET_CAP_IQD = CHANGE_RULES.maxIqd;
