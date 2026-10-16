/**
 * Fitting the golden-street photo (`assets/welcome/golden-street.webp`, 1080 × 1910) around the
 * words on the welcome screen: on a short phone the headline would sit on the tuktuk, so the photo
 * grows and slides up (the top is empty sky) until the street clears the words, and the shade
 * darkens just above where the words start.
 */
export const STREET_ASPECT = 1080 / 1910;
/** Where the tuktuk's wheels touch the road, as a share of the photo's height. */
export const STREET_FLOOR = 1210 / 1910;
/** The photo never grows past this share of the screen's height (side crop stays small). */
const MAX_LIFT = 0.4;
const CLEARANCE = 12;

/**
 * How far (px) to lift the photo so the road line ends `CLEARANCE` above `wordsTop`. The photo box is
 * `height + lift` tall, starts `lift` above the screen, and the photo covers it.
 */
export function streetLift(width: number, height: number, wordsTop: number): number {
  if (width <= 0 || height <= 0 || wordsTop <= 0) return 0;
  const target = wordsTop - CLEARANCE;
  // The photo's own height inside a box of `h`: cover shows it whole when the box is the narrower shape.
  const floorAt = (lift: number) => {
    const box = height + lift;
    const photoH = Math.max(box, width / STREET_ASPECT);
    return (box - photoH) / 2 + photoH * STREET_FLOOR - lift;
  };
  if (floorAt(0) <= target) return 0;
  const max = height * MAX_LIFT;
  let lo = 0;
  let hi = max;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (floorAt(mid) > target) lo = mid;
    else hi = mid;
  }
  return Math.round(hi);
}

/** Shade stops (offset 0–1, opacity) for a screen of `height` whose words start at `wordsTop`. */
export function shadeStops(height: number, wordsTop: number): [number, number][] {
  const at = (px: number) => Math.min(1, Math.max(0, px / height));
  const top = wordsTop > 0 ? wordsTop : height * 0.62;
  const clearUntil = Math.max(0.18, at(top - 150));
  const half = Math.max(clearUntil + 0.02, at(top + 16));
  const full = Math.max(half + 0.02, at(top + 120));
  return [
    [0, 0.4],
    [0.14, 0],
    [clearUntil, 0],
    [half, 0.78],
    [Math.min(full, 1), 1],
    [1, 1],
  ];
}
