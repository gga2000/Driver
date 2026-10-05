/**
 * Toast timing and queue (audit S-21), pure so it is tested without rendering:
 * - a plain toast stays 4 s, one with an action 8 s (an "undo" needs time: WCAG 2.2.1),
 *   twice as long while a screen reader is on;
 * - a new toast waits its turn behind the one on screen; at most 2 wait, the oldest waiting one
 *   is dropped first;
 * - a plain toast on screen steps aside early for a new one; a toast with an action never does.
 */
import { motion } from '@driver/design-tokens';

export interface ToastTimingInput {
  action?: unknown;
}

export function toastDuration(toast: ToastTimingInput, opts: { screenReader?: boolean; override?: number } = {}): number {
  const base = opts.override ?? (toast.action ? motion.toast.actionMs : motion.toast.plainMs);
  return opts.screenReader ? base * motion.toast.screenReaderFactor : base;
}

/** The waiting line after `next` arrives: newest last, never more than `max`. */
export function enqueueToast<T>(waiting: readonly T[], next: T, max: number = motion.toast.queue): T[] {
  const line = [...waiting, next];
  return line.length > max ? line.slice(line.length - max) : line;
}

/** Whether the toast on screen should leave now because another is waiting. */
export function yieldsToNext(current: ToastTimingInput | null): boolean {
  return !!current && !current.action;
}

/** Remaining time after a pause that started `elapsedMs` into a `remainingMs` run. */
export function remainingAfterPause(remainingMs: number, elapsedMs: number): number {
  return Math.max(0, remainingMs - Math.max(0, elapsedMs));
}
