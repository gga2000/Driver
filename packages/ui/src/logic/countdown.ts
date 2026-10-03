/**
 * Timing for the two ring uses:
 * - accept ring: a partner offer (15/20 s) or merchant accept (90 s) depleting to zero;
 * - late meter: intercity grace, then {amount} per 10 minutes, the car leaves at 20 minutes.
 */

export interface RingState {
  remainingMs: number;
  /** 0 → just started, 1 → expired. */
  elapsedFraction: number;
  expired: boolean;
  /** Last stretch: the ring turns danger and the haptic ticks. */
  urgent: boolean;
}

export function acceptRing(nowMs: number, startedAtMs: number, durationMs: number, urgentMs = 5000): RingState {
  const elapsed = Math.min(Math.max(0, nowMs - startedAtMs), durationMs);
  const remainingMs = durationMs - elapsed;
  return {
    remainingMs,
    elapsedFraction: durationMs > 0 ? elapsed / durationMs : 1,
    expired: remainingMs <= 0,
    urgent: remainingMs > 0 && remainingMs <= urgentMs,
  };
}

export interface LateMeterConfig {
  /** Free waiting before the meter starts (intercity: 3 min cash, 5 min prepaid). */
  graceMs: number;
  /** Meter step (10 min). */
  stepMs: number;
  /** IQD charged per started step. */
  stepAmount: number;
  /** After this much lateness (counted from the end of grace) the seat is forfeited (20 min). */
  forfeitMs: number;
}

export interface LateMeterState {
  phase: 'grace' | 'metering' | 'forfeited';
  /** Remaining grace in grace phase; remaining until forfeit while metering; 0 when forfeited. */
  remainingMs: number;
  /** Steps started so far (a started step is charged in full). */
  steps: number;
  amount: number;
  /** Fill of the ring for the current phase, 0..1. */
  fraction: number;
}

export function lateMeter(elapsedMs: number, cfg: LateMeterConfig): LateMeterState {
  const t = Math.max(0, elapsedMs);
  if (t < cfg.graceMs) {
    return { phase: 'grace', remainingMs: cfg.graceMs - t, steps: 0, amount: 0, fraction: t / cfg.graceMs };
  }
  const late = t - cfg.graceMs;
  const steps = Math.min(Math.floor(late / cfg.stepMs) + 1, Math.ceil(cfg.forfeitMs / cfg.stepMs));
  if (late >= cfg.forfeitMs) {
    return { phase: 'forfeited', remainingMs: 0, steps, amount: steps * cfg.stepAmount, fraction: 1 };
  }
  return {
    phase: 'metering',
    remainingMs: cfg.forfeitMs - late,
    steps,
    amount: steps * cfg.stepAmount,
    fraction: late / cfg.forfeitMs,
  };
}
