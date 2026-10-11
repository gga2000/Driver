import type { SessionStatus } from './session';

/**
 * Route guard (pure, unit-tested): given the session, the role gate and the expo-router segments,
 * where should the Partner app be? `null` means "stay".
 *
 *  - signed out, outside (auth)                      → /welcome
 *  - signed in, roles still loading                  → stay (the splash covers the screen)
 *  - signed in, no driving/fleet/ops role            → /not-partner ("حسابك مو مفعّل كشريك بعد")
 *  - signed in as a partner, in (auth) or the gate   → / (home tab)
 *  - signed in, on the staff-alert screen            → stay, whatever the roles (staff open SOS
 *    pushes there; a dispatcher may have no partner role)
 */

export type GuardTarget = '/welcome' | '/not-partner' | '/';

/** `unknown` while `identity.me` loads; `denied` for customers-only accounts. */
export type PartnerGate = 'unknown' | 'allowed' | 'denied';

export interface GuardInput {
  status: SessionStatus;
  gate: PartnerGate;
  segments: readonly string[];
}

export const AUTH_GROUP = '(auth)';
export const GATE_SCREEN = 'not-partner';
export const STAFF_ALERT_SCREEN = 'staff-alert';

export function resolveGuard({ status, gate, segments }: GuardInput): GuardTarget | null {
  if (status === 'loading') return null;
  const first = segments[0];
  const inAuth = first === AUTH_GROUP;
  const onGate = first === GATE_SCREEN;

  if (status === 'signedOut') return inAuth ? null : '/welcome';
  if (first === STAFF_ALERT_SCREEN) return null;

  if (gate === 'unknown') return null;
  if (gate === 'denied') return onGate ? null : '/not-partner';
  if (inAuth || onGate) return '/';
  return null;
}
