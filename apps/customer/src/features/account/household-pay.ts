import type { HouseholdView } from '@driver/contracts';

/**
 * RDB-03: nothing credits the household account yet, so an order paid «من حساب البيت» can never go
 * through (the server answers "not enough balance"). Ali, 2026-10-08: hide the household pay option
 * for now. Checkout offers only cash and his own wallet while this is off; the household hub, its
 * members, limits and approvals, and the server side stay as they are. Turn it on only once there is
 * a way to fund the household account.
 */
export const HOUSEHOLD_PAY_ENABLED = false;

/**
 * The household checkout may offer to pay from: his household when the option is on and he is its
 * payer or an orderer (plain members never pay from it); otherwise null, and checkout shows no row.
 */
export function householdToPayFrom(household: HouseholdView | null | undefined, enabled: boolean = HOUSEHOLD_PAY_ENABLED): HouseholdView | null {
  if (!enabled || !household || household.myRole === 'member') return null;
  return household;
}
