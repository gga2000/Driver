/**
 * Slide-to-confirm maths, free of Reanimated so it can be unit-tested; the gesture handler calls
 * these as worklets. "Forward" is the reading direction: right → left in Arabic (the thumb starts
 * on the right, the start side) and left → right in LTR.
 */

/** Released past this share of the track: confirmed. */
export const SLIDE_CONFIRM_AT = 0.85;
/** A forward flick (px/s) from at least half way also confirms, as on Uber's slider. */
export const SLIDE_FLING_VELOCITY = 900;
/** Share of the track from which a flick may confirm. */
export const SLIDE_FLING_FROM = 0.5;
/** Haptic ticks while dragging (selection), then the confirm haptic at 100 %. */
export const SLIDE_TICKS: readonly number[] = [0.25, 0.5, 0.75];
/** Reduced-motion fallback: press and hold this long (P-08: 0.9 s). */
export const SLIDE_HOLD_MS = 900;
/** Track and thumb sizes (P-08: 72 px track, thumb ≥ 58 px). */
export const SLIDE_TRACK_HEIGHT = 72;
export const SLIDE_THUMB_SIZE = 60;
export const SLIDE_INSET = 6;

/** How far the thumb can travel inside a track of `trackWidth`. */
export function slideTravel(trackWidth: number, thumb: number = SLIDE_THUMB_SIZE, inset: number = SLIDE_INSET): number {
  'worklet';
  return Math.max(0, trackWidth - thumb - inset * 2);
}

/** Drag translation (screen px, + is rightward) → progress 0..1 in the reading direction. */
export function slideProgress(translationX: number, travel: number, rtl: boolean): number {
  'worklet';
  if (travel <= 0) return 0;
  const forward = rtl ? -translationX : translationX;
  return Math.min(1, Math.max(0, forward / travel));
}

/** Progress → the thumb's `translateX` (screen px; negative in RTL, where it travels left). */
export function slideOffset(progress: number, travel: number, rtl: boolean): number {
  'worklet';
  const p = Math.min(1, Math.max(0, progress));
  return (rtl ? -1 : 1) * p * travel;
}

/** What a release does: confirm (far enough, or a forward flick from half way) or spring back. */
export function slideRelease(progress: number, velocityX: number, rtl: boolean): 'confirm' | 'reset' {
  'worklet';
  if (progress >= SLIDE_CONFIRM_AT) return 'confirm';
  const forwardVelocity = rtl ? -velocityX : velocityX;
  if (progress >= SLIDE_FLING_FROM && forwardVelocity >= SLIDE_FLING_VELOCITY) return 'confirm';
  return 'reset';
}

/** The tick crossed moving forward from `prev` to `next` (one per frame at most), or -1. */
export function slideTickCrossed(prev: number, next: number, ticks: readonly number[] = SLIDE_TICKS): number {
  'worklet';
  if (next <= prev) return -1;
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i]!;
    if (prev < t && next >= t) return i;
  }
  return -1;
}

/** Label fades out as the thumb covers it (fully gone at 60 %). */
export function slideLabelOpacity(progress: number): number {
  'worklet';
  return Math.max(0, 1 - progress / 0.6);
}

/** Which interaction a slider uses: the drag, or the press-and-hold fallback. */
export function slideMode(mode: 'auto' | 'slide' | 'hold', reduceMotion: boolean): 'slide' | 'hold' {
  if (mode === 'auto') return reduceMotion ? 'hold' : 'slide';
  return mode;
}
