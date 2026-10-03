import type { MessageKey } from '@driver/i18n';

/** Console sections in sidebar order (console spec; plan Step 8 acceptance). */
export const NAV = [
  { href: '/map', key: 'console.nav_map' },
  { href: '/dispatch', key: 'console.nav_dispatch' },
  { href: '/orders', key: 'console.nav_orders' },
  { href: '/drivers', key: 'console.nav_drivers' },
  { href: '/pricing', key: 'console.nav_pricing' },
  { href: '/system', key: 'console.nav_system' },
] as const satisfies readonly { href: string; key: MessageKey }[];

export type NavHref = (typeof NAV)[number]['href'];
