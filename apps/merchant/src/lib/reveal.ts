/** A vertical span in window coordinates, px. */
export interface Span {
  top: number;
  height: number;
}

/** Room kept above a row taller than the visible area when it is scrolled to, px. */
export const REVEAL_EDGE_PX = 16;

/**
 * Where a scroll view should scroll so `target` is in view: null when it already is (a tablet that
 * shows the list beside the map only highlights the row), else the offset that centres it in the
 * visible area — or puts its top near the top when it is taller than the area. Never above 0.
 */
export function revealOffset(target: Span, viewport: Span, offset: number): number | null {
  const visible = target.top >= viewport.top && target.top + target.height <= viewport.top + viewport.height;
  if (visible) return null;
  const fromTop = target.height > viewport.height ? REVEAL_EDGE_PX : (viewport.height - target.height) / 2;
  return Math.max(0, Math.round(offset + target.top - viewport.top - fromTop));
}
