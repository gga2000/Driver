import { motifForDish, temperatureOf, type Temperature } from '@driver/ui/dishes';

/**
 * j6 / k4 (Ali, 2026-10-09 "yes build them"): what kind of thing a ticket line is, so the kitchen
 * sees the drinks and the sweets at a glance, and whether it travels hot or cold, so the bag is
 * packed right. Read from the dish's name with the same rules as the menu's glass display and the
 * customer's dish cards (`@driver/ui/dishes`), so all three always agree.
 */
export type LineKind = 'kitchen' | 'drink' | 'sweet';

export interface LineLook {
  kind: LineKind;
  /** Hot or cold for a drink (and ice cream); null when the dish says neither. */
  temp: Temperature | null;
}

const SWEETS: ReadonlySet<string> = new Set(['icecream', 'baklava', 'zalabia', 'kleicha', 'cake', 'sweet']);
/** Kitchen dishes that are not hot food (they don't need keeping away from the cold bag). */
const COOL_FOOD: ReadonlySet<string> = new Set(['salad', 'pickles']);

export function lineLook(name: string, section?: string): LineLook {
  const temp = temperatureOf(name, section);
  if (temp) return { kind: 'drink', temp };
  const motif = motifForDish(name, section);
  if (SWEETS.has(motif)) return { kind: 'sweet', temp: motif === 'icecream' ? 'cold' : null };
  return { kind: 'kitchen', temp: null };
}

/** Whether a line keeps warm in the bag: hot drinks and the kitchen's cooked food. */
function isHot(name: string): boolean {
  const look = lineLook(name);
  if (look.temp) return look.temp === 'hot';
  return look.kind === 'kitchen' && !COOL_FOOD.has(motifForDish(name));
}

/**
 * k4: how many cold and hot pieces go in one order's bag; null unless it has both, the only case
 * where the counter needs telling «البارد بكيس وحده».
 */
export function packApart(lines: readonly { name: string; qty: number; availability?: string }[]): { cold: number; hot: number } | null {
  let cold = 0;
  let hot = 0;
  for (const l of lines) {
    if (l.availability === 'removed' || l.availability === 'unavailable') continue;
    if (lineLook(l.name).temp === 'cold') cold += l.qty;
    else if (isHot(l.name)) hot += l.qty;
  }
  return cold > 0 && hot > 0 ? { cold, hot } : null;
}
