import { MERCHANT_BUSY_RULES } from '@driver/contracts';
import type { MerchantProfile } from './merchants.port.js';

/**
 * Busy mode (Driver Merchant spec): while the kitchen is busy every prep time it commits to — the
 * one staff pick on accept, the auto-accept default and the scheduled-order lead — gets +10 min, so
 * the promised ready time, the courier's timing and the customer's ETA all move together. It
 * switches itself off at `busyUntil` (set to now + 60 min by `merchant.setBusy`).
 */
export function busyExtraMinutes(profile: Pick<MerchantProfile, 'busyUntil'> | null | undefined, at: Date): number {
  const until = profile?.busyUntil;
  return until && until.getTime() > at.getTime() ? MERCHANT_BUSY_RULES.extraPrepMinutes : 0;
}
