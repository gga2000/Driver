/**
 * Driver design tokens. Direction-agnostic by design (see README on RTL).
 * Scale steps for color are 50–900, spacing is a scale of 4px, type sizes in px.
 */

export const color = {
  /** Primary: a warm Iraqi-sun amber that reads well on asphalt-dark and paper-light surfaces. */
  primary: {
    50: '#FFF8E6',
    100: '#FFEDBF',
    200: '#FFDE85',
    300: '#FFCB4A',
    400: '#FFB81F',
    500: '#F5A000',
    600: '#D98700',
    700: '#B36C00',
    800: '#8C5300',
    900: '#663B00',
  },
  neutral: {
    0: '#FFFFFF',
    50: '#F8F7F4',
    100: '#F0EEE9',
    200: '#E2DFD8',
    300: '#C9C5BC',
    400: '#A39E94',
    500: '#7C776E',
    600: '#5E5A52',
    700: '#44413B',
    800: '#2C2A26',
    900: '#1A1917',
    1000: '#000000',
  },
  success: {
    50: '#E9F8EE',
    100: '#C8EDD5',
    500: '#1F9D55',
    700: '#146B3A',
    900: '#0B3F22',
  },
  warning: {
    50: '#FFF4E5',
    100: '#FFE1B8',
    500: '#E07B00',
    700: '#9E5600',
    900: '#5C3200',
  },
  danger: {
    50: '#FDECEC',
    100: '#F9C9C9',
    500: '#D03B3B',
    700: '#962626',
    900: '#5A1515',
  },
} as const;

/** Spacing scale of 4. Keys are multipliers; values are px. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  pill: 9999,
} as const;

/** Arabic faces first; Latin fallbacks cover digits and mixed content. */
export const fontFamily = {
  sans: ['IBM Plex Sans Arabic', 'Noto Naskh Arabic', 'Noto Sans Arabic', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
  display: ['IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'Noto Sans Arabic', 'system-ui', 'sans-serif'],
  mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
} as const;

/** Type scale: size/lineHeight in px, weight. Arabic needs taller line heights than Latin. */
export const type = {
  caption: { size: 12, lineHeight: 18, weight: 400 },
  body: { size: 15, lineHeight: 24, weight: 400 },
  bodyStrong: { size: 15, lineHeight: 24, weight: 600 },
  label: { size: 14, lineHeight: 20, weight: 500 },
  title: { size: 18, lineHeight: 28, weight: 600 },
  heading: { size: 22, lineHeight: 32, weight: 700 },
  display: { size: 30, lineHeight: 40, weight: 700 },
  amount: { size: 26, lineHeight: 32, weight: 700 },
} as const;

export const motion = {
  duration: {
    instant: 80,
    fast: 150,
    base: 220,
    slow: 360,
    deliberate: 600,
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    decelerate: 'cubic-bezier(0, 0, 0, 1)',
    accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

export const elevation = {
  0: 'none',
  1: '0 1px 2px rgba(26, 25, 23, 0.08)',
  2: '0 2px 8px rgba(26, 25, 23, 0.10)',
  3: '0 8px 24px rgba(26, 25, 23, 0.14)',
} as const;

export const tokens = { color, space, radius, fontFamily, type, motion, elevation } as const;
export type Tokens = typeof tokens;
