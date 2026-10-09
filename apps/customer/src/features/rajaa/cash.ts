import type { RequestOfferView } from '@driver/contracts';

/**
 * Step 4b a6 «احجز وادفع كاش» on one offer, as the pick panel shows it:
 * - `none`: switched off, or his wallet covers the deposit (nothing to ask);
 * - `owed`: he still owes from an earlier trip, so cash waits until that is paid;
 * - `ask` → `asked` → `accepted` | `declined`: his ask to this driver and the driver's answer.
 */
export type CashPhase = 'none' | 'owed' | 'ask' | 'asked' | 'accepted' | 'declined';

export function cashPhase(on: boolean, offer: Pick<RequestOfferView, 'cash'>, walletIqd: number | null, depositIqd: number): CashPhase {
  if (!on) return 'none';
  // Already asked or answered: the answer stands whatever his balance does now.
  if (offer.cash === 'accepted' || offer.cash === 'asked' || offer.cash === 'declined') {
    return walletIqd !== null && walletIqd < 0 ? 'owed' : offer.cash;
  }
  if (walletIqd !== null && walletIqd < 0) return 'owed';
  // a6: asked when the wallet can't hold the deposit (an unknown balance offers it too; the server decides).
  return walletIqd === null || walletIqd < depositIqd ? 'ask' : 'none';
}
