/**
 * Geometry of a segmented ring (the Partner end-of-job ring, audit S-3): one arc per item, a small
 * gap between them, the first starting at 12 o'clock and going clockwise. Pure, so the arcs are
 * testable without SVG.
 */

/** More segments than this read as noise: the ring becomes one continuous arc. */
export const RING_MAX_SEGMENTS = 20;

export interface RingArc {
  /** Arc length along the circle (px). */
  length: number;
  /** Where the arc starts, in degrees clockwise from 12 o'clock. */
  startDeg: number;
}

/**
 * Arcs for `count` segments on a circle of circumference `circ` with `gap` px between them. A single
 * item, or more than `RING_MAX_SEGMENTS`, is one full arc.
 */
export function ringArcs(count: number, circ: number, gap = 6): RingArc[] {
  if (count <= 0 || circ <= 0) return [];
  if (count === 1 || count > RING_MAX_SEGMENTS) return [{ length: circ, startDeg: 0 }];
  const slot = circ / count;
  const length = Math.max(1, slot - gap);
  return Array.from({ length: count }, (_, i) => ({ length, startDeg: ((i * slot + gap / 2) / circ) * 360 }));
}
