import type { SessionStatus } from './session';

/**
 * Route guard (pure, unit-tested). Given the session, whether this person works at a store, and the
 * current expo-router segments, where should the app be? `null` means "stay".
 *
 *  - signed out, outside (auth)                     → /welcome
 *  - signed in, stores still loading                → stay (the splash covers the screen)
 *  - signed in, no merchant role on any store       → /not-activated (friendly, with a call button)
 *  - signed in, several stores and none picked yet  → /stores
 *  - signed in and ready, on an auth/gate screen    → / (the orders board)
 */

export type StoreAccess = 'loading' | 'none' | 'pick' | 'ready';
export type GuardTarget = '/welcome' | '/not-activated' | '/stores' | '/';

export interface GuardInput {
  status: SessionStatus;
  access: StoreAccess;
  segments: readonly string[];
}

export const AUTH_GROUP = '(auth)';
export const GATE_SCREEN = 'not-activated';
export const STORES_SCREEN = 'stores';

export function resolveGuard({ status, access, segments }: GuardInput): GuardTarget | null {
  if (status === 'loading') return null;
  const first = segments[0];
  const inAuth = first === AUTH_GROUP;

  if (status === 'signedOut') return inAuth ? null : '/welcome';

  if (access === 'loading') return null;
  if (access === 'none') return first === GATE_SCREEN ? null : '/not-activated';
  if (access === 'pick') return first === STORES_SCREEN ? null : '/stores';
  if (inAuth || first === GATE_SCREEN) return '/';
  return null;
}

/**
 * Which store the device works for: the remembered one if the person still works there, the only
 * one if there is exactly one, otherwise none (the picker asks).
 */
export function pickStore<T extends { orgId: string }>(stores: readonly T[] | undefined, remembered: string | null): { access: StoreAccess; store: T | null } {
  if (!stores) return { access: 'loading', store: null };
  if (stores.length === 0) return { access: 'none', store: null };
  const kept = remembered ? stores.find((s) => s.orgId === remembered) : undefined;
  if (kept) return { access: 'ready', store: kept };
  if (stores.length === 1) return { access: 'ready', store: stores[0]! };
  return { access: 'pick', store: null };
}

/** Navigation sections; every route belongs to one (the rail/tab highlights it). */
export type Section = 'orders' | 'menu' | 'money' | 'insights' | 'more';

const SECTION_OF: Record<string, Section> = {
  index: 'orders',
  menu: 'menu',
  money: 'money',
  insights: 'insights',
  more: 'more',
  deals: 'more',
  staff: 'more',
  printer: 'more',
  hours: 'more',
  'pickup-spot': 'more',
  'delivery-area': 'more',
  'menu-photos': 'more',
  pot: 'menu',
  story: 'more',
  settings: 'more',
  chat: 'orders',
};

export function sectionOf(segments: readonly string[]): Section | null {
  const first = segments[0] ?? 'index';
  if (first === AUTH_GROUP || first === GATE_SCREEN || first === STORES_SCREEN || first === '+not-found') return null;
  return SECTION_OF[first] ?? null;
}

/** Section roots show the phone's bottom bar; deeper screens (printer, a menu item…) have a back button instead. */
export function isSectionRoot(segments: readonly string[]): boolean {
  const first = segments[0] ?? 'index';
  if (segments.length > 1 && segments[1] !== 'index') return false;
  return first === 'index' || first === 'menu' || first === 'money' || first === 'insights' || first === 'more';
}
