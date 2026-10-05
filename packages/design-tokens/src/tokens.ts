/**
 * Driver design tokens. Direction-agnostic by design (see README on RTL).
 *
 * Two layers:
 * - `color`: raw scales (50–900) derived from the brand palette (docs/specs/2026-10-03-brand.md).
 *   The Console's Tailwind config and the map read these.
 * - `themes.light` / `themes.dark`: semantic roles (`bg`, `text`, `accent`, …) that every
 *   component in `@driver/ui` reads. Components never reach for a raw scale.
 *
 * Every foreground/background pair a component draws is listed in `contrastPairs` and checked
 * against WCAG AA in `contrast.test.ts` (4.5:1 body, 3:1 for text ≥ 24 px or ≥ 18.5 px bold).
 */

export const color = {
  /** Deep orange — the brand accent `#E08A1E` sits at 500. */
  primary: {
    50: '#FEF6EA',
    100: '#FCEBD3',
    200: '#F8D4A4',
    300: '#F2B96A',
    400: '#EBA040',
    500: '#E08A1E',
    600: '#C27214',
    700: '#9A5200',
    800: '#74400A',
    900: '#4F2C08',
  },
  /** Warm neutrals from cream paper (50) to the brand ink (900). */
  neutral: {
    0: '#FFFFFF',
    50: '#FBF6EE',
    100: '#F3EBDD',
    200: '#EADFCF',
    300: '#D6C8B4',
    400: '#B3A594',
    500: '#8C7F6F',
    600: '#6B6157',
    700: '#4A4239',
    800: '#2E2720',
    900: '#1F1A14',
    1000: '#000000',
  },
  success: {
    50: '#E3F2E8',
    100: '#C3E3CF',
    500: '#2F8F5B',
    700: '#23744A',
    900: '#134229',
  },
  warning: {
    50: '#FDF3E0',
    100: '#FBEBCC',
    500: '#C77700',
    700: '#8A5300',
    900: '#4F2F00',
  },
  danger: {
    50: '#F9E3DE',
    100: '#F2C3B9',
    500: '#C2412D',
    700: '#A8361F',
    900: '#5E1C10',
  },
  info: {
    50: '#E1ECF7',
    100: '#C0D6EE',
    500: '#2F6FB0',
    700: '#245C96',
    900: '#13355A',
  },
} as const;

/** Semantic colour roles. Both themes define every key. */
export interface ThemeColors {
  /** Screen background (cream paper). */
  bg: string;
  /** Cards, sheets, list groups. */
  surface: string;
  /** A surface lifted above another surface (sheet over map, popovers). */
  surfaceRaised: string;
  /** Recessed wells: input fields, segmented-control tracks, skeleton base. */
  surfaceSunken: string;
  text: string;
  textMuted: string;
  /** Brand accent fill: primary buttons, selected chips, the front seat, progress. */
  accent: string;
  /** Text and icons drawn on `accent`. Dark ink: white on the brand orange fails AA. */
  onAccent: string;
  /** Pale accent wash: selected rows, the front-seat cell, accent pills. */
  accentTint: string;
  /** Accent-coloured text (links, totals, "+2,000") — the fill is too light to read as text. */
  accentText: string;
  border: string;
  /**
   * Boundaries people must see (WCAG 1.4.11, ≥ 3:1): text fields at rest, secondary button outline,
   * free and blocked seats. Decorative card borders and dividers use `border`.
   */
  borderStrong: string;
  /** Outline of a selected chip, drawn with the check icon so selection never rests on colour alone. */
  accentBorder: string;
  /** Keyboard focus ring and focused field border: ink on light, cream on dark. */
  focusRing: string;
  success: string;
  successTint: string;
  successText: string;
  warning: string;
  warningTint: string;
  warningText: string;
  danger: string;
  /** Text on a `danger` fill (destructive button). */
  onDanger: string;
  dangerTint: string;
  dangerText: string;
  info: string;
  infoTint: string;
  infoText: string;
  /** Seat that someone else holds or owns. */
  seatTaken: string;
  /** Map/scrim overlays behind sheets. */
  scrim: string;
  /** Shimmer highlight that sweeps across `surfaceSunken`. */
  shimmer: string;
  /** Shadow hue: warm brown, never neutral grey. */
  shadow: string;
}

export type ThemeColorKey = keyof ThemeColors;

const light: ThemeColors = {
  bg: '#FBF6EE',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#F3EBDD',
  text: '#1F1A14',
  textMuted: '#6B6157',
  accent: '#E08A1E',
  onAccent: '#1F1A14',
  accentTint: '#FCEBD3',
  accentText: '#9A5200',
  border: '#EADFCF',
  borderStrong: '#8C7F6F',
  accentBorder: '#C27214',
  focusRing: '#1F1A14',
  success: '#2F8F5B',
  successTint: '#E3F2E8',
  successText: '#23744A',
  warning: '#C77700',
  warningTint: '#FBEBCC',
  warningText: '#8A5300',
  danger: '#C2412D',
  onDanger: '#FFFFFF',
  dangerTint: '#F9E3DE',
  dangerText: '#A8361F',
  info: '#2F6FB0',
  infoTint: '#E1ECF7',
  infoText: '#245C96',
  seatTaken: '#E8DFD0',
  scrim: 'rgba(31, 26, 20, 0.45)',
  shimmer: '#FBF6EE',
  shadow: '#5A3A12',
};

/** Stub for later (brand spec: "warm near-black base"), complete so it can be toggled in QA. */
const dark: ThemeColors = {
  bg: '#16120E',
  surface: '#201A15',
  surfaceRaised: '#2A231C',
  surfaceSunken: '#120E0B',
  text: '#F6EFE4',
  textMuted: '#B8AA98',
  accent: '#EE9A32',
  onAccent: '#1F1A14',
  accentTint: '#3B2914',
  accentText: '#F5B45E',
  border: '#3A3027',
  borderStrong: '#8C7F6F',
  accentBorder: '#F5B45E',
  focusRing: '#F6EFE4',
  success: '#4DB27A',
  successTint: '#183224',
  successText: '#7ACF9D',
  warning: '#E59A2F',
  warningTint: '#3A2A10',
  warningText: '#F2BC68',
  danger: '#E06A54',
  onDanger: '#1F1A14',
  dangerTint: '#3D1D16',
  dangerText: '#F2937F',
  info: '#5C9BD8',
  infoTint: '#152A40',
  infoText: '#8EBDEA',
  seatTaken: '#3A3229',
  scrim: 'rgba(0, 0, 0, 0.6)',
  shimmer: '#2A231C',
  shadow: '#000000',
};

export const themes = { light, dark } as const;
export type ThemeName = keyof typeof themes;

/**
 * Every text-on-background pair `@driver/ui` draws. `large` pairs only ever render at ≥ 24 px
 * (or ≥ 18.5 px bold) and need 3:1; the rest need 4.5:1. Add a row here before using a new pair.
 */
export const contrastPairs: ReadonlyArray<{ fg: ThemeColorKey; bg: ThemeColorKey; use: string; large?: boolean }> = [
  { fg: 'text', bg: 'bg', use: 'body copy on the screen' },
  { fg: 'textMuted', bg: 'bg', use: 'secondary copy on the screen' },
  { fg: 'text', bg: 'surface', use: 'card copy' },
  { fg: 'textMuted', bg: 'surface', use: 'card secondary copy, list row subtitles' },
  { fg: 'text', bg: 'surfaceRaised', use: 'sheet copy' },
  { fg: 'textMuted', bg: 'surfaceRaised', use: 'sheet secondary copy' },
  { fg: 'text', bg: 'surfaceSunken', use: 'text field value, segmented options' },
  { fg: 'textMuted', bg: 'surfaceSunken', use: 'placeholder, unselected segment' },
  { fg: 'onAccent', bg: 'accent', use: 'primary button, selected chip, selected seat' },
  { fg: 'text', bg: 'accentTint', use: 'selected list row, front-seat cell' },
  { fg: 'textMuted', bg: 'accentTint', use: 'secondary copy on accent tint' },
  { fg: 'accentText', bg: 'accentTint', use: 'accent pill, front-seat premium' },
  { fg: 'accentText', bg: 'surface', use: 'links, ghost button, totals on cards' },
  { fg: 'accentText', bg: 'bg', use: 'links, ghost button on the screen' },
  { fg: 'successText', bg: 'successTint', use: 'success pill' },
  { fg: 'successText', bg: 'surface', use: 'discount lines, "verified today"' },
  { fg: 'warningText', bg: 'warningTint', use: 'warning pill, held seat' },
  { fg: 'warningText', bg: 'surface', use: 'late meter copy' },
  { fg: 'dangerText', bg: 'dangerTint', use: 'danger pill' },
  { fg: 'dangerText', bg: 'surface', use: 'error copy under fields' },
  { fg: 'dangerText', bg: 'bg', use: 'error copy on the screen' },
  { fg: 'onDanger', bg: 'danger', use: 'destructive button' },
  { fg: 'infoText', bg: 'infoTint', use: 'info pill, walk-up seat' },
  { fg: 'text', bg: 'seatTaken', use: 'taken seat label' },
  { fg: 'textMuted', bg: 'seatTaken', use: 'taken seat caption' },
  { fg: 'text', bg: 'warningTint', use: 'toast body on warning' },
  { fg: 'accentText', bg: 'surfaceRaised', use: 'current step time, links inside sheets' },
  { fg: 'successText', bg: 'surfaceRaised', use: '"verified today" inside sheets' },
  { fg: 'warningText', bg: 'surfaceRaised', use: 'delay note inside sheets' },
  { fg: 'text', bg: 'successTint', use: 'toast body on success' },
  { fg: 'text', bg: 'infoTint', use: 'walk-up seat label' },
  { fg: 'bg', bg: 'text', use: 'toast message (inverted surface, light theme)' },
  { fg: 'accentTint', bg: 'text', use: 'toast action (inverted surface, light theme)' },
];

/**
 * Every boundary, focus indicator and selected-state cue `@driver/ui` draws that people need to see
 * to use a control (WCAG 1.4.11): 3:1 against what sits next to it. Checked in `contrast.test.ts`
 * for both themes. Decorative borders (cards, dividers) are deliberately not listed.
 */
export const nonTextPairs: ReadonlyArray<{ fg: ThemeColorKey; bg: ThemeColorKey; use: string }> = [
  { fg: 'borderStrong', bg: 'bg', use: 'text field at rest, secondary button outline on the screen' },
  { fg: 'borderStrong', bg: 'surface', use: 'text field at rest on a card, free seat outline' },
  { fg: 'borderStrong', bg: 'surfaceRaised', use: 'text field inside a sheet' },
  { fg: 'focusRing', bg: 'bg', use: 'keyboard focus ring on the screen' },
  { fg: 'focusRing', bg: 'surface', use: 'keyboard focus ring on a card' },
  { fg: 'focusRing', bg: 'surfaceSunken', use: 'focused text field border' },
  { fg: 'danger', bg: 'surfaceSunken', use: 'text field error border' },
  { fg: 'accentBorder', bg: 'surface', use: 'selected chip outline on a card' },
  { fg: 'accentBorder', bg: 'bg', use: 'selected chip outline on the screen' },
  { fg: 'accentText', bg: 'surface', use: 'selected segment thumb outline, check on a selected row' },
  { fg: 'accentText', bg: 'accentTint', use: 'check icon on a selected list row' },
  { fg: 'onAccent', bg: 'accent', use: 'check icon on a selected chip or seat' },
];

/** Spacing scale of 4. Keys are multipliers; values are px. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
} as const;

/**
 * Radii carry hierarchy: controls are rounder than the cards that hold them, sheets the roundest
 * at their top edge. Seats use `seat` so a car reads as a car, not a grid of buttons.
 */
export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 28,
  seat: 12,
  pill: 9999,
} as const;

/** Arabic faces first; Latin fallbacks cover digits and mixed content. */
export const fontFamily = {
  sans: ['IBM Plex Sans Arabic', 'Noto Naskh Arabic', 'Noto Sans Arabic', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
  display: ['IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'Noto Sans Arabic', 'system-ui', 'sans-serif'],
  mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
} as const;

/**
 * Native font files (expo-font / @expo-google-fonts/ibm-plex-sans-arabic) are one family per
 * weight; the web uses the CSS family with `fontWeight`.
 */
export const fontFace = {
  400: 'IBMPlexSansArabic_400Regular',
  500: 'IBMPlexSansArabic_500Medium',
  600: 'IBMPlexSansArabic_600SemiBold',
  700: 'IBMPlexSansArabic_700Bold',
} as const;
export type FontWeight = keyof typeof fontFace;

/**
 * Type scale: size/lineHeight in px. Arabic needs ~1.65× line height for body (descenders of
 * ي/ج and stacked dots) — far taller than Latin's 1.4. Amounts are digit-only and run tighter.
 */
export const type = {
  caption: { size: 12, lineHeight: 20, weight: 400 },
  footnote: { size: 13, lineHeight: 22, weight: 400 },
  body: { size: 15, lineHeight: 26, weight: 400 },
  bodyStrong: { size: 15, lineHeight: 26, weight: 600 },
  label: { size: 14, lineHeight: 22, weight: 500 },
  button: { size: 16, lineHeight: 26, weight: 600 },
  title: { size: 18, lineHeight: 30, weight: 600 },
  heading: { size: 22, lineHeight: 36, weight: 700 },
  display: { size: 30, lineHeight: 46, weight: 700 },
  amount: { size: 26, lineHeight: 34, weight: 700 },
  /** Hero numbers (earnings, cash to hand in, PIN, countdowns): tabular digits, bold. */
  numeralSm: { size: 34, lineHeight: 44, weight: 700 },
  numeralMd: { size: 44, lineHeight: 56, weight: 700 },
  numeralLg: { size: 48, lineHeight: 64, weight: 700 },
} as const;
export type TypeVariant = keyof typeof type;

/** The smallest text anywhere (audit S-10): Arabic dots and stacked forms blur below 12 px. */
export const minFontSize = 12;

/**
 * Large-text policy (audit S-11): body copy scales with the OS setting without limit; compact
 * controls whose height must hold (chips, pills, badges, tab labels, segment labels) stop growing
 * at 1.3× and grow in height (`minHeight`) instead of clipping.
 */
export const fontScale = { compact: 1.3 } as const;

export const motion = {
  duration: {
    instant: 80,
    fast: 150,
    base: 220,
    slow: 360,
    deliberate: 600,
    /** Timeline "current step" pulse period. */
    pulse: 1400,
    /** Skeleton shimmer sweep period. */
    shimmer: 1200,
    /** Price total count-up. */
    countUp: 500,
  },
  /** CSS cubic-bezier strings (Console, web) — mirrored as control points in `bezier`. */
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    decelerate: 'cubic-bezier(0, 0, 0, 1)',
    accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  /** Control points for Reanimated's `Easing.bezier(x1, y1, x2, y2)`. */
  bezier: {
    standard: [0.2, 0, 0, 1],
    decelerate: [0, 0, 0, 1],
    accelerate: [0.3, 0, 1, 1],
  },
  /** Reanimated `withSpring` configs. */
  spring: {
    /** Button press-in / release: quick, no wobble. */
    press: { damping: 20, stiffness: 420, mass: 0.6 },
    /** Chip and seat select: one small overshoot. */
    select: { damping: 11, stiffness: 260, mass: 0.7 },
    /** Bottom sheet snapping between detents. */
    sheet: { damping: 26, stiffness: 240, mass: 0.9 },
    /** Toast enter. */
    gentle: { damping: 18, stiffness: 160, mass: 1 },
  },
  /** Toast timing (audit S-21): longer with an action, longer again with a screen reader. */
  toast: { plainMs: 4000, actionMs: 8000, screenReaderFactor: 2, queue: 2 },
  /** Scale applied while a pressable is held. */
  pressScale: 0.97,
} as const;

/** Soft warm shadows. Native props for React Native; `css` for the Console/web. */
export const elevation = {
  0: { shadowColor: '#5A3A12', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0, css: 'none' },
  1: {
    shadowColor: '#5A3A12',
    shadowOpacity: 0.07,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
    css: '0 1px 3px rgba(90, 58, 18, 0.07)',
  },
  2: {
    shadowColor: '#5A3A12',
    shadowOpacity: 0.09,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    css: '0 4px 14px rgba(90, 58, 18, 0.09)',
  },
  3: {
    shadowColor: '#5A3A12',
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    css: '0 10px 28px rgba(90, 58, 18, 0.14)',
  },
} as const;
export type ElevationLevel = keyof typeof elevation;

/** State layers: overlays and opacities for interaction states, applied over any fill. */
export const state = {
  hoverOpacity: 0.04,
  pressedOpacity: 0.08,
  focusRingWidth: 2,
  /** Gap between a control and its focus ring (the screen shows through). */
  focusRingOffset: 2,
  disabledOpacity: 0.4,
  /** Overlay colour for state layers, per theme (ink on light, cream on dark). */
  layer: { light: '#1F1A14', dark: '#F6EFE4' },
} as const;

/** Minimum touch target (px). */
export const hitTarget = 44;

export const tokens = {
  color,
  themes,
  space,
  radius,
  fontFamily,
  fontFace,
  type,
  motion,
  elevation,
  state,
  hitTarget,
  minFontSize,
  fontScale,
} as const;
export type Tokens = typeof tokens;
