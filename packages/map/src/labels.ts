import type { GeoPoint } from './project.js';

/**
 * How close (px) a zone name may come to a marker before it is hidden. A name drawn under a pin's
 * stem or the restaurant dot reads as part of the marker («شارع 30» under «مطعم خالد»), so it goes.
 */
export const LABEL_MARKER_CLEARANCE_PX = 40;

/** Zone names are drawn at this size (SVG text, px). */
export const ZONE_LABEL_FONT_PX = 11;

/**
 * Average Arabic glyph width as a share of the font size (IBM Plex Sans Arabic, medium). Only used
 * to estimate a label's box; a little generous so a name is never judged clear when it is not.
 */
const GLYPH_WIDTH_EM = 0.58;

/** A marker on screen: its anchor (the tip, where it touches the ground) and how far it rises above. */
export interface ScreenMarker {
  x: number;
  y: number;
  /** Height of the marker above its anchor, px (a centre pin's head sits well above its tip). 0 = a dot. */
  up?: number;
}

/** Something a map wants zone names kept away from: a place on the ground, or the fixed centre pin. */
export type LabelObstacle = { at: GeoPoint; up?: number } | { centre: true; up?: number };

/** A zone name at its anchor: SVG text centred on `x` with its baseline on `y`. */
export interface PlacedLabel {
  x: number;
  y: number;
  name: string;
}

/** The box a centred label takes, from its text length and font size. */
export function labelBox(label: PlacedLabel, fontPx = ZONE_LABEL_FONT_PX): { left: number; right: number; top: number; bottom: number } {
  const half = (label.name.length * fontPx * GLYPH_WIDTH_EM) / 2;
  return { left: label.x - half, right: label.x + half, top: label.y - fontPx, bottom: label.y + fontPx * 0.3 };
}

/** Shortest distance (px) between a label's box and a marker (a vertical segment from its anchor up). */
export function labelMarkerGap(label: PlacedLabel, marker: ScreenMarker, fontPx = ZONE_LABEL_FONT_PX): number {
  const box = labelBox(label, fontPx);
  const top = marker.y - (marker.up ?? 0);
  const dx = Math.max(box.left - marker.x, marker.x - box.right, 0);
  const dy = Math.max(box.top - marker.y, top - box.bottom, 0);
  return Math.hypot(dx, dy);
}

/**
 * The zone names that stay clear of every marker: a name within `clearance` px of a pin, the courier
 * or the centre pin is dropped rather than drawn under it (QA 2026-10-07: «شارع 30» under the place
 * editor's pin and the restaurant on the share page). Order is kept.
 */
export function labelsClearOf<T extends PlacedLabel>(labels: readonly T[], markers: readonly ScreenMarker[], clearance = LABEL_MARKER_CLEARANCE_PX, fontPx = ZONE_LABEL_FONT_PX): T[] {
  if (markers.length === 0) return [...labels];
  return labels.filter((l) => markers.every((m) => labelMarkerGap(l, m, fontPx) >= clearance));
}

/**
 * Obstacles as screen markers for one camera: places through the map's own `project`, the centre pin
 * at the middle of the map (`size`). Both apps' zone layers share this so they hide names alike.
 */
export function obstaclesOnScreen(obstacles: readonly LabelObstacle[], size: { w: number; h: number }, project: (p: GeoPoint) => { x: number; y: number }): ScreenMarker[] {
  return obstacles.map((o) => {
    const at = 'centre' in o ? { x: size.w / 2, y: size.h / 2 } : project(o.at);
    return { x: at.x, y: at.y, up: o.up ?? 0 };
  });
}

/** A box on screen, px (y grows down). */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a pin's name pill sits: over its tip (the default) or flipped under it. */
export type PinLabelSide = 'above' | 'below';

/** A pin's name pill: its size, and how far its near edge sits from the tip on each side. */
export interface PinLabelLayout {
  width: number;
  height: number;
  /** Tip to the pill's bottom edge when it sits above (the stem and the tip dot between). */
  gapAbove: number;
  /** Tip to the pill's top edge when it is flipped below. */
  gapBelow: number;
}

/** Room kept between a pin's name and the courier before the name flips, px. */
export const PIN_LABEL_CLEARANCE_PX = 4;

/**
 * How wide a pin's name pill draws: the text (estimated like the zone names) plus the icon, gap and
 * padding around it, never wider than the pill's cap.
 */
export function pinLabelWidth(text: string, fontPx: number, chromePx: number, maxPx: number): number {
  return Math.min(maxPx, chromePx + text.length * fontPx * GLYPH_WIDTH_EM);
}

/** The pill's box for a pin whose tip is at `tip`, on `side`. */
export function pinLabelRect(tip: { x: number; y: number }, side: PinLabelSide, layout: PinLabelLayout): ScreenRect {
  const half = layout.width / 2;
  const top = side === 'above' ? tip.y - layout.gapAbove - layout.height : tip.y + layout.gapBelow;
  return { left: tip.x - half, right: tip.x + half, top, bottom: top + layout.height };
}

/** True when two boxes come closer than `margin` px (touching counts when margin is 0). */
export function rectsOverlap(a: ScreenRect, b: ScreenRect, margin = 0): boolean {
  return a.left < b.right + margin && b.left < a.right + margin && a.top < b.bottom + margin && b.top < a.bottom + margin;
}

/**
 * Which side of its pin a name goes (QA 2026-10-07: on the pickup leg the courier's disc, drawn over
 * the pins, hid the start of «مطعم خالد»). Above unless the courier (`movers`) covers it there and
 * not below; when both sides are covered it stays above, where people look for it.
 */
export function pinLabelSide(tip: { x: number; y: number }, movers: readonly ScreenRect[], layout: PinLabelLayout, margin = PIN_LABEL_CLEARANCE_PX): PinLabelSide {
  const hit = (side: PinLabelSide) => {
    const r = pinLabelRect(tip, side, layout);
    return movers.some((m) => rectsOverlap(r, m, margin));
  };
  return hit('above') && !hit('below') ? 'below' : 'above';
}
