import { Platform } from 'react-native';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';

/** The Golden hour map is set up for this build (web only until the phones get the native map). */
export const GOLDEN_MAP = Platform.OS === 'web' && !!MAP_TILES_URL && !!MAP_GLYPHS_URL;

/** The credit every map surface shows (maps program f12); our own tiles add Overture's buildings and places. */
// Isolated left-to-right so «©» stays in front inside the right-to-left screen.
export const MAP_CREDIT = `\u2066${GOLDEN_MAP ? '© OpenStreetMap · Overture Maps' : '© OpenStreetMap'}\u2069`;
