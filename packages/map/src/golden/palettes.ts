import type { GoldenLight } from './sun.js';

/**
 * Golden hour (عصرية) colours, one palette per light. Warm earth and date-palm olive, an olive Tigris,
 * cream streets with caramel edges; never blue or teal (brand rule), and night is warm brown, never navy.
 * Service colours (food saffron, taxi yellow…) are not here: they belong to the routes and pins the apps
 * draw on top, so the base map stays quiet under them.
 */
export interface GoldenPalette {
  land: string;
  urban: string;
  farm: string;
  palm: string;
  palmCrown: string;
  water: string;
  waterEdge: string;
  canal: string;
  glint: string;
  glintOpacity: number;
  shadow: string;
  shadowOpacity: number;
  alley: string;
  minor: string;
  minorCase: string;
  major: string;
  majorCase: string;
  highway: string;
  highwayCase: string;
  deck: string;
  deckCase: string;
  /** Night only: the sodium-lamp glow under main streets. */
  lampGlow: string | null;
  roof: string;
  wall: string;
  mosque: string;
  tankWhite: string;
  tankBlack: string;
  label: string;
  labelHalo: string;
  /** Town and village names. */
  area: string;
  river: string;
  riverHalo: string;
  light: { color: string; intensity: number };
  sky: { sky: string; horizon: string; fog: string };
}

const DAY: GoldenPalette = {
  land: '#F3E2C2', urban: '#EBD3A8', farm: '#EDE3B9', palm: '#E2DDA8', palmCrown: '#B4B071',
  water: '#7E7F4E', waterEdge: '#666839', canal: '#9AA06A', glint: '#C9C690', glintOpacity: 0.55,
  shadow: '#8A5A2A', shadowOpacity: 0.17,
  alley: '#FBF1DE', minor: '#FFFBF1', minorCase: '#D9B27A', major: '#FFF6E4', majorCase: '#C9944C',
  highway: '#F8DA9E', highwayCase: '#B67A31', deck: '#FFF8EA', deckCase: '#6B3D1A', lampGlow: null,
  roof: '#FBEBCF', wall: '#C9A877', mosque: '#F4E3C2', tankWhite: '#FFF9EE', tankBlack: '#EFE3CE',
  label: '#4A321D', labelHalo: '#FBF1DE', area: '#8D6A45', river: '#F4EED2', riverHalo: '#5E6533',
  light: { color: '#FFFFFF', intensity: 0.2 },
  sky: { sky: '#F6D9A6', horizon: '#FBEBD0', fog: '#F6E7CB' },
};

const GOLDEN: GoldenPalette = {
  ...DAY,
  land: '#F1D9B2', urban: '#E9CFA3', farm: '#EADBA9', palm: '#DDD49A', palmCrown: '#ADA562',
  water: '#7A7A48', waterEdge: '#626234', glint: '#EBC883', glintOpacity: 0.8,
  shadow: '#A87F55', shadowOpacity: 0.35,
  alley: '#F9EBD3', minor: '#FFF8EA', minorCase: '#D2A66C', major: '#FFF2D8', majorCase: '#C28640',
  highway: '#F6CF86', highwayCase: '#AE6E25', deck: '#FFF5E2', deckCase: '#633416',
  roof: '#F9D9A0', wall: '#D9A766', mosque: '#F2DCB5',
  label: '#462D17', labelHalo: '#F8EAD2', area: '#87633D', river: '#F4EBCB',
  light: { color: '#FFF1D6', intensity: 0.24 },
  sky: { sky: '#F1C47E', horizon: '#F9DFB4', fog: '#F4DFBC' },
};

/** The five palettes. `golden` is the look Ali picked; `day` is the same town under a high sun. */
export const GOLDEN_PALETTES: Record<GoldenLight, GoldenPalette> = {
  day: DAY,
  morning: {
    ...DAY,
    land: '#F1E3C8', urban: '#EDDDBF', wall: '#D2B88E', shadow: '#8E8672', shadowOpacity: 0.26,
    light: { color: '#FFF8EA', intensity: 0.2 },
    sky: { sky: '#EFE2C6', horizon: '#F7EEDB', fog: '#F1E3C8' },
  },
  golden: GOLDEN,
  sunset: {
    ...GOLDEN,
    land: '#F0D2AE', urban: '#ECC9A2', roof: '#DDB898', wall: '#B48E70', shadow: '#7E5A44', shadowOpacity: 0.34,
    glint: '#F2B870', glintOpacity: 0.9,
    light: { color: '#FFD9B8', intensity: 0.28 },
    sky: { sky: '#E8A066', horizon: '#F6CF9C', fog: '#F0D2AE' },
  },
  night: {
    land: '#1D1712', urban: '#201913', farm: '#252012', palm: '#2A2A19', palmCrown: '#4E4F2F',
    water: '#2F3320', waterEdge: '#4A5034', canal: '#2F3320', glint: '#6E5A30', glintOpacity: 0.5,
    shadow: '#000000', shadowOpacity: 0,
    alley: '#30271F', minor: '#3B3026', minorCase: '#1D1712', major: '#5A4A3B', majorCase: '#1D1712',
    highway: '#665443', highwayCase: '#1D1712', deck: '#B48A57', deckCase: '#22180F', lampGlow: '#E8A34A',
    roof: '#2A2018', wall: '#231A13', mosque: '#58422B', tankWhite: '#7A6852', tankBlack: '#6B5A48',
    label: '#F2E0C3', labelHalo: '#22180F', area: '#BFA27C', river: '#C9CC9C', riverHalo: '#1E2114',
    light: { color: '#FFE0B0', intensity: 0.12 },
    sky: { sky: '#1A120B', horizon: '#3A2614', fog: '#22180F' },
  },
};
