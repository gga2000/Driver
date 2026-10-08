import { MERCHANT_BUSY_RULES } from '@driver/contracts';
import type { MerchantProfile } from './merchants.port.js';

/**
 * Busy mode (Driver Merchant spec): while the kitchen is busy every prep time it commits to — the
 * one staff pick on accept, the auto-accept default and the scheduled-order lead — gets the extra the
 * shop picked (r5: +10 or +20 min; +10 when none was picked), so the promised ready time, the
 * courier's timing and the customer's ETA all move together. It switches itself off at `busyUntil`
 * (set to now + 60 min by `merchant.setBusy`).
 */
export function busyExtraMinutes(profile: Pick<MerchantProfile, 'busyUntil' | 'busyExtraMin'> | null | undefined, at: Date): number {
  const until = profile?.busyUntil;
  if (!until || until.getTime() <= at.getTime()) return 0;
  const picked = profile?.busyExtraMin;
  return picked != null && (MERCHANT_BUSY_RULES.extraChoices as readonly number[]).includes(picked) ? picked : MERCHANT_BUSY_RULES.extraPrepMinutes;
}
