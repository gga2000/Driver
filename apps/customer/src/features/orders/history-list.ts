import type { DayKey } from './history';

/**
 * طلباتي as one flat list (speed m1): a fast list draws only the rows on screen, so a customer with
 * months of orders scrolls as smoothly as one with three. Each section becomes a label then its rows,
 * and every row knows whether it opens or closes its card, so the rows still read as one card.
 */
export type HistoryListItem<C, R> =
  | { type: 'label'; key: string; label: { kind: 'trips' } | { kind: 'running' } | { kind: 'day'; day: DayKey | null }; first: boolean }
  | { type: 'coming'; key: string; value: C; first: boolean; last: boolean }
  | { type: 'row'; key: string; value: R; tint: boolean; first: boolean; last: boolean };

export function flattenHistory<C, R>(
  coming: readonly C[],
  sections: readonly { id: string; running?: boolean; day?: DayKey | null; rows: readonly R[] }[],
  keyOf: { coming: (c: C) => string; row: (r: R) => string },
): HistoryListItem<C, R>[] {
  const out: HistoryListItem<C, R>[] = [];
  if (coming.length > 0) {
    out.push({ type: 'label', key: 'label:trips', label: { kind: 'trips' }, first: true });
    coming.forEach((c, i) => out.push({ type: 'coming', key: `coming:${keyOf.coming(c)}`, value: c, first: i === 0, last: i === coming.length - 1 }));
  }
  for (const s of sections) {
    if (s.rows.length === 0) continue;
    out.push({ type: 'label', key: `label:${s.id}`, label: s.running ? { kind: 'running' } : { kind: 'day', day: s.day ?? null }, first: out.length === 0 });
    const tint = Boolean(s.running);
    s.rows.forEach((r, i) => out.push({ type: 'row', key: `row:${keyOf.row(r)}`, value: r, tint, first: i === 0, last: i === s.rows.length - 1 }));
  }
  return out;
}
