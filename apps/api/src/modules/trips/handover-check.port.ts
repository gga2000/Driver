import type { HandoverProof } from '@driver/contracts';

/**
 * "الخردة علينا" (Phase 3, 2026-10-05): before a drop-off hand-over is recorded, the orders module
 * checks the cash on it against the order (trips knows no money). A courier with no change may take
 * the customer's whole note and put the rest in his wallet (`changeToWalletIqd`): cash orders only,
 * equal to collected − total, > 0, in 250s, at most the cap. Orders binds the real check at start-up
 * (orders depends on trips, not the other way round), like dispatch's offer check.
 *
 * Until it is bound, `NoChangeToWallet` lets ordinary hand-overs through and refuses any
 * change-to-wallet (fail closed for the new money movement).
 */
export type HandoverProblem = 'change_to_wallet_not_cash' | 'change_to_wallet_mismatch' | 'change_to_wallet_above_cap';

export interface TripHandoverCheck {
  /** Null when the hand-over may be recorded as given. */
  check(orderId: string | null, handover: Pick<HandoverProof, 'cashCollectedIqd' | 'changeToWalletIqd'>): Promise<HandoverProblem | null>;
}

export class NoChangeToWallet implements TripHandoverCheck {
  async check(_orderId: string | null, handover: Pick<HandoverProof, 'changeToWalletIqd'>): Promise<HandoverProblem | null> {
    return handover.changeToWalletIqd !== undefined ? 'change_to_wallet_not_cash' : null;
  }
}
