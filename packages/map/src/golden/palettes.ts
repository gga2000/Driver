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
  /**
   * Streets up close (audit 2026-10-12): warm dusty tarmac with a sandy shoulder, a pale kerb and a white centre line.
   * The style blends the cream streets of the town view into these as the camera comes down to street level.
   */
  asphalt: { major: string; mid: string; minor: string; alley: string; highway: string; shoulder: string; kerb: string; line: string };
  /** School yards, and parks and pitches; the mud bank along the Tigris. */
  yard: string;
  green: string;
  bank: string;
  /** The 3D landmarks (main mosque, hospital, garages): one colour per `part` in the tiles' `landmarks` layer. */
  landmark: Record<LandmarkPart, string>;
}

/** The parts a landmark is built from (tools/map-tiles/landmarks.py). */
export const LANDMARK_PARTS = [
  'pave', 'stone', 'trim', 'shade', 'dome', 'gold', 'brick', 'water', 'trunk', 'crown', 'person', 'robe', 'skin', 'white',
  'band', 'tank', 'red', 'steel', 'glass', 'car', 'car2', 'yard', 'canopy', 'sign', 'bus', 'bus2',
  // the garage terminal (Ali's pick, 2026-10-10): fins and roofs, their saffron light edge, the glass hall, the
  // destination colours, and `pool`, the light on the ground at night (drawn see-through by its own layer)
  'roof', 'led', 'hall', 'column', 'planter', 'paint', 'dest1', 'dest2', 'dest3', 'taxiband', 'kiosk', 'pool',
  // the Ramadan lanterns, kept all year (Ali, 2026-10-11): saffron, gold and coral glass, painted by day, lit at night;
  // the street strings in the tiles' `lanterns` layer use the same three (`c` 0–2)
  'lamp1', 'lamp2', 'lamp3',
] as const;
export type LandmarkPart = (typeof LANDMARK_PARTS)[number];

// stone and plaster in the sun, a gilded dome, a white hospital with the red crescent, the white garage terminals
const LANDMARK_DAY: Record<LandmarkPart, string> = {
  pave: '#F3E4C8', stone: '#EBD3A6', trim: '#F7E6C4', shade: '#9A6B3E', dome: '#D9A23A', gold: '#C98E2A', brick: '#D7AE78',
  water: '#8C9A5A', trunk: '#6E4A2A', crown: '#5F6B2E', person: '#FFFDF6', robe: '#2B2622', skin: '#C08F63', white: '#FBF8F1',
  band: '#D9CBB3', tank: '#FFFDF7', red: '#C8352B', steel: '#5A4636', glass: '#3B3A38', car: '#E2DFD8', car2: '#8E2F22',
  yard: '#CDBB98', canopy: '#B8653A', sign: '#E08A1E', bus: '#FBF8F1', bus2: '#EADCC0',
  roof: '#FFFDF7', led: '#E08A1E', hall: '#5A4A3A', column: '#F2EADA', planter: '#B8653A', paint: '#FBF5E6',
  dest1: '#E08A1E', dest2: '#8E2F22', dest3: '#6E7A3A', taxiband: '#E08A1E', kiosk: '#E08A1E', pool: '#FFB04A',
  lamp1: '#E08A1E', lamp2: '#D9A23A', lamp3: '#C8603F',
};

const DAY: GoldenPalette = {
  land: '#F3E2C2', urban: '#EBD3A8', farm: '#EDE3B9', palm: '#E2DDA8', palmCrown: '#B4B071',
  water: '#7E7F4E', waterEdge: '#666839', canal: '#9AA06A', glint: '#C9C690', glintOpacity: 0.55,
  shadow: '#8A6440', shadowOpacity: 0.3,
  alley: '#FBF1DE', minor: '#FFFBF1', minorCase: '#D9B27A', major: '#FFF6E4', majorCase: '#C9944C',
  highway: '#F8DA9E', highwayCase: '#B67A31', deck: '#FFF8EA', deckCase: '#6B3D1A', lampGlow: null,
  roof: '#FBEBCF', wall: '#C9A877', mosque: '#F4E3C2', tankWhite: '#FFF9EE', tankBlack: '#EFE3CE',
  label: '#4A321D', labelHalo: '#FBF1DE', area: '#8D6A45', river: '#F4EED2', riverHalo: '#5E6533',
  light: { color: '#FFFFFF', intensity: 0.45 },
  sky: { sky: '#F6D9A6', horizon: '#FBEBD0', fog: '#F6E7CB' },
  // lime plaster, yellow brick, sand brick, white-washed, dusty stone, baked brick: Iraqi walls, sculpted by a real sun
  roofTones: ['#F2E2C6', '#EDD3A6', '#E4C190', '#F4E8D2', '#E0C8A4', '#D2AE82'],
  litRoof: null, windowGlow: null,
  asphalt: { major: '#958B7E', mid: '#A09588', minor: '#B9AD98', alley: '#DCC6A0', highway: '#8A8074', shoulder: '#EAD7B4', kerb: '#FBF3E4', line: '#FFFDF6' },
  yard: '#F2DDB2', green: '#CFCF95', bank: '#B8A06C',
  landmark: LANDMARK_DAY,
};

const GOLDEN: GoldenPalette = {
  ...DAY,
  land: '#F1D9B2', urban: '#E9CFA3', farm: '#EADBA9', palm: '#DDD49A', palmCrown: '#ADA562',
  water: '#7A7A48', waterEdge: '#626234', glint: '#EBC883', glintOpacity: 0.8,
  shadow: '#8A6440', shadowOpacity: 0.5,
  alley: '#F9EBD3', minor: '#FFF8EA', minorCase: '#D2A66C', major: '#FFF2D8', majorCase: '#C28640',
  highway: '#F6CF86', highwayCase: '#AE6E25', deck: '#FFF5E2', deckCase: '#633416',
  roof: '#F9D9A0', wall: '#D9A766', mosque: '#F2DCB5',
  label: '#462D17', labelHalo: '#F8EAD2', area: '#87633D', river: '#F4EBCB',
  light: { color: '#FFF1D6', intensity: 0.55 },
  sky: { sky: '#F1C47E', horizon: '#F9DFB4', fog: '#F4DFBC' },
  roofTones: ['#F3E6CF', '#E8C995', '#DDB57C', '#F7EEDD', '#E0C49A', '#CFA56F'],
  asphalt: { major: '#8F8578', mid: '#9B9083', minor: '#B5A893', alley: '#D9C29A', highway: '#857B6F', shoulder: '#E8D3AE', kerb: '#FBF3E4', line: '#FFFDF6' },
  yard: '#F0D6A2', green: '#C7C789', bank: '#B39760',
  landmark: { ...LANDMARK_DAY, stone: '#ECCB94', trim: '#F7DFB2', pave: '#F2DDB8', dome: '#E0A535', brick: '#DCA765', yard: '#D2BC94' },
};

/** The five palettes. `golden` is the look Ali picked; `day` is the same town under a high sun. */
export const GOLDEN_PALETTES: Record<GoldenLight, GoldenPalette> = {
  day: DAY,
  morning: {
    ...DAY,
    land: '#F1E3C8', urban: '#EDDDBF', wall: '#D2B88E', shadow: '#8E8672', shadowOpacity: 0.34,
    light: { color: '#FFF8EA', intensity: 0.45 },
    sky: { sky: '#EFE2C6', horizon: '#F7EEDB', fog: '#F1E3C8' },
  },
  golden: GOLDEN,
  sunset: {
    ...GOLDEN,
    land: '#F0D2AE', urban: '#ECC9A2', roof: '#DDB898', wall: '#B48E70', shadow: '#7E5A44', shadowOpacity: 0.48,
    glint: '#F2B870', glintOpacity: 0.9,
    light: { color: '#FFD9B8', intensity: 0.5 },
    sky: { sky: '#E8A066', horizon: '#F6CF9C', fog: '#F0D2AE' },
    roofTones: ['#E9CDAA', '#DFB78E', '#D5A77E', '#EED8BC', '#D2AA88', '#C2946E'],
    asphalt: { major: '#86786E', mid: '#91837A', minor: '#AA9A8A', alley: '#D2B596', highway: '#7C6F66', shoulder: '#E2C6A4', kerb: '#F6E6D2', line: '#FFF6EA' },
    // the lanterns come on as the sun goes down
    landmark: { ...LANDMARK_DAY, stone: '#E2B98E', trim: '#EFCDA4', pave: '#E8C9A4', dome: '#DC9534', brick: '#CF9466', yard: '#C9B08E', white: '#F2E2D2', bus: '#F2E2D2', lamp1: '#F59A2E', lamp2: '#F2C054', lamp3: '#EE7650' },
  },
  night: {
    land: '#261D15', urban: '#2B2118', farm: '#252012', palm: '#2A2A19', palmCrown: '#4E4F2F',
    water: '#2F3320', waterEdge: '#4A5034', canal: '#2F3320', glint: '#6E5A30', glintOpacity: 0.5,
    shadow: '#000000', shadowOpacity: 0,
    alley: '#3A3026', minor: '#45392D', minorCase: '#261D15', major: '#5A4C3E', majorCase: '#261D15',
    highway: '#665443', highwayCase: '#261D15', deck: '#B48A57', deckCase: '#22180F', lampGlow: '#E8A34A',
    roof: '#2A2018', wall: '#231A13', mosque: '#58422B', tankWhite: '#7A6852', tankBlack: '#6B5A48',
    label: '#F2E0C3', labelHalo: '#22180F', area: '#BFA27C', river: '#C9CC9C', riverHalo: '#1E2114',
    light: { color: '#FFD9A0', intensity: 0.36 },
    sky: { sky: '#1E140C', horizon: '#4A2E16', fog: '#24190F' },
    // a warm evening, not a black-out: walls in umber and olive-brown (red-browns turn purple under the lamps)
    roofTones: ['#54473A', '#4C4033', '#5C4D3B', '#463B30', '#615240', '#50443A'],
    litRoof: '#6E4A26', windowGlow: '#FFB04A',
    asphalt: { major: '#4A4036', mid: '#463C33', minor: '#41372E', alley: '#3D3329', highway: '#463D34', shoulder: '#2E251C', kerb: '#B8945E', line: '#E9C27A' },
    yard: '#2C2318', green: '#232615', bank: '#3A3020',
    // floodlit at night: the mosque and the hospital glow warm; the garages' fins light up in saffron lines, the hall
    // and the tea kiosk glow, and light pools on the ground under them
    landmark: {
      pave: '#7A5F40', stone: '#D9B27A', trim: '#E8C58C', shade: '#3A2616', dome: '#E6A53C', gold: '#F0B850', brick: '#C2955C',
      water: '#4A5034', trunk: '#2E2015', crown: '#3E4526', person: '#BFB3A0', robe: '#151210', skin: '#7A5A3C', white: '#E9DFCC',
      band: '#B8A68A', tank: '#8A7A64', red: '#B2302A', steel: '#2A2018', glass: '#1A1714', car: '#6E655A', car2: '#4A1F18',
      yard: '#2E271E', canopy: '#8A4C2C', sign: '#E08A1E', bus: '#B8AE9E', bus2: '#9E9282',
      roof: '#6A6052', led: '#FFC66E', hall: '#FFC66E', column: '#5E554A', planter: '#5A3020', paint: '#7A6A52',
      dest1: '#FFB04A', dest2: '#E0604A', dest3: '#B8C46A', taxiband: '#C8781A', kiosk: '#FFB04A', pool: '#FFB04A',
      lamp1: '#FFB04A', lamp2: '#FFD77E', lamp3: '#FF8A5C',
    },
  },
};
