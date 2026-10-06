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
  /** Caution: mustard, kept away from the brand orange (joy S2-02); 300 is the saffron of the inverse banner. */
  warning: {
    50: '#FCF6E0',
    100: '#FAF0C8',
    300: '#F2C14E',
    500: '#B07F00',
    700: '#7A5A00',
    900: '#4A3600',
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
  /**
   * The inverse banner (joy S2-02): a warning is structural, not a tint. Ink on the light theme,
   * cream on the dark one, so it never reads as the brand card.
   */
  inverse: string;
  /** Text on `inverse`. */
  onInverse: string;
  /** Secondary text on `inverse`. */
  onInverseMuted: string;
  /** The caution icon and bar on `inverse`: saffron on ink. */
  onInverseCaution: string;
  /** Good news on `inverse` (the honest-delay credit came back). */
  onInverseSuccess: string;
  /** Brand line on `inverse`: the restaurant · status on the live-order card. */
  onInverseAccent: string;
  /**
   * The chosen chip, radio or seat (joy S2-01): ink in istikan, so the brand orange keeps one job
   * (the main action). `light`/`dark` keep the accent fill the other apps draw.
   */
  selected: string;
  /** Text and the check on `selected`. */
  onSelected: string;
  /** Outline of a selected chip, drawn with the check so selection never rests on colour alone. */
  selectedBorder: string;
  /** A chosen person chip ("لمن؟"): soft in light (accent wash), ink in istikan. */
  selectedSoft: string;
  /** Text on `selectedSoft`. */
  onSelectedSoft: string;
  /** The round check mark on a chosen person chip. */
  selectedMark: string;
  /** The check inside `selectedMark`. */
  onSelectedMark: string;
  /** The segmented-control thumb under the chosen option. */
  segmentSelected: string;
  /** Outline of the segmented-control thumb. */
  segmentSelectedBorder: string;
  /** The chosen segment's label. */
  onSegmentSelected: string;
  /** The stepper's "+": an accent blob in light, a neutral key (surface + strong line) in istikan. */
  stepperPlus: string;
  /** The "+" glyph on `stepperPlus`. */
  onStepperPlus: string;
  /** The ring around `stepperPlus`. */
  stepperPlusBorder: string;
  /** Rating star fill: saffron in istikan (stars are a treat, not the action). */
  star: string;
  /** Rating star outline: ink in istikan (ink alone is 17:1 on the card). */
  starOutline: string;
  /** Border of `Card tone="tint"`: the accent in light, none (the wash itself) in istikan (S2-11). */
  tintBorder: string;
  /** Moving and live (kashi in istikan): courier, route, ETA, the taxi/tuktuk/الرجعة tiles. */
  live: string;
  /** Pale `live` wash behind the mobility tiles. */
  liveTint: string;
  /** `live`-coloured text and glyphs. */
  liveText: string;
  /** Deal sticker fill: saffron with ink text (never the success green, S2-03). */
  deal: string;
  /** Text on `deal`. */
  onDeal: string;
  /** Seat that someone else holds or owns. */
  seatTaken: string;
  /** Map/scrim overlays behind sheets. */
  scrim: string;
  /**
   * Solid near-black behind a full-screen photo (door, pickup spot), the same in every theme: the
   * photo is the only thing on screen, so nothing of the job, the map or SOS shows through.
   */
  photoBackdrop: string;
  /** The title pill and close button floating on `photoBackdrop`. */
  photoChrome: string;
  /** Text and icons on `photoBackdrop` and `photoChrome`. */
  onPhotoBackdrop: string;
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
  warning: '#B07F00',
  warningTint: '#FAF0C8',
  warningText: '#7A5A00',
  danger: '#C2412D',
  onDanger: '#FFFFFF',
  dangerTint: '#F9E3DE',
  dangerText: '#A8361F',
  info: '#2F6FB0',
  infoTint: '#E1ECF7',
  infoText: '#245C96',
  inverse: '#1F1A14',
  onInverse: '#FBF6EE',
  onInverseMuted: '#D6C8B4',
  onInverseCaution: '#F2C14E',
  onInverseSuccess: '#7ACF9D',
  onInverseAccent: '#EBA040',
  // J3a roles: the values the shared components drew before, so the Partner, Merchant and Console
  // look exactly the same (tokens.test.ts freezes them).
  selected: '#E08A1E',
  onSelected: '#1F1A14',
  selectedBorder: '#C27214',
  selectedSoft: '#FCEBD3',
  onSelectedSoft: '#1F1A14',
  selectedMark: '#E08A1E',
  onSelectedMark: '#1F1A14',
  segmentSelected: '#FFFFFF',
  segmentSelectedBorder: '#9A5200',
  onSegmentSelected: '#1F1A14',
  stepperPlus: '#E08A1E',
  onStepperPlus: '#1F1A14',
  stepperPlusBorder: '#E08A1E',
  star: '#E08A1E',
  starOutline: '#E08A1E',
  tintBorder: '#E08A1E',
  live: '#E08A1E',
  liveTint: '#FCEBD3',
  liveText: '#9A5200',
  deal: '#F2C14E',
  onDeal: '#1F1A14',
  seatTaken: '#E8DFD0',
  scrim: 'rgba(31, 26, 20, 0.45)',
  photoBackdrop: '#0E0B08',
  photoChrome: '#2A231C',
  onPhotoBackdrop: '#F6EFE4',
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
  warning: '#E5B53A',
  warningTint: '#3A3010',
  warningText: '#F2CF68',
  danger: '#E06A54',
  onDanger: '#1F1A14',
  dangerTint: '#3D1D16',
  dangerText: '#F2937F',
  info: '#5C9BD8',
  infoTint: '#152A40',
  infoText: '#8EBDEA',
  inverse: '#F6EFE4',
  onInverse: '#1F1A14',
  onInverseMuted: '#4A4239',
  onInverseCaution: '#8A5300',
  onInverseSuccess: '#23744A',
  onInverseAccent: '#9A5200',
  selected: '#EE9A32',
  onSelected: '#1F1A14',
  selectedBorder: '#F5B45E',
  selectedSoft: '#3B2914',
  onSelectedSoft: '#F6EFE4',
  selectedMark: '#EE9A32',
  onSelectedMark: '#1F1A14',
  segmentSelected: '#201A15',
  segmentSelectedBorder: '#F5B45E',
  onSegmentSelected: '#F6EFE4',
  stepperPlus: '#EE9A32',
  onStepperPlus: '#1F1A14',
  stepperPlusBorder: '#EE9A32',
  star: '#EE9A32',
  starOutline: '#EE9A32',
  tintBorder: '#EE9A32',
  live: '#EE9A32',
  liveTint: '#3B2914',
  liveText: '#F5B45E',
  deal: '#F2C14E',
  onDeal: '#1F1A14',
  seatTaken: '#3A3229',
  scrim: 'rgba(0, 0, 0, 0.6)',
  photoBackdrop: '#0E0B08',
  photoChrome: '#2A231C',
  onPhotoBackdrop: '#F6EFE4',
  shimmer: '#2A231C',
  shadow: '#000000',
};

/**
 * استكان Istikan (joy J-D1; research report 5 §5 Direction A) — the customer app's look. Deeper paper
 * and a warm white so cards separate in the sun; tea (`accent`) only for the main action and food;
 * kashi (`live`, `info`) for what moves; ink (`selected`) for what you chose; saffron (`deal`, `star`)
 * for treats; palm for done; pomegranate for stop. The Partner and Merchant apps and the Console stay
 * on `light` until they adopt it.
 */
const istikan: ThemeColors = {
  bg: '#F6EEDF',
  surface: '#FFFCF6',
  surfaceRaised: '#FFFCF6',
  surfaceSunken: '#EEE3CF',
  text: '#24170E',
  textMuted: '#6A5745',
  accent: '#E08A1E',
  onAccent: '#24170E',
  accentTint: '#FBE6C6',
  accentText: '#8F4A00',
  border: '#E4D5BE',
  borderStrong: '#8A735C',
  accentBorder: '#C27214',
  focusRing: '#24170E',
  success: '#2F7D4E',
  successTint: '#DCEEDF',
  successText: '#23653E',
  // Caution stays mustard (J1f, S2-02): structural (the inverse banner), never a tint alone.
  warning: '#B07F00',
  warningTint: '#FAF0C8',
  warningText: '#7A5A00',
  danger: '#B23A2E',
  onDanger: '#FFFCF6',
  dangerTint: '#F7DCD6',
  dangerText: '#9A2E23',
  // Kashi absorbs info.
  info: '#0B6577',
  infoTint: '#D3EAF0',
  infoText: '#0B5A6B',
  inverse: '#24170E',
  onInverse: '#F6EEDF',
  onInverseMuted: '#D6C8B4',
  onInverseCaution: '#F2C14E',
  onInverseSuccess: '#7ACF9D',
  onInverseAccent: '#E08A1E',
  selected: '#24170E',
  onSelected: '#FFFCF6',
  selectedBorder: '#24170E',
  selectedSoft: '#24170E',
  onSelectedSoft: '#FFFCF6',
  selectedMark: '#FFFCF6',
  onSelectedMark: '#24170E',
  segmentSelected: '#24170E',
  segmentSelectedBorder: '#24170E',
  onSegmentSelected: '#FFFCF6',
  stepperPlus: '#FFFCF6',
  onStepperPlus: '#24170E',
  stepperPlusBorder: '#8A735C',
  star: '#F2C14E',
  starOutline: '#24170E',
  tintBorder: '#FBE6C6',
  live: '#0B6577',
  liveTint: '#D3EAF0',
  liveText: '#0B5A6B',
  deal: '#F2C14E',
  onDeal: '#24170E',
  seatTaken: '#E9DDC9',
  scrim: 'rgba(36, 23, 14, 0.45)',
  photoBackdrop: '#0E0B08',
  photoChrome: '#2A231C',
  onPhotoBackdrop: '#F6EFE4',
  shimmer: '#FAF4E9',
  shadow: '#5A3A12',
};

export const themes = { light, dark, istikan } as const;
export type ThemeName = keyof typeof themes;

/** Which way each theme leans: toasts, state layers and shadows read this, never the theme name. */
export const scheme: Record<ThemeName, 'light' | 'dark'> = { light: 'light', dark: 'dark', istikan: 'light' };

/** A monogram colour: `fill` behind the letter, `on` for the letter (AA, tested). */
export interface IdentityColor {
  fill: string;
  on: string;
}

/**
 * Colours for people's monograms and avatars (joy S2-03). In istikan they are non-semantic (date,
 * clay, olive, plum, kashi, pomegranate) so green never means "a person called خالد". Clay is
 * `#AD5E36`, a shade under the report's `#B8643A` (4.17:1), so a 14 px letter passes AA. `light`
 * and `dark` keep the four semantic tones in the old hash order, so the other apps' avatars don't move.
 */
export const identity: Record<ThemeName, readonly IdentityColor[]> = {
  light: [
    { fill: light.accentTint, on: light.accentText },
    { fill: light.infoTint, on: light.infoText },
    { fill: light.successTint, on: light.successText },
    { fill: light.warningTint, on: light.warningText },
  ],
  dark: [
    { fill: dark.accentTint, on: dark.accentText },
    { fill: dark.infoTint, on: dark.infoText },
    { fill: dark.successTint, on: dark.successText },
    { fill: dark.warningTint, on: dark.warningText },
  ],
  istikan: ['#7A4A2A', '#AD5E36', '#6B7B2E', '#5E4B8B', '#0B6577', '#B23A2E'].map((fill) => ({ fill, on: '#FFFCF6' })),
};

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
  { fg: 'onInverse', bg: 'inverse', use: 'inverse banner title (running late)' },
  { fg: 'onInverseMuted', bg: 'inverse', use: 'inverse banner note' },
  { fg: 'onInverseSuccess', bg: 'inverse', use: 'inverse banner: the credit came back' },
  { fg: 'onInverseAccent', bg: 'inverse', use: 'live-order card: restaurant · status' },
  { fg: 'onSelected', bg: 'selected', use: 'selected chip, radio, seat' },
  { fg: 'onSelectedSoft', bg: 'selectedSoft', use: 'selected person chip' },
  { fg: 'onSegmentSelected', bg: 'segmentSelected', use: 'chosen segment label' },
  { fg: 'onStepperPlus', bg: 'stepperPlus', use: 'the stepper "+" glyph' },
  { fg: 'liveText', bg: 'liveTint', use: 'taxi / tuktuk / الرجعة tile labels' },
  { fg: 'liveText', bg: 'bg', use: 'live and moving copy on the screen' },
  { fg: 'liveText', bg: 'surface', use: 'live and moving copy on a card' },
  { fg: 'onDeal', bg: 'deal', use: 'deal sticker' },
  { fg: 'onPhotoBackdrop', bg: 'photoBackdrop', use: 'full-screen photo viewer copy' },
  { fg: 'onPhotoBackdrop', bg: 'photoChrome', use: 'photo viewer title pill' },
];

/**
 * Every boundary, focus indicator and selected-state cue `@driver/ui` draws that people need to see
 * to use a control (WCAG 1.4.11): 3:1 against what sits next to it. Checked in `contrast.test.ts`
 * for both themes. Decorative borders (cards, dividers) are deliberately not listed.
 */
export const nonTextPairs: ReadonlyArray<{ fg: ThemeColorKey; bg: ThemeColorKey; use: string; only?: readonly ThemeName[] }> = [
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
  { fg: 'onInverseCaution', bg: 'inverse', use: 'clock icon and promise bar on the inverse banner' },
  { fg: 'onInverseSuccess', bg: 'inverse', use: 'check and bar on the inverse banner once credited' },
  { fg: 'selectedBorder', bg: 'surface', use: 'selected chip outline on a card' },
  { fg: 'selectedBorder', bg: 'bg', use: 'selected chip outline on the screen' },
  { fg: 'onSelected', bg: 'selected', use: 'check icon on a selected chip' },
  { fg: 'onSelectedMark', bg: 'selectedMark', use: 'check on a chosen person chip' },
  { fg: 'accent', bg: 'inverse', use: 'live dot and progress on the live-order card', only: ['light', 'istikan'] },
  { fg: 'onPhotoBackdrop', bg: 'photoChrome', use: 'close ✕ on the photo viewer' },
  { fg: 'onPhotoBackdrop', bg: 'photoBackdrop', use: 'close button ring on the photo viewer' },
  // Istikan-only cues: in light the same roles are today's accent fills (unchanged for the other apps).
  { fg: 'stepperPlusBorder', bg: 'surfaceSunken', use: 'the neutral "+" key on the stepper track', only: ['istikan'] },
  { fg: 'starOutline', bg: 'surface', use: 'rating star outline on a card', only: ['istikan'] },
  { fg: 'live', bg: 'bg', use: 'live dot, route on the screen', only: ['istikan'] },
  { fg: 'live', bg: 'surface', use: 'live dot, route on a card', only: ['istikan'] },
  { fg: 'segmentSelected', bg: 'surfaceSunken', use: 'segmented thumb on its track', only: ['istikan'] },
  { fg: 'selected', bg: 'surface', use: 'selected chip fill on a card', only: ['istikan'] },
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
  /**
   * Alexandria 700 (joy J-D2): headings ≥ 22 px and hero numerals (it has tabular digits). Plex comes
   * second so the Console and the Partner share card, which don't load Alexandria, render as before.
   */
  display: ['Alexandria', 'IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'Noto Sans Arabic', 'system-ui', 'sans-serif'],
  /** Marhey 700 (joy J-D2): the hand-lettered voice, brand lines of ≤ 6 words, never numbers. */
  voice: ['Marhey', 'Alexandria', 'IBM Plex Sans Arabic', 'Noto Kufi Arabic', 'system-ui', 'sans-serif'],
  mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
} as const;

/** Native font files for the brand faces (expo-font names from @expo-google-fonts/alexandria and /marhey). */
export const brandFace = {
  display: 'Alexandria_700Bold',
  voice: 'Marhey_700Bold',
} as const;
export type BrandFace = keyof typeof brandFace;

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
  /**
   * Brand lines in Marhey (`Text face="voice"`): section titles and the food tile. Line height is
   * 1.65×: Marhey's and Alexandria's short descents clip ي and ج under tight leading on iOS.
   */
  voice: { size: 24, lineHeight: 40, weight: 700 },
  voiceSm: { size: 20, lineHeight: 34, weight: 700 },
  /** The live-order arrival time in Alexandria (tabular). */
  numeralHero: { size: 30, lineHeight: 48, weight: 700 },
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
    /** Split-flap digit tick on departure times (customer audit d-2). */
    flap: 180,
    /** Map camera moves (route draws to the door). */
    camera: 600,
    /** The one ambient loop (steam while waiting). */
    ambient: 2000,
    /** Cap for a celebration burst. */
    celebrate: 900,
    /** Only the changed digits of an ETA roll. */
    digitRoll: 220,
  },
  /** "Pour & settle" (joy report 5 §6): things rise this far as they enter; a field error nudges this far. */
  distance: { enter: 12, nudge: 4 },
  /** Delay between list items entering (at most 3 items stagger). */
  stagger: 40,
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
    /** "Pour & settle": an entering panel or card settles with about 4 % overshoot. */
    settle: { damping: 14, stiffness: 170, mass: 0.9 },
    /** One celebration burst (courier marker pop, arrival). */
    celebrate: { damping: 10, stiffness: 180, mass: 0.8 },
    /** Dish art hopping into the cart bar. */
    hop: { damping: 16, stiffness: 220, mass: 0.7 },
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

export type HapticEventKind = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/**
 * Haptics are rare so they mean something (joy S2-18, report 5 §6): which buzz each event gets.
 * `success` is kept for the big moments, `heavy` only for SOS. `secondaryButton` is what a
 * secondary or ghost button fires: istikan none (primary and destructive only), the other themes keep
 * today's light tap so the Partner and Merchant apps feel the same.
 */
export const haptic = {
  events: {
    primaryPress: 'light',
    destructivePress: 'warning',
    select: 'selection',
    tabSwitch: 'selection',
    addToCart: 'light',
    cartLanded: 'selection',
    orderPlaced: 'success',
    kitchenAccepted: 'light',
    courierPickedUp: 'medium',
    runningLate: 'warning',
    almostThere: 'medium',
    arrival: 'success',
    ratingStar: 'selection',
    pointsEarned: 'success',
    seatBooked: 'success',
    topUpConfirmed: 'success',
    fieldError: 'error',
    errorToast: 'error',
    backOnline: 'light',
    sos: 'heavy',
  } satisfies Record<string, HapticEventKind>,
  secondaryButton: { light: 'light', dark: 'light', istikan: null } satisfies Record<ThemeName, HapticEventKind | null>,
} as const;

/**
 * Food drawing pigments (UI/UX audit S2-07, b3): fixed in both themes — a kebab must not turn pale
 * at night — and never UI roles (green herbs are not "success"). Decoration only: no text sits on
 * them. `plateTints` gives each dish look its own plate.
 */
export const art = {
  paper: '#F6EEDF',
  plate: '#FFF8EC',
  plateTints: ['#FFF8EC', '#F4E9D6', '#EFE3CF'],
  rim: '#E4D5BC',
  line: '#3A2414',
  meat: '#A0561C',
  char: '#5B2E12',
  chicken: '#D9A257',
  tomato: '#C8432F',
  herb: '#4E8A3A',
  onion: '#F1E3B8',
  bread: '#E9C77B',
  rice: '#F3E6C4',
  tea: '#B5521B',
  water: '#7FB7D9',
  laban: '#FBF7EE',
  can: '#C8432F',
  juice: '#E8962E',
  metal: '#9A8F80',
  steam: '#C9B79C',
  // Scene pigments of the Aziziyah sketchbook (joy J4): the Istikan hues as paint, plus the town.
  kashi: '#0B6577',
  kashiTint: '#9CC9D1',
  saffron: '#F2C14E',
  palm: '#2F7D4E',
  palmDeep: '#235E3B',
  pomegranate: '#B23A2E',
  door: '#2F6B4F',
  doorDeep: '#234F3B',
  sky: '#F6E3C0',
  river: '#86B7C0',
  night: '#2A1D14',
  nightSky: '#163A44',
  wall: '#EAD9BC',
  wallDeep: '#D9C29E',
  wood: '#8A5A33',
  woodLight: '#B07A48',
  lemon: '#F2D35E',
  cucumber: '#7BA05B',
  lentil: '#E2A23A',
  turnip: '#D46A8C',
  hummus: '#E9D3A1',
  fried: '#C9832F',
  white: '#FFFCF6',
} as const;
export type ArtPigments = typeof art;

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
  art,
  scheme,
  identity,
  brandFace,
  haptic,
} as const;
export type Tokens = typeof tokens;
