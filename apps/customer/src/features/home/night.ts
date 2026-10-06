/**
 * Home at night (f12, UI/UX audit D-03): when no kitchen is open the food section is not a dead end.
 * It names the first kitchen to open and when («أول واحد يفتح: مطعم المسافر الساعة 5:00») with a
 * way into its menu, and keeps the cuisine chips from every kitchen. Minutes to opening come from
 * the server (`RestaurantCard.opensInMin`).
 */
export interface NightKitchen {
  id: string;
  name: string;
  open: boolean;
  /** 12-hour "5:00" when closed. */
  opensAt?: string;
  opensInMin?: number;
}

/** The closed kitchen that opens soonest (it must have an opening time to show); null when none. */
export function firstToOpen<K extends NightKitchen>(kitchens: readonly K[]): K | null {
  let best: K | null = null;
  for (const k of kitchens) {
    if (k.open || k.opensInMin === undefined || !k.opensAt) continue;
    if (!best || k.opensInMin < (best.opensInMin ?? Number.POSITIVE_INFINITY)) best = k;
  }
  return best;
}

/** Night: there are kitchens and none is open — then which one opens first. */
export function nightHome<K extends NightKitchen>(kitchens: readonly K[]): { night: boolean; first: K | null } {
  const night = kitchens.length > 0 && kitchens.every((k) => !k.open);
  return { night, first: night ? firstToOpen(kitchens) : null };
}
