import { PICKUP_SPOT_CONSOLE_ROLES, REVIEW_MODERATION_ROLES, SAFETY_DESK_ROLES, ZONE_READ_ROLES, type RoleKind } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { INBOX_READ_ROLES, ON_CALL_READ_ROLES, PHONE_BOOKING_ROLES } from '@driver/contracts';

/**
 * Console sections, grouped as the sidebar shows them. `roles`
 * mirrors the API's role gate for the page's main read (contracts routers), so a support agent
 * doesn't see pages that would only say "ما عندك صلاحية" (K-08). The API decides anyway.
 */

const READ: readonly RoleKind[] = ['dispatcher', 'support', 'finance', 'admin'];
const DISPATCH: readonly RoleKind[] = ['dispatcher', 'admin'];
const SUPPORT: readonly RoleKind[] = ['support', 'dispatcher', 'finance', 'admin'];
const APPROVALS: readonly RoleKind[] = ['admin', 'support', 'field_ops'];
const FINANCE: readonly RoleKind[] = ['finance', 'admin', 'dispatcher', 'field_ops'];
/** Mirrors `INTERCITY_OPS_ROLES` in the routes router (the router itself is server-only). */
const GARAGE: readonly RoleKind[] = ['dispatcher', 'support', 'admin'];

export type IconName =
  | 'today'
  | 'map'
  | 'dispatch'
  | 'orders'
  | 'drivers'
  | 'support'
  | 'approvals'
  | 'cash'
  | 'pricing'
  | 'controls'
  | 'wall'
  | 'zones'
  | 'stores'
  | 'reviews'
  | 'safety'
  | 'phone'
  | 'oncall'
  | 'garage'
  | 'system'
  | 'audit';

export interface NavItem {
  href: string;
  key: MessageKey;
  icon: IconName;
  roles: readonly RoleKind[];
  /** Second key of the "g …" jump shortcut. */
  jump?: string;
}

export interface NavGroup {
  /** The group's heading; null for the top group (Today and the map), which needs none. */
  key: MessageKey | null;
  /** Folded behind its heading until opened (the settings pages, opened once or twice a day). */
  folded?: boolean;
  items: readonly NavItem[];
}

/**
 * Grouped by how often a desk reaches for them (Ali 2026-10-08, "organize it better"): the live
 * picture first, then the live work, then people and shops (the emergencies desk leads), money, and
 * the settings folded away.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: null,
    items: [
      // E1 (CON-12): the home page, one row per problem with its owner.
      { href: '/', key: 'console.nav_today', icon: 'today', roles: INBOX_READ_ROLES, jump: 't' },
      { href: '/map', key: 'console.nav_map', icon: 'map', roles: READ, jump: 'm' },
    ],
  },
  {
    key: 'console.navg_live',
    items: [
      {
        href: '/dispatch',
        key: 'console.nav_dispatch',
        icon: 'dispatch',
        roles: DISPATCH,
        jump: 'd',
      },
      { href: '/orders', key: 'console.nav_orders', icon: 'orders', roles: READ, jump: 'o' },
      { href: '/drivers', key: 'console.nav_drivers', icon: 'drivers', roles: READ, jump: 'r' },
      // Taxi/tuktuk step 4: a caller without the app gets a ride booked on his number.
      { href: '/phone', key: 'console.nav_phone', icon: 'phone', roles: PHONE_BOOKING_ROLES, jump: 'b' },
      // الرجعة garage board (W3 / NTF-14, Ali 2026-10-08): today's cars from one garage, the late ones on top.
      { href: '/garage', key: 'console.nav_garage', icon: 'garage', roles: GARAGE, jump: 'j' },
    ],
  },
  {
    key: 'console.navg_people',
    items: [
      // SOS (scoring & safety §3): the emergencies desk; the red banner shows on every page anyway.
      { href: '/safety', key: 'console.safety.nav', icon: 'safety', roles: SAFETY_DESK_ROLES, jump: 'e' },
      { href: '/support', key: 'console.nav_support', icon: 'support', roles: SUPPORT, jump: 's' },
      {
        href: '/approvals',
        key: 'console.nav_approvals',
        icon: 'approvals',
        roles: APPROVALS,
        jump: 'a',
      },
      // Stores' pickup spots (Ali 2026-10-07): field ops and admins set them; not support.
      { href: '/stores', key: 'console.nav_stores', icon: 'stores', roles: PICKUP_SPOT_CONSOLE_ROLES, jump: 'k' },
      // What riders write about الرجعة drivers (x14, Ali 2026-10-07): support and admins hide a bad line.
      { href: '/reviews', key: 'console.nav_reviews', icon: 'reviews', roles: REVIEW_MODERATION_ROLES, jump: 'v' },
    ],
  },
  {
    key: 'console.navg_money',
    items: [
      { href: '/finance', key: 'console.nav_finance', icon: 'cash', roles: FINANCE, jump: 'f' },
      { href: '/pricing', key: 'console.nav_pricing', icon: 'pricing', roles: READ, jump: 'p' },
    ],
  },
  {
    key: 'console.navg_settings',
    folded: true,
    items: [
      { href: '/controls', key: 'console.nav_controls', icon: 'controls', roles: READ, jump: 'c' },
      { href: '/zones', key: 'console.nav_zones', icon: 'zones', roles: ZONE_READ_ROLES, jump: 'z' },
      // E1 (CON-02): who is reached when an alert reaches nobody; every desk reads, admins edit.
      { href: '/on-call', key: 'console.nav_on_call', icon: 'oncall', roles: ON_CALL_READ_ROLES, jump: 'n' },
      { href: '/wall', key: 'console.nav_wall', icon: 'wall', roles: READ, jump: 'w' },
      { href: '/system', key: 'console.nav_system', icon: 'system', roles: READ, jump: 'y' },
      // v10 / p2: who did what in the Console; the money chip is why finance reads it too.
      { href: '/audit', key: 'console.nav_audit', icon: 'audit', roles: ['admin', 'finance'], jump: 'l' },
    ],
  },
];

/** Flat list, sidebar order. */
export const NAV: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export type NavHref = (typeof NAV)[number]['href'];

/** Groups with only the items these roles may open; everything while roles are still loading. */
export function visibleNav(roles: ReadonlySet<RoleKind>, loaded: boolean): NavGroup[] {
  if (!loaded) return [...NAV_GROUPS];
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.some((r) => roles.has(r))),
  })).filter((g) => g.items.length > 0);
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
