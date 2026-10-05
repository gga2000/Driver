import { AZIZIYAH_MONEY_RULES, CASH_STEP_IQD } from './ledger-rules.js';

/**
 * "الخردة علينا" (UI/UX audit Phase 3, customer d-1 / partner S-2; 2026-10-05, awaiting Ali's final OK):
 * the cash hand-off as a feature. Pure rules shared by the API (which decides), the customer app
 * (checkout chips) and the Partner app (the door helper), so the numbers are the same everywhere.
 *
 * - The customer may say which note he will pay with ("راح أدفع بـ 25,000"): a hint for the courier
 *   to bring change, never money. Nullable; the server checks it is ≥ his total and ≤ total + 50,000.
 * - At the door the courier records what he took. With no change on him he may take the whole note
 *   and the rest goes to the customer's wallet (`changeToWalletIqd`, ledger `cash_change_to_wallet`):
 *   only on cash orders, a multiple of 250, more than 0 and at most the cap (25,000); the server
 *   recomputes it (collected − total) and refuses any other figure.
 */

/** The Iraqi notes people pay a courier with (250 / 500 / 1,000 coins and notes are the change). */
export const IRAQI_NOTES_IQD = [5_000, 10_000, 20_000, 25_000, 50_000] as const;

/** At most this many "راح أدفع بـ …" chips: the exact amount and the next notes above it. */
export const TENDER_CHIPS_MAX = 4;

export interface ChangeRules {
  /** Most that may go to the wallet in one hand-over. */
  maxIqd: number;
  /** Highest stated note above the total. */
  tenderMaxOverIqd: number;
  /** Notes and change move in 250s. */
  stepIqd: number;
}

export const CHANGE_RULES: ChangeRules = {
  maxIqd: AZIZIYAH_MONEY_RULES.changeToWallet.maxIqd,
  tenderMaxOverIqd: AZIZIYAH_MONEY_RULES.changeToWallet.tenderMaxOverIqd,
  stepIqd: CASH_STEP_IQD,
};

/**
 * The checkout chips for a cash total: the exact amount first, then the single notes above it
 * (5,000 / 10,000 / 20,000 / 25,000 / 50,000), at most `TENDER_CHIPS_MAX` in all. A total above
 * every note gets the exact amount only (the customer counts several notes himself).
 */
export function tenderOptions(totalIqd: number, rules: Pick<ChangeRules, 'tenderMaxOverIqd'> = CHANGE_RULES): number[] {
  if (!(totalIqd > 0)) return [];
  const notes = IRAQI_NOTES_IQD.filter((n) => n > totalIqd && n - totalIqd <= rules.tenderMaxOverIqd);
  return [totalIqd, ...notes].slice(0, TENDER_CHIPS_MAX);
}

export type TenderProblem = 'below_total' | 'above_cap' | 'not_step';

/** Server and client check of a stated note; null when it is fine. */
export function tenderProblem(tenderIqd: number, totalIqd: number, rules: Pick<ChangeRules, 'tenderMaxOverIqd' | 'stepIqd'> = CHANGE_RULES): TenderProblem | null {
  if (!Number.isInteger(tenderIqd) || tenderIqd < totalIqd) return 'below_total';
  if (tenderIqd - totalIqd > rules.tenderMaxOverIqd) return 'above_cap';
  if (tenderIqd % rules.stepIqd !== 0) return 'not_step';
  return null;
}

/** The courier's note to the customer: change he should hand back for a note (0 when exact or short). */
export function changeDue(paidIqd: number, totalIqd: number): number {
  return Math.max(0, paidIqd - totalIqd);
}

export type ChangeToWalletProblem = 'not_cash' | 'mismatch' | 'not_positive' | 'above_cap' | 'not_step';

/**
 * Whether a hand-over may put `changeToWalletIqd` into the customer's wallet: a cash order, the
 * figure equal to collected − total (recomputed, never trusted), above 0, a multiple of 250 and at
 * most the cap. Null when it may. The Partner app uses the same check to offer the button.
 */
export function changeToWalletProblem(
  input: { paymentMethod: string; totalIqd: number; collectedIqd: number; changeToWalletIqd: number },
  rules: Pick<ChangeRules, 'maxIqd' | 'stepIqd'> = CHANGE_RULES,
): ChangeToWalletProblem | null {
  if (input.paymentMethod !== 'cash') return 'not_cash';
  if (!Number.isInteger(input.changeToWalletIqd) || input.collectedIqd - input.totalIqd !== input.changeToWalletIqd) return 'mismatch';
  if (input.changeToWalletIqd <= 0) return 'not_positive';
  if (input.changeToWalletIqd > rules.maxIqd) return 'above_cap';
  if (input.changeToWalletIqd % rules.stepIqd !== 0) return 'not_step';
  return null;
}
