import type { MessageKey } from '@driver/i18n';
import type { Point } from './geo';
import { closedStreetsGeoJSON, closedStreetsLayers, type ClosedStreetLike } from '@driver/map/pieces/closed-streets';

/**
 * N20 «شارع مسدود», the courier's side: the job's and the offer's road carry the closed streets it was sent
 * around (`OrderRoute.closures`). The map draws them (`ClosureLayer`, or MapLibre itself on the web) and the
 * screen says it in one warning line. Pure, so the rules are tested in Node.
 */

/** What the courier's screens need of a closed street (the contract's `AvoidedStreet` fits it). */
export interface CourierClosure extends ClosedStreetLike {
  extraMin: number;
}

/**
 * The one line a screen shows (never more than one): the street's name when exactly one closure has one, and
 * the minutes the way around adds when the largest is a whole minute or more. Null when the road bends round
 * nothing.
 */
export function closedLine(closures: readonly CourierClosure[] | null | undefined): { key: MessageKey; params?: Record<string, string | number> } | null {
  if (!closures || closures.length === 0) return null;
  const named = closures.filter((c) => c.nameAr && c.nameAr.trim());
  const name = named.length === 1 ? named[0]!.nameAr!.trim() : null;
  const n = Math.max(...closures.map((c) => c.extraMin));
  if (name && n >= 1) return { key: 'partner.closed_line_named_min', params: { name, n } };
  if (name) return { key: 'partner.closed_line_named', params: { name } };
  if (n >= 1) return { key: 'partner.closed_line_min', params: { n } };
  return { key: 'partner.closed_line' };
}

export type ClosedGeoJSON = ReturnType<typeof closedStreetsGeoJSON>;

/** The closed streets as the map piece's GeoJSON, every label the short map word («مسدود»). */
export function closedData(closures: readonly ClosedStreetLike[] | null | undefined, label: string): ClosedGeoJSON {
  return closedStreetsGeoJSON(closures ?? [], () => label);
}

/** The piece's own colours (rust and cream, never alarm red), so the drawn fallback matches the map. */
export function closedColours(night: boolean): { rust: string; cream: string; ink: string; halo: string } {
  const layers = closedStreetsLayers({ source: 'closed', light: night ? 'night' : 'day' });
  const paint = (suffix: string) => (layers.find((l) => l.id.endsWith(suffix)) as { paint?: Record<string, unknown> } | undefined)?.paint ?? {};
  return {
    rust: String(paint('-casing')['line-color']),
    cream: String(paint('-stripes')['line-color']),
    ink: String(paint('-label')['text-color']),
    halo: String(paint('-label')['text-halo-color']),
  };
}

/** The label pill's height, px (`ClosureLayer`). */
export const LABEL_PILL_H = 24;
/** Roughly how wide «مسدود» sits in its pill, px: how far a label beside a street that runs up the screen moves. */
const LABEL_TEXT_W = 60;
/** Room between the closed stretch and its label, px. */
const LABEL_GAP = 10;

/**
 * Where a label goes: beside its stretch's middle, square to the street, on the side away from the road (the
 * road is drawn over this layer, and it passes close by: it was just bent round this street).
 */
export function labelBeside(mid: Point, a: Point, b: Point, road: readonly Point[]): Point {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  if (len === 1 && a.x === b.x && a.y === b.y) n = { x: 0, y: -1 };
  // The road's nearest point to the stretch's middle (on its segments, not just its corners).
  let near: Point | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < road.length; i++) {
    const p = road[i]!;
    const q = road[i + 1] ?? p;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((mid.x - p.x) * dx + (mid.y - p.y) * dy) / l2));
    const c = { x: p.x + dx * t, y: p.y + dy * t };
    const d = Math.hypot(c.x - mid.x, c.y - mid.y);
    if (d < best) {
      best = d;
      near = c;
    }
  }
  // Away from the road; with no road, above (the way the map's own label sits).
  if (near ? n.x * (near.x - mid.x) + n.y * (near.y - mid.y) > 0 : n.y > 0) n = { x: -n.x, y: -n.y };
  const d = LABEL_GAP + Math.abs(n.y) * (LABEL_PILL_H / 2) + Math.abs(n.x) * (LABEL_TEXT_W / 2);
  return { x: mid.x + n.x * d, y: mid.y + n.y * d };
}

