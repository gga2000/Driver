/**
 * The SOS hold (scoring & safety §3): 3 seconds of holding sends the alert; letting go earlier sends
 * nothing. Pure, so the timing is tested without a renderer.
 */

/** How long the button must be held. */
export const SOS_HOLD_MS = 3_000;
/** "كنسل — تنبيه بالغلط" stays this long after the alert is received. */
export const SOS_CANCEL_MS = 10_000;

export interface SosHoldState {
  /** 0..1 of the ring. With reduced motion it moves in whole-second steps (no continuous sweep). */
  fraction: number;
  /** Whole seconds left to hold ("ظل ضاغط… 2"). */
  secondsLeft: number;
  done: boolean;
}

export function sosHold(elapsedMs: number, holdMs = SOS_HOLD_MS, reduceMotion = false): SosHoldState {
  const e = Math.max(0, Math.min(elapsedMs, holdMs));
  const done = elapsedMs >= holdMs;
  const steps = Math.max(1, Math.round(holdMs / 1000));
  const fraction = done ? 1 : reduceMotion ? Math.floor((e / holdMs) * steps) / steps : e / holdMs;
  return { fraction, secondsLeft: done ? 0 : Math.ceil((holdMs - e) / 1000), done };
}

/**
 * The whole seconds crossed between two moments of one hold (1000, 2000…, not the end): one haptic
 * each, so the thumb feels the count without looking.
 */
export function sosSecondsCrossed(prevMs: number, nowMs: number, holdMs = SOS_HOLD_MS): number[] {
  const out: number[] = [];
  for (let s = Math.floor(prevMs / 1000) + 1; s * 1000 <= Math.min(nowMs, holdMs - 1); s++) out.push(s * 1000);
  return out;
}

/** Whole seconds left of the cancel window (0 once it closed). */
export function sosCancelLeft(cancelUntil: number, now: number): number {
  return Math.max(0, Math.ceil((cancelUntil - now) / 1000));
}

/**
 * A press-and-hold timer independent of any UI: `start` on press-in, `tick` from a timer, `release`
 * on press-out. Calls `onSecond` at each whole second and `onDone` once when the hold completes;
 * a release before that cancels it (`onCancel`).
 */
export class SosHoldTimer {
  private startedAt: number | null = null;
  private last = 0;
  private finished = false;

  constructor(
    private readonly handlers: { onSecond?: (ms: number) => void; onDone: () => void; onCancel?: (elapsedMs: number) => void },
    private readonly holdMs = SOS_HOLD_MS,
  ) {}

  get holding(): boolean {
    return this.startedAt !== null && !this.finished;
  }

  start(now: number): void {
    this.startedAt = now;
    this.last = 0;
    this.finished = false;
  }

  /** Elapsed ms of the current hold (0 when not holding). */
  tick(now: number): number {
    if (this.startedAt === null || this.finished) return 0;
    const elapsed = now - this.startedAt;
    for (const ms of sosSecondsCrossed(this.last, elapsed, this.holdMs)) this.handlers.onSecond?.(ms);
    this.last = elapsed;
    if (elapsed >= this.holdMs) {
      this.finished = true;
      this.startedAt = null;
      this.handlers.onDone();
    }
    return elapsed;
  }

  release(now: number): void {
    if (this.startedAt === null || this.finished) return;
    const elapsed = this.tick(now);
    if (this.finished) return;
    this.startedAt = null;
    this.handlers.onCancel?.(elapsed);
  }
}
