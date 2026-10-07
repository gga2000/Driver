/**
 * The «بالعافية» burst (Ali's Yes, home effects "confetti", 2026-10-07): where each tiny dish is at
 * the burst's progress `a` (0 → 1, `BURST_MS`). Plain maths run on the UI thread by `DishBurst`; it
 * starts and ends with every dish hidden, so a burst cut short leaves nothing on screen.
 */

/** The whole burst; the celebration cap (`motion.duration.celebrate`). */
export const BURST_MS = 900;

export interface BurstBit {
  /** Direction out from the middle (radians; 0 is the end side, −π/2 straight up). */
  angle: number;
  /** How far it flies (px). */
  distance: number;
  /** Its share of the burst it waits before leaving (0–0.2), so they don't all go at once. */
  delay: number;
  /** Turns this many degrees on the way. */
  spin: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Nine dishes in a fan, most of them up and out to the sides, each with its own reach, start and spin. */
export const BURST_BITS: readonly BurstBit[] = [
  { angle: deg(-90), distance: 132, delay: 0, spin: -40 },
  { angle: deg(-128), distance: 118, delay: 0.06, spin: 70 },
  { angle: deg(-52), distance: 122, delay: 0.04, spin: -80 },
  { angle: deg(-166), distance: 140, delay: 0.1, spin: 110 },
  { angle: deg(-14), distance: 136, delay: 0.08, spin: -110 },
  { angle: deg(-108), distance: 96, delay: 0.16, spin: 50 },
  { angle: deg(-72), distance: 100, delay: 0.12, spin: -60 },
  { angle: deg(158), distance: 104, delay: 0.14, spin: 90 },
  { angle: deg(22), distance: 108, delay: 0.18, spin: -90 },
];

const clamp01 = (t: number) => {
  'worklet';
  return Math.min(1, Math.max(0, t));
};

/** One dish at progress `a`: out fast and slowing, pulled down a little, popping in and fading out. */
export function burstAt(a: number, bit: BurstBit): { x: number; y: number; scale: number; rotate: number; opacity: number } {
  'worklet';
  const t = clamp01((clamp01(a) - bit.delay) / (1 - bit.delay));
  if (t === 0 || t === 1) return { x: 0, y: 0, scale: 0, rotate: 0, opacity: 0 };
  const out = 1 - (1 - t) ** 3;
  return {
    x: Math.cos(bit.angle) * bit.distance * out,
    y: Math.sin(bit.angle) * bit.distance * out + 34 * t * t,
    scale: 0.4 + 0.6 * Math.min(1, t / 0.2),
    rotate: bit.spin * out,
    opacity: t < 0.1 ? t / 0.1 : t > 0.65 ? (1 - t) / 0.35 : 1,
  };
}
