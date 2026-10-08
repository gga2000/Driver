import { color } from '@driver/design-tokens';
import { MAP_COLORS_LIGHT } from '@driver/map';
import { useTheme } from '@driver/ui';

/**
 * The driver app's map in its night look (n2): the same warm dark paper as the ember palette, roads a
 * shade lighter, names in cream on a dark halo. No blue water: the river is a dark olive like the
 * design page's night map. Kept in the partner app so `packages/map` stays as it is.
 */
export const MAP_COLORS_NIGHT: typeof MAP_COLORS_LIGHT = {
  background: '#1B120B',
  water: '#22261A',
  land: '#21150C',
  road: '#3A2A1C',
  label: '#E9D6BC',
  labelHalo: '#1B120B',
  accent: '#FFA63D',
  accentStrong: '#FFB65C',
  line: '#4A3624',
  muted: '#C4AD90',
  danger: '#FF8A80',
};

/** Landmark badges and names: cream badges by day; at night darker badges so they don't glow. */
export interface LandmarkColors {
  badgeFill: string;
  badgeRing: string;
  glyph: string;
  name: string;
  halo: string;
}

const LANDMARK_DAY: LandmarkColors = { badgeFill: color.neutral[50], badgeRing: color.neutral[400], glyph: color.neutral[700], name: color.neutral[700], halo: color.neutral[50] };
const LANDMARK_NIGHT: LandmarkColors = { badgeFill: '#2B1C11', badgeRing: '#5A4430', glyph: '#E9D6BC', name: '#E9D6BC', halo: '#1B120B' };

export function useMapColors(): { map: typeof MAP_COLORS_LIGHT; landmark: LandmarkColors; night: boolean } {
  const night = useTheme().scheme === 'dark';
  return night ? { map: MAP_COLORS_NIGHT, landmark: LANDMARK_NIGHT, night } : { map: MAP_COLORS_LIGHT, landmark: LANDMARK_DAY, night };
}
