import { pointInRing, type LatLng, type ZonePinCheck, type ZonePinCheckMove, type ZonePlacementView, type ZoneTier, type ZoneTierFare } from '@driver/contracts';

/** Most "from → to" rows the report lists (the biggest first). */
const MAX_MOVES = 20;

/**
 * Admin dry run for «الأسعار تتبع الحدود»: for each recent delivery pin, the area the built-in circles
 * give (`circleOf`) against the area the drawn outlines give (a drawn outline that holds the pin wins,
 * otherwise the circle rule, exactly as the switch would behave). Fee change is the delivery fare from the
 * town centre by group, so it shows the direction and size without pretending to be a quote. Pure:
 * nothing is read or written here and no pin leaves it.
 */
export function pinCheck(
  cityId: string,
  pins: readonly LatLng[],
  zones: readonly ZonePlacementView[],
  fares: readonly ZoneTierFare[],
  circleOf: (pin: LatLng) => string | null,
): ZonePinCheck {
  const drawn = zones.filter((z) => z.placement !== 'draft');
  const tierOf = new Map<string, ZoneTier>(zones.map((z) => [z.key, z.tier]));
  const deliveryOf = (key: string | null): number | null => {
    const tier = key ? tierOf.get(key) : undefined;
    return tier ? (fares.find((f) => f.tier === tier)?.deliveryIqd ?? null) : null;
  };

  const moves = new Map<string, { fromKey: string | null; toKey: string; pins: number; feeChangeIqd: number | null }>();
  let changed = 0;
  let newlyServed = 0;
  let dearer = 0;
  let cheaper = 0;
  let feeSum = 0;

  for (const pin of pins) {
    const circle = circleOf(pin);
    const inside = drawn.find((z) => pointInRing(pin, z.ring));
    if (!inside || inside.key === circle) continue;
    const outline = inside.key;
    changed += 1;
    const before = deliveryOf(circle);
    const after = deliveryOf(outline);
    let change: number | null = null;
    if (circle === null) newlyServed += 1;
    else if (before !== null && after !== null) {
      change = after - before;
      feeSum += change;
      if (change > 0) dearer += 1;
      else if (change < 0) cheaper += 1;
    }
    const id = `${circle ?? ''}>${outline}`;
    const row = moves.get(id);
    if (row) row.pins += 1;
    else moves.set(id, { fromKey: circle, toKey: outline, pins: 1, feeChangeIqd: change });
  }

  const list: ZonePinCheckMove[] = [...moves.values()].sort((a, b) => b.pins - a.pins || (a.fromKey ?? '').localeCompare(b.fromKey ?? '')).slice(0, MAX_MOVES);
  return {
    cityId,
    pins: pins.length,
    drawnZones: drawn.length,
    changed,
    newlyServed,
    dearer,
    cheaper,
    avgFeeChangeIqd: pins.length ? Math.round(feeSum / pins.length) : 0,
    moves: list,
  };
}
