/**
 * Map label placement without collisions (K-09). Greedy, highest priority first: each label tries
 * above, below, then beside its anchor; it takes the first spot that stays on screen and touches
 * neither a placed label nor an obstacle (driver markers, order tags). A label with no free spot is
 * hidden until the person zooms in. Pure, so it is tested without a map.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelIn {
  id: string;
  /** Anchor in screen pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Higher places first (garages over zone names). */
  priority: number;
  /** Space between the anchor and the label (clears the marker drawn at the anchor). */
  gap?: number;
}

/** Top-left offset of the label from its anchor, or null when it's hidden. */
export type Placement = { dx: number; dy: number } | null;

export function overlaps(a: Box, b: Box, pad = 2): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

export function placeLabels(labels: readonly LabelIn[], obstacles: readonly Box[], viewport: { w: number; h: number }): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const placed: Box[] = [];
  const order = [...labels].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const l of order) {
    const g = l.gap ?? 6;
    const spots: Array<{ dx: number; dy: number }> = [
      { dx: -l.w / 2, dy: -l.h - g }, // above
      { dx: -l.w / 2, dy: g }, // below
      { dx: g, dy: -l.h / 2 }, // right
      { dx: -l.w - g, dy: -l.h / 2 }, // left
    ];
    let chosen: Placement = null;
    for (const s of spots) {
      const box = { x: l.x + s.dx, y: l.y + s.dy, w: l.w, h: l.h };
      if (box.x < 0 || box.y < 0 || box.x + box.w > viewport.w || box.y + box.h > viewport.h) continue;
      if (placed.some((p) => overlaps(p, box)) || obstacles.some((o) => overlaps(o, box, 0))) continue;
      chosen = s;
      placed.push(box);
      break;
    }
    out.set(l.id, chosen);
  }
  return out;
}

export interface TagIn {
  id: string;
  /** The tag's box on screen. */
  box: Box;
  /** Orders this tag already stands for. */
  count: number;
  /** Lower is more urgent (shown first, absorbs the others). */
  rank: number;
}

/**
 * Order tags that would overlap on screen fold into the most urgent one: it stays, the others hide,
 * and its count grows ("#4816 +3"). Zooming in splits them apart again.
 */
export function stackTags(tags: readonly TagIn[]): Map<string, { shown: boolean; total: number }> {
  const out = new Map<string, { shown: boolean; total: number }>();
  const hosts: Array<{ id: string; box: Box; total: number }> = [];
  for (const tag of [...tags].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))) {
    const host = hosts.find((h) => overlaps(h.box, tag.box, 4));
    if (host) {
      host.total += tag.count;
      out.set(tag.id, { shown: false, total: tag.count });
      continue;
    }
    hosts.push({ id: tag.id, box: tag.box, total: tag.count });
  }
  for (const h of hosts) out.set(h.id, { shown: true, total: h.total });
  return out;
}

/** A square obstacle of `size` px centred on a screen point. */
export function around(x: number, y: number, size: number): Box {
  return { x: x - size / 2, y: y - size / 2, w: size, h: size };
}
