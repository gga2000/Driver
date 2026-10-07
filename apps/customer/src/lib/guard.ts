import type { SessionStatus } from './session';

/**
 * Route guard (pure, so it is unit-tested): given the session, onboarding state and the current
 * expo-router segments, where should the app be? `null` means "stay".
 *
 * Guest browsing (Ali, 2026-10-04, audit C-18): home, the food doors, search, the shop list, menus and the cart
 * open without an account; the phone number is asked at "كمّل الطلب" / "احجز".
 *
 *  - signed out, first launch, on home           → /welcome (once; "يلا نبدي" goes on as a guest)
 *  - signed out, a guest screen                  → stay
 *  - signed out, anything else (checkout, rides, الرجعة, places…) → /phone, remembering the path
 *  - signed in, profile setup still due          → /setup (name + first place; skippable)
 *  - signed in, in (auth) otherwise              → where the guest was going (`returnTo`), else /
 *  - signed in, waiting for their area's turn (customer waves, W5), at checkout → /waitlist
 *
 * Public routes (`PUBLIC_SEGMENTS`, the share-trip page) open for anyone, at any step.
 */

export interface GuardTarget {
  /** Where to go (`router.replace`). */
  to: string;
  /** A protected path a guest tried to open: kept as `returnTo` for after sign-in. */
  remember?: string;
}

export interface GuardInput {
  status: SessionStatus;
  /** True while the person has finished OTP but not yet the name/place step (or skipped it). */
  setupPending: boolean;
  segments: readonly string[];
  /** The concrete path (`/restaurant/abc`), remembered when a guest is stopped. */
  pathname?: string;
  /** The welcome screen was seen on this device. */
  welcomed?: boolean;
  /** Where to return after sign-in (from `requireSignIn` or a stopped deep link). */
  returnTo?: string | null;
  /** Customer waves (W5): signed in but their area's turn hasn't come (or no place to wait for yet). */
  waitlisted?: boolean;
}

export const AUTH_GROUP = '(auth)';
export const TABS_GROUP = '(tabs)';
export const SETUP_SCREEN = 'setup';
/** Where a waiting customer is sent from checkout (menus and the cart stay open to browse). */
export const WAITLIST_PATH = '/waitlist';
const ORDER_SEGMENTS: ReadonlySet<string> = new Set<string>(['checkout']);
/** Top-level segments reachable by anyone, signed in or not, mid-setup or not (share-trip, the SOS contact page). */
export const PUBLIC_SEGMENTS: ReadonlySet<string> = new Set<string>(['share', 'sos']);
/**
 * Top-level segments a guest may browse. The tabs are open too: orders, wallet and account show a
 * "دخّل رقمك" card in place of their content (`GuestGate`).
 */
export const GUEST_SEGMENTS: ReadonlySet<string> = new Set<string>([TABS_GROUP, 'food', 'search', 'restaurants', 'restaurant', 'cart', 'i', 'stickers']);

export function resolveGuard({ status, setupPending, segments, pathname, welcomed = true, returnTo = null, waitlisted = false }: GuardInput): GuardTarget | null {
  if (status === 'loading') return null;
  const first = segments[0];
  const inAuth = first === AUTH_GROUP;
  const onSetup = inAuth && segments[1] === SETUP_SCREEN;
  // A shared trip link opens for anyone, signed in or not, mid-setup or not.
  if (first && PUBLIC_SEGMENTS.has(first)) return null;

  if (status === 'signedOut') {
    if (inAuth && !onSetup) return null;
    if (onSetup) return { to: '/welcome' };
    const atHome = !first || first === TABS_GROUP;
    if (!welcomed && atHome) return { to: '/welcome' };
    if (!first || GUEST_SEGMENTS.has(first)) return null;
    return { to: '/phone', ...(pathname && pathname !== '/' ? { remember: pathname } : {}) };
  }

  // signed in
  if (setupPending) return onSetup ? null : { to: '/setup' };
  if (inAuth) {
    const back = returnTo ?? '/';
    return { to: waitlisted && ORDER_SEGMENTS.has(back.split(/[/?]/)[1] ?? '') ? WAITLIST_PATH : back };
  }
  if (waitlisted && first && ORDER_SEGMENTS.has(first)) return { to: WAITLIST_PATH };
  return null;
}

/**
 * The return path is spent once a signed-in person has left the auth screens (they landed on it).
 * Cleared then, not when navigating, so the guard never sees "in auth, no return" mid-replace and
 * sends them home instead.
 */
export function returnSpent({ status, setupPending, segments, returnTo }: Pick<GuardInput, 'status' | 'setupPending' | 'segments' | 'returnTo'>): boolean {
  return status === 'signedIn' && !setupPending && Boolean(returnTo) && segments[0] !== AUTH_GROUP;
}

/** Which reason the phone screen gives a guest, from where they were going. */
export function signInReason(returnTo: string | null | undefined): 'order' | 'book' | null {
  if (!returnTo) return null;
  if (returnTo.startsWith('/checkout') || returnTo.startsWith('/cart')) return 'order';
  if (returnTo.startsWith('/rajaa') || returnTo.startsWith('/ride')) return 'book';
  return null;
}
