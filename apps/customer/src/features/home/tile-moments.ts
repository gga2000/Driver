/**
 * The services tiles come alive under your finger (Ali's Yes, effects menu "alive", 2026-10-07): one
 * short moment per tile as the next screen opens. Plain maths over the moment's progress `a` (0 → 1,
 * `MOMENT_MS`), run on the UI thread by `ServicesRow`; every curve starts and ends at rest, so a moment
 * cut short or replayed never leaves an icon out of place.
 *
 *  - تكسي drives off the tile's far edge and comes back in from the near one;
 *  - تكتك hops three times, rocking, smaller each time;
 *  - بغداد والكوت: the star lines glide by one tile, like the road under the car, and the next-car chip pulls forward;
 *  - الرجعة: the arrow nudges the way it points and back;
 *  - أكل: steam rises off the dish (`steamWisp`).
 *
 * `end` is +1 when the reading direction's end is to the right (LTR), -1 in RTL.
 */

export const MOMENT_MS = 720;
/** The next screen opens this long after the tap (0 under reduced motion), so the moment reads. */
export const MOMENT_LEAD_MS = 170;

const easeIn = (t: number) => {
  'worklet';
  return t * t * t;
};
const easeOut = (t: number) => {
  'worklet';
  return 1 - (1 - t) ** 3;
};
const clamp01 = (t: number) => {
  'worklet';
  return Math.min(1, Math.max(0, t));
};

/** How far the taxi drives before it wraps round (px; past the tile's edge, which clips it). */
const DRIVE = 84;
/** The share of the moment spent leaving; the rest is coming back. */
const LEAVE = 0.38;

export function taxiX(a: number, end: number): number {
  'worklet';
  const t = clamp01(a);
  if (t === 0 || t === 1) return 0;
  return t < LEAVE
    ? end * DRIVE * easeIn(t / LEAVE)
    : -end * DRIVE * (1 - easeOut((t - LEAVE) / (1 - LEAVE)));
}

export function tuktukHop(a: number): { y: number; rotate: number } {
  'worklet';
  const t = clamp01(a);
  const fade = 1 - t;
  return {
    y: -Math.abs(Math.sin(Math.PI * 3 * t)) * 9 * fade,
    rotate: Math.sin(Math.PI * 6 * t) * 6 * fade,
  };
}

/** The trips tile's star lines: one whole tile (`tile` px) toward the start side, so the pattern lands where it began. */
export function starsX(a: number, end: number, tile: number): number {
  'worklet';
  const t = clamp01(a);
  const s = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  return -end * tile * s;
}

/** Out and back along `dir` (px), for the next-car chip and الرجعة's arrow. */
export function nudge(a: number, dir: number, distance: number): number {
  'worklet';
  return dir * distance * Math.sin(Math.PI * clamp01(a));
}

/** One curl of steam off the food tile's dish: `i` starts a little later than the one before. */
export function steamWisp(a: number, i: number): { opacity: number; y: number } {
  'worklet';
  const t = clamp01((clamp01(a) - i * 0.14) / 0.72);
  if (t === 0 || t === 1) return { opacity: 0, y: 0 };
  return { opacity: (t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7) * 0.85, y: -18 * t };
}
