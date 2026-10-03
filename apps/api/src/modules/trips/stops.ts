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
  /** Only khat (خطوط) stops carry a child. */
  vertical: string;
  /** Opaque ref into the identity vault; the name is never on the stop (M2 review follow-up). */
  childRef: string | null;
  type: 'pickup' | 'dropoff' | 'wait' | 'shop';
  childTap?: 'in' | 'out' | undefined;
}

/**
 * Edge-case §5: per-child tap-in at pickup and tap-out at dropoff (the driver sees the name on his run
 * sheet, read from the vault). A khat stop with a child cannot complete without the matching tap.
 * Returns the tap to record, or an error key.
 */
export function childHandover(check: ChildHandoverCheck): { ok: true; tap: 'in' | 'out' | null } | { ok: false } {
  if (check.vertical !== 'khat' || !check.childRef) return { ok: true, tap: null };
  const required = check.type === 'pickup' ? 'in' : check.type === 'dropoff' ? 'out' : null;
  if (required === null) return { ok: true, tap: null };
  return check.childTap === required ? { ok: true, tap: required } : { ok: false };
}
