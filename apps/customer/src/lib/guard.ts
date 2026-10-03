import type { SessionStatus } from './session';

/**
 * Route guard (pure, so it is unit-tested): given the session, onboarding state and the current
 * expo-router segments, where should the app be? `null` means "stay".
 *
 *  - signed out, outside (auth)            → /welcome
 *  - signed in, profile setup still due     → /setup (name + first place; skippable)
 *  - signed in, in (auth) otherwise         → / (home tab)
 *
 * Public routes are listed in `PUBLIC_SEGMENTS`: the share-trip page (`/share/<token>`) opens
 * without an account.
 */

export type GuardTarget = '/welcome' | '/setup' | '/';

export interface GuardInput {
  status: SessionStatus;
  /** True while the person has finished OTP but not yet the name/place step (or skipped it). */
  setupPending: boolean;
  segments: readonly string[];
}

export const AUTH_GROUP = '(auth)';
export const SETUP_SCREEN = 'setup';
/** Top-level segments reachable while signed out (besides the auth group). */
export const PUBLIC_SEGMENTS: ReadonlySet<string> = new Set<string>(['share']);

export function resolveGuard({ status, setupPending, segments }: GuardInput): GuardTarget | null {
  if (status === 'loading') return null;
  const first = segments[0];
  const inAuth = first === AUTH_GROUP;
  const onSetup = inAuth && segments[1] === SETUP_SCREEN;
  // A shared trip link opens for anyone, signed in or not, mid-setup or not.
  if (first && PUBLIC_SEGMENTS.has(first)) return null;

  if (status === 'signedOut') {
    if (inAuth && !onSetup) return null;
    if (first && PUBLIC_SEGMENTS.has(first)) return null;
    return '/welcome';
  }

  // signed in
  if (setupPending) return onSetup ? null : '/setup';
  if (inAuth) return '/';
  return null;
}
