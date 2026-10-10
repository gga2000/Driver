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
  /** Six real roof finishes (plaster, yellow brick, cream, ochre…); each house carries `tone` 0–5. */
  roofTones: readonly [string, string, string, string, string, string];
  /** Night only: the roof colour of a house with its lights on, and the warm light it spills on the street. */
  litRoof: string | null;
  windowGlow: string | null;
  /** School yards, and parks and pitches; the mud bank along the Tigris; the kerb and centre line of main streets. */
  yard: string;
  green: string;
  bank: string;
  kerb: string;
  marking: string;
  /** The 3D landmarks (main mosque, hospital, garages): one colour per `part` in the tiles' `landmarks` layer. */
  landmark: Record<LandmarkPart, string>;
}

/** The parts a landmark is built from (tools/map-tiles/landmarks.py). */
export const LANDMARK_PARTS = [
  'pave', 'stone', 'trim', 'shade', 'dome', 'gold', 'brick', 'water', 'trunk', 'crown', 'person', 'robe', 'skin', 'white',
  'band', 'tank', 'red', 'steel', 'glass', 'car', 'car2', 'yard', 'canopy', 'sign', 'bus', 'bus2',
] as const;
export type LandmarkPart = (typeof LANDMARK_PARTS)[number];

// stone and plaster in the sun, a gilded dome, a white hospital with the red crescent, rust-red garage canopies
const LANDMARK_DAY: Record<LandmarkPart, string> = {
  pave: '#F3E4C8', stone: '#EBD3A6', trim: '#F7E6C4', shade: '#9A6B3E', dome: '#D9A23A', gold: '#C98E2A', brick: '#D7AE78',
  water: '#8C9A5A', trunk: '#6E4A2A', crown: '#5F6B2E', person: '#FFFDF6', robe: '#2B2622', skin: '#C08F63', white: '#FBF8F1',
  band: '#D9CBB3', tank: '#FFFDF7', red: '#C8352B', steel: '#5A4636', glass: '#3B3A38', car: '#E2DFD8', car2: '#8E2F22',
  yard: '#E2CDA6', canopy: '#B8653A', sign: '#E08A1E', bus: '#FBF8F1', bus2: '#EADCC0',
};

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
  roofTones: ['#FBEBCF', '#F6E6CC', '#F2D9AE', '#FCF1DC', '#EFCF9E', '#F3DFC0'],
  litRoof: null, windowGlow: null,
  yard: '#F2DDB2', green: '#CFCF95', bank: '#B8A06C', kerb: '#FFFDF7', marking: '#DDBC88',
  landmark: LANDMARK_DAY,
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
  roofTones: ['#F9D9A0', '#F4E2C0', '#ECC68C', '#FBEAD0', '#E6B97E', '#EBD2AA'],
  yard: '#F0D6A2', green: '#C7C789', bank: '#B39760', marking: '#D7B47E',
  landmark: { ...LANDMARK_DAY, stone: '#ECCB94', trim: '#F7DFB2', pave: '#F2DDB8', dome: '#E0A535', brick: '#DCA765', yard: '#E3C795' },
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
    roofTones: ['#DDB898', '#D9BFA4', '#D2A884', '#E4C6A8', '#CC9F7A', '#D8B392'],
    landmark: { ...LANDMARK_DAY, stone: '#E2B98E', trim: '#EFCDA4', pave: '#E8C9A4', dome: '#DC9534', brick: '#CF9466', yard: '#DDB78F', white: '#F2E2D2', bus: '#F2E2D2' },
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
    sky: { sky: '#1E140C', horizon: '#4A2E16', fog: '#24190F' },
    roofTones: ['#2A2018', '#2E231A', '#33271D', '#271D16', '#2C2219', '#30261E'],
    litRoof: '#55381F', windowGlow: '#FFB04A',
    yard: '#2C2318', green: '#232615', bank: '#3A3020', kerb: '#6E5C48', marking: '#8A7356',
    // floodlit at night: the mosque and the hospital glow warm, the garage canopies stay lit for the late cars
    landmark: {
      pave: '#7A5F40', stone: '#D9B27A', trim: '#E8C58C', shade: '#3A2616', dome: '#E6A53C', gold: '#F0B850', brick: '#C2955C',
      water: '#4A5034', trunk: '#2E2015', crown: '#3E4526', person: '#BFB3A0', robe: '#151210', skin: '#7A5A3C', white: '#E9DFCC',
      band: '#B8A68A', tank: '#8A7A64', red: '#B2302A', steel: '#2A2018', glass: '#1A1714', car: '#6E655A', car2: '#4A1F18',
      yard: '#3A2E20', canopy: '#8A4C2C', sign: '#E08A1E', bus: '#B8AE9E', bus2: '#9E9282',
    },
  },
};
