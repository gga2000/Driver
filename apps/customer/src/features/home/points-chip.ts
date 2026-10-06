import type { WalletBalanceView } from '@driver/contracts';
import { groupDigits } from '@/lib/money';

/**
 * The header's points chip (joy h9, discovery D-07/D-21): until a real inbox exists, the slot of the
 * empty bell shows the person's points («1,250 نقطة», opens the wallet). Display only: the number is
 * the server's balance, nothing is earned or spent here. Hidden for guests, while the balance is
 * unknown, and at zero (an empty chip would be the empty bell again).
 */
export function pointsChip(signedIn: boolean, balance: Pick<WalletBalanceView, 'points'> | null | undefined): { points: number; text: string } | null {
  if (!signedIn || !balance || balance.points <= 0) return null;
  return { points: balance.points, text: groupDigits(balance.points) };
}
