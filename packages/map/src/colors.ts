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
