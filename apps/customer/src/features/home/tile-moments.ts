/**
 * The services tiles come alive under your finger (Ali's Yes, effects menu "alive", 2026-10-07): one
 * short moment per tile as the next screen opens. Plain maths over the moment's progress `a` (0 → 1,
 * `MOMENT_MS`), run on the UI thread by `ServicesRow`; every curve starts and ends at rest, so a moment
 * cut short or replayed never leaves a picture out of place.
 *
 *  - تكسي, بغداد والكوت and الرجعة: the car pulls forward the way it faces and settles back (`nudge`);
 *  - تكتك hops three times, rocking, smaller each time;
 *  - أكل: steam rises off the wrap (`steamWisp`).
 *
 * A `dir` of +1 moves to the right of the screen, -1 to the left.
 */

export const MOMENT_MS = 720;
/** The next screen opens this long after the tap (0 under reduced motion), so the moment reads. */
export const MOMENT_LEAD_MS = 170;

const clamp01 = (t: number) => {
  'worklet';
  return Math.min(1, Math.max(0, t));
};

export function tuktukHop(a: number): { y: number; rotate: number } {
  'worklet';
  const t = clamp01(a);
  const fade = 1 - t;
  return {
    y: -Math.abs(Math.sin(Math.PI * 3 * t)) * 9 * fade,
    rotate: Math.sin(Math.PI * 6 * t) * 6 * fade,
  };
}

/** Out and back along `dir` (px): a car pulling forward and settling. */
export function nudge(a: number, dir: number, distance: number): number {
  'worklet';
  return dir * distance * Math.sin(Math.PI * clamp01(a));
}

/** One curl of steam off the food tile's wrap: `i` starts a little later than the one before. */
export function steamWisp(a: number, i: number): { opacity: number; y: number } {
  'worklet';
  const t = clamp01((clamp01(a) - i * 0.14) / 0.72);
  if (t === 0 || t === 1) return { opacity: 0, y: 0 };
  return { opacity: (t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7) * 0.85, y: -18 * t };
}
