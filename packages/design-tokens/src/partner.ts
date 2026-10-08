/**
 * «الدشبول» (the dashboard) — the Driver Partner app's look (partner redesign, Ali 2026-10-07: "yes to
 * all"). Vivid Date & Saffron, a colour per service, no teal or blue anywhere, built to be read in a
 * dashboard holder under the Iraqi sun and, after sunset, in the ember night palette.
 *
 * Two layers, like `themes`:
 * - `partnerThemes.sun` / `partnerThemes.ember`: complete `ThemeColors`, so every `@driver/ui`
 *   component draws in the dashboard look when the Partner app passes them to `ThemeProvider colors`.
 *   `info` is date brown, never blue (bug b3). Both pass every `contrastPairs` / `nonTextPairs` row.
 * - `partnerServices`: the order slip's colour per service (food saffron, taxi yellow, tuktuk plum,
 *   trips date brown with gold) and `partnerDash`: the home's state tops (working saffron, no
 *   internet ink).
 */
import type { ThemeColors } from './tokens.js';

const sun: ThemeColors = {
  bg: '#FFFCF7',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#F7ECDD',
  text: '#140B05',
  textMuted: '#54412F',
  accent: '#F38A1B',
  onAccent: '#1A0C02',
  accentTint: '#FFE7C7',
  accentText: '#9A4700',
  border: '#E3D1B8',
  borderStrong: '#8A6E52',
  accentBorder: '#B85F07',
  focusRing: '#140B05',
  success: '#16703F',
  successTint: '#DDF1E3',
  successText: '#16703F',
  warning: '#A87900',
  warningTint: '#FAF0C8',
  warningText: '#6E5000',
  danger: '#B3261E',
  onDanger: '#FFFFFF',
  dangerTint: '#FCE3DF',
  dangerText: '#9E2119',
  // Date brown takes the role blue had (b3): notes, "waiting for approval", the fleet's "on a job".
  info: '#6B4426',
  infoTint: '#F3E4D3',
  infoText: '#5A3416',
  inverse: '#140B05',
  tabSelected: '#FDE3C2',
  onTabSelected: '#8A4300',
  onInverse: '#FFFCF7',
  onInverseMuted: '#D9C6AE',
  onInverseCaution: '#FFC155',
  onInverseSuccess: '#7ACF9D',
  onInverseAccent: '#FFA63D',
  selected: '#F38A1B',
  onSelected: '#1A0C02',
  selectedBorder: '#B85F07',
  selectedSoft: '#FFE7C7',
  onSelectedSoft: '#140B05',
  selectedMark: '#F38A1B',
  onSelectedMark: '#1A0C02',
  segmentSelected: '#FFFFFF',
  segmentSelectedBorder: '#9A4700',
  onSegmentSelected: '#140B05',
  stepperPlus: '#F38A1B',
  onStepperPlus: '#1A0C02',
  stepperPlusBorder: '#F38A1B',
  star: '#F38A1B',
  starOutline: '#F38A1B',
  tintBorder: '#F38A1B',
  live: '#F38A1B',
  liveTint: '#FFE7C7',
  liveText: '#9A4700',
  deal: '#FFC155',
  onDeal: '#140B05',
  seatTaken: '#EADBC6',
  scrim: 'rgba(20, 11, 5, 0.45)',
  photoBackdrop: '#0E0B08',
  photoChrome: '#2A231C',
  onPhotoBackdrop: '#F6EFE4',
  shimmer: '#FFFCF7',
  shadow: '#5A3A12',
};

/** After sunset (idea n2): warm dark paper, ember saffron, nothing that glares in a dark car. */
const ember: ThemeColors = {
  bg: '#120B06',
  surface: '#21150C',
  surfaceRaised: '#2B1C11',
  surfaceSunken: '#0D0804',
  text: '#FFF3E2',
  textMuted: '#D2BCA2',
  accent: '#FFA63D',
  onAccent: '#1A0C02',
  accentTint: '#3E2810',
  accentText: '#FFB65C',
  border: '#3D2A1B',
  borderStrong: '#9C8064',
  accentBorder: '#FFB65C',
  focusRing: '#FFF3E2',
  success: '#5FD08E',
  successTint: '#163222',
  successText: '#7EDCA4',
  warning: '#E5B53A',
  warningTint: '#3A3010',
  warningText: '#F2CF68',
  danger: '#FF8A80',
  onDanger: '#1A0C02',
  dangerTint: '#3B1613',
  dangerText: '#FF9E95',
  info: '#D9A877',
  infoTint: '#33220F',
  infoText: '#E8BE8E',
  inverse: '#FFF3E2',
  tabSelected: '#3D2410',
  onTabSelected: '#FFB35C',
  onInverse: '#140B05',
  onInverseMuted: '#54412F',
  onInverseCaution: '#8A5300',
  onInverseSuccess: '#16703F',
  onInverseAccent: '#9A4700',
  selected: '#FFA63D',
  onSelected: '#1A0C02',
  selectedBorder: '#FFB65C',
  selectedSoft: '#3E2810',
  onSelectedSoft: '#FFF3E2',
  selectedMark: '#FFA63D',
  onSelectedMark: '#1A0C02',
  segmentSelected: '#21150C',
  segmentSelectedBorder: '#FFB65C',
  onSegmentSelected: '#FFF3E2',
  stepperPlus: '#FFA63D',
  onStepperPlus: '#1A0C02',
  stepperPlusBorder: '#FFA63D',
  star: '#FFA63D',
  starOutline: '#FFA63D',
  tintBorder: '#FFA63D',
  live: '#FFA63D',
  liveTint: '#3E2810',
  liveText: '#FFB65C',
  deal: '#FFC155',
  onDeal: '#140B05',
  seatTaken: '#3A2A1C',
  scrim: 'rgba(0, 0, 0, 0.6)',
  photoBackdrop: '#0E0B08',
  photoChrome: '#2A231C',
  onPhotoBackdrop: '#F6EFE4',
  shimmer: '#2B1C11',
  shadow: '#000000',
};

export const partnerThemes = { sun, ember } as const;
export type PartnerThemeName = keyof typeof partnerThemes;

/** A service's slip colour: `fill` is the slip's top band and chip, `on` the text on it. */
export interface PartnerServiceColor {
  fill: string;
  on: string;
  /** Pale wash of the service colour (chips on the slip). */
  tint: string;
  /** Service-coloured text and icons on `tint` and on the card. */
  ink: string;
}

export type PartnerService = 'food' | 'taxi' | 'tuktuk' | 'trips';

/**
 * Colour per service (idea o1, bug b9): food saffron, taxi yellow, tuktuk plum (never red: red is
 * the error colour), trips date brown with gold. Every pair is AA-tested in `partner.test.ts`.
 */
export const partnerServices: Record<PartnerThemeName, Record<PartnerService, PartnerServiceColor>> = {
  sun: {
    food: { fill: '#F38A1B', on: '#1A0C02', tint: '#FFE7C7', ink: '#9A4700' },
    taxi: { fill: '#FFD84D', on: '#140B05', tint: '#FFF4C2', ink: '#6E5000' },
    tuktuk: { fill: '#8A3F93', on: '#FFFFFF', tint: '#F1E1F3', ink: '#7A3483' },
    trips: { fill: '#2A170C', on: '#FFC155', tint: '#F3E4D3', ink: '#5A3416' },
  },
  ember: {
    food: { fill: '#FFA63D', on: '#1A0C02', tint: '#3E2810', ink: '#FFB65C' },
    taxi: { fill: '#FFD84D', on: '#140B05', tint: '#3A3010', ink: '#FFE27A' },
    tuktuk: { fill: '#C27ACC', on: '#140B05', tint: '#33193A', ink: '#DFA6E6' },
    trips: { fill: '#0B0603', on: '#FFC155', tint: '#33220F', ink: '#FFC155' },
  },
};

/** Home's state top (idea h3): working = saffron with a breathing dot, no internet = ink. */
export interface PartnerDash {
  /** Working: top-to-bottom gold → saffron, ink text. */
  working: readonly [string, string];
  onWorking: string;
  /** No internet: ink top, cream text. */
  offline: string;
  onOffline: string;
  /** Cash in hand past 80 % of the cap (idea h7): a saffron card. */
  cashNear: string;
  onCashNear: string;
}

export const partnerDash: Record<PartnerThemeName, PartnerDash> = {
  sun: { working: ['#FFC155', '#F38A1B'], onWorking: '#140B05', offline: '#140B05', onOffline: '#FFF3E2', cashNear: '#FFE7C7', onCashNear: '#6B3300' },
  ember: { working: ['#FFB65C', '#E9861F'], onWorking: '#140B05', offline: '#FFF3E2', onOffline: '#140B05', cashNear: '#3E2810', onCashNear: '#FFC98A' },
};
