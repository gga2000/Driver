/**
 * Per-kitchen caps on scheduled slots (customer joy J6, research 6 E3 "kitchen overload at one
 * moment"). In Ramadan most of a day's orders want the same «على الفطور» slot. The Merchant app has
 * no capacity setting yet, so the cap is server config here, **off by default** (`perSlot: null`);
 * ops can switch it on for the city or for one kitchen. Checked at placement, best effort (two
 * orders racing for the last place can both pass).
 */
export interface SlotCapRules {
  /** Scheduled orders one kitchen takes per slot; null = no cap. */
  perSlot: number | null;
  /** A kitchen's own cap (null = none for that kitchen), overriding `perSlot`. */
  byMerchant: Readonly<Record<string, number | null>>;
  /** Orders scheduled within half of this many minutes either side share a slot. */
  windowMin: number;
}

export const SLOT_CAP_RULES: SlotCapRules = { perSlot: null, byMerchant: {}, windowMin: 30 };

/** This kitchen's cap per slot, or null when uncapped. */
export function slotCapFor(rules: SlotCapRules, merchantOrgId: string): number | null {
  return merchantOrgId in rules.byMerchant ? (rules.byMerchant[merchantOrgId] ?? null) : rules.perSlot;
}

/** How many of the kitchen's live scheduled orders fall in the slot around `at`. */
export function slotTaken(scheduled: ReadonlyArray<Date | null>, at: Date, windowMin: number): number {
  const half = (windowMin / 2) * 60_000;
  return scheduled.filter((s) => s !== null && Math.abs(s.getTime() - at.getTime()) < half).length;
}

/** True when one more order for `at` would go over the kitchen's cap. */
export function slotFull(rules: SlotCapRules, merchantOrgId: string, at: Date, scheduled: ReadonlyArray<Date | null>): boolean {
  const cap = slotCapFor(rules, merchantOrgId);
  return cap !== null && slotTaken(scheduled, at, rules.windowMin) >= cap;
}
