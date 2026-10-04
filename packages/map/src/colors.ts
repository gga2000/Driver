import type { ZoneTier } from '@driver/contracts';

/**
 * Map palette. Dark warm-grey base (design-tokens `color.neutral`), placeholder brand amber as the
 * accent. Kept beside the style so a brand swap is one file, like the Console's globals.css.
 */
export const MAP_COLORS = {
  background: '#1a1917',
  water: '#22303a',
  land: '#23211e',
  road: '#4a463f',
  label: '#f8f7f4',
  labelHalo: '#1a1917',
  accent: '#f2a33a',
  accentStrong: '#ffb81f',
  line: '#5e5a52',
  muted: '#a39e94',
} as const;

/**
 * Light map for the customer app (cream base like the app's `bg`, white roads, brand orange accent).
 * Same keys as `MAP_COLORS` so a renderer can switch palettes by theme.
 */
export const MAP_COLORS_LIGHT: Readonly<Record<keyof typeof MAP_COLORS, string>> = {
  background: '#efe7da',
  water: '#c9dce6',
  land: '#f4ede2',
  road: '#ffffff',
  label: '#4a4038',
  labelHalo: '#fbf6ee',
  accent: '#e08a1e',
  accentStrong: '#c77700',
  line: '#d8ccbb',
  muted: '#8a7f73',
};

/**
 * Tier shading, centre → edge: amber at the centre cooling outwards so the pricing bands read at a
 * glance (centre/near 500, mid 1,000, far 1,500, edge 2,000).
 */
export const TIER_COLORS: Readonly<Record<ZoneTier, string>> = {
  centre: '#f2a33a',
  near: '#d9c25b',
  mid: '#6fb58a',
  far: '#4e9bc4',
  edge: '#8c7ad1',
};

export const TIERS_IN_ORDER: readonly ZoneTier[] = ['centre', 'near', 'mid', 'far', 'edge'];

/** Driver / trip marker states on the live map (console spec: free, offered, on job, over cap, offline). */
export const MARKER_STATES = ['free', 'offered', 'on_job', 'over_cap', 'offline'] as const;
export type MarkerState = (typeof MARKER_STATES)[number];

export const MARKER_COLORS: Readonly<Record<MarkerState, string>> = {
  free: '#1f9d55',
  offered: '#f2a33a',
  on_job: '#4e9bc4',
  over_cap: '#d03b3b',
  offline: '#7c776e',
};

/**
 * Sequential tier bands for the Console (UI/UX audit K-09). The tiers are ordinal distance and price
 * bands (centre 500 … edge 2,000 دينار), so they read as one hue, light → dark, not five categorical
 * hues. An ink wash on paper (sepia, from the design-tokens neutral scale) keeps the bands quiet, so
 * the driver and order markers stay the loudest things on the map. The light ramp darkens outwards
 * on the cream base; the dark ramp lightens outwards on the near-black base. `gap` is the hairline
 * between neighbouring bands (the paper showing through).
 */
export const TIER_RAMP: Readonly<Record<'light' | 'dark', Readonly<Record<ZoneTier, string>> & { gap: string }>> = {
  light: {
    centre: '#f7efe2',
    near: '#efe2cc',
    mid: '#e5d2b4',
    far: '#d9c19c',
    edge: '#ccae85',
    gap: '#fbf6ee',
  },
  dark: {
    centre: '#2b241d',
    near: '#342b22',
    mid: '#3f3429',
    far: '#4c3f31',
    edge: '#5b4b3a',
    gap: '#16120e',
  },
};
