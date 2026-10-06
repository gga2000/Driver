import type { MessageKey } from '@driver/i18n';

/**
 * The short lines around the checkout button (joy o7, o9, o12) as plain data: what the order earns,
 * who pays what and how, and what the courier is told when someone else receives it. Amounts and
 * points are the server's (`orders.quote`); these only pick the words.
 */

export interface Copy {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** «تكسب 27 نقطة», or on a group order «هذا الطلب يجيب 27 نقطة، تتقسم عليكم» (they split by person). */
export function earnCopy(pointsEarn: number | null | undefined, grouped: boolean): Copy | null {
  if (!pointsEarn || pointsEarn <= 0) return null;
  return grouped ? { key: 'checkout.earn_shared', params: { n: pointsEarn } } : { key: 'checkout.earn', params: { n: pointsEarn } };
}

/** Who receives the order: me, or someone else by name. */
export type Receiver = { kind: 'me' } | { kind: 'other'; name: string };

/**
 * The one line under the checkout button (o9): «تدفع 7,250 دينار كاش للدليفري», «أبو علي يدفع 7,250
 * دينار كاش للدليفري», or «تدفع 7,250 دينار من محفظتك».
 */
export function payCopy(amount: string, payment: 'cash' | 'wallet', receiver: Receiver): Copy {
  if (payment === 'wallet') return { key: 'checkout.pay_line_wallet', params: { amount } };
  return receiver.kind === 'other' ? { key: 'checkout.pay_line_cash_them', params: { amount, name: receiver.name } } : { key: 'checkout.pay_line_cash', params: { amount } };
}

/**
 * Ordering for someone else (o12): «منو يدفع؟» maps onto the payment methods that already exist —
 * they pay cash at the door, or I pay now from my wallet. No new money rule.
 */
export type Payer = 'them_cash' | 'me_wallet';

export function payerOf(payment: 'cash' | 'wallet'): Payer {
  return payment === 'wallet' ? 'me_wallet' : 'them_cash';
}

export function paymentOf(payer: Payer): 'cash' | 'wallet' {
  return payer === 'me_wallet' ? 'wallet' : 'cash';
}

/** What the courier will (and won't) ask the receiver, said to the orderer before placing. */
export function receiverHint(name: string, payment: 'cash' | 'wallet'): Copy {
  return payment === 'wallet' ? { key: 'checkout.receiver_paid_hint', params: { name } } : { key: 'checkout.receiver_cash_hint', params: { name } };
}
