import type { StopState } from '@driver/contracts';

/**
 * Stop machine (domain §2): `pending → arrived → completed | skipped`, and `pending → skipped`.
 * Pure helpers; the service persists the result.
 */
export const STOP_TRANSITIONS: Readonly<Record<StopState, readonly StopState[]>> = {
  pending: ['arrived', 'skipped'],
  arrived: ['completed', 'skipped'],
  completed: [],
  skipped: [],
};

export function canStopTransition(from: StopState, to: StopState): boolean {
  return STOP_TRANSITIONS[from].includes(to);
}

export function isStopFinished(state: StopState): boolean {
  return state === 'completed' || state === 'skipped';
}

export interface ChildHandoverCheck {
  /** Only khat (خطوط) stops carry a named child. */
  vertical: string;
  childName: string | null;
  type: 'pickup' | 'dropoff' | 'wait' | 'shop';
  childTap?: 'in' | 'out' | undefined;
}

/**
 * Edge-case §5: per-child tap-in at pickup and tap-out at dropoff, by name. A khat stop with a
 * named child cannot complete without the matching tap. Returns the tap to record, or an error key.
 */
export function childHandover(check: ChildHandoverCheck): { ok: true; tap: 'in' | 'out' | null } | { ok: false } {
  if (check.vertical !== 'khat' || !check.childName) return { ok: true, tap: null };
  const required = check.type === 'pickup' ? 'in' : check.type === 'dropoff' ? 'out' : null;
  if (required === null) return { ok: true, tap: null };
  return check.childTap === required ? { ok: true, tap: required } : { ok: false };
}
