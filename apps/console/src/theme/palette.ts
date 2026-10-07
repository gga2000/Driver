import { color, elevation, themes } from '@driver/design-tokens';

/**
 * The Console palette, generated from `@driver/design-tokens` (one source of truth; S-02 / K-10).
 *
 * Every colour the Console draws is a role below. Each role is either a token value (`themes.light`,
 * `themes.dark`, `color.*`) or a mix of two token values — never a hand-typed hex. The roles become
 * CSS variables (`--c-<role>`, as space-separated RGB channels so Tailwind's `/alpha` modifiers work)
 * in `themeCss()`, which the root layout inlines at build time; `tailwind.config.ts` exposes them as
 * `bg-surface`, `text-muted`, `border-line`…
 *
 * Both themes are checked for WCAG AA in `palette.test.ts`: text pairs ≥ 4.5:1, non-text (input
 * borders, focus ring, status marks) ≥ 3:1.
 */

/** `#RRGGBB` mix of `a` toward `b` by `t` (0–1). Used only to derive in-between steps from tokens. */
export function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a);
  const B = p(b);
  return `#${A.map((v, i) =>
    Math.round(v + (B[i]! - v) * t)
      .toString(16)
      .padStart(2, '0'),
  )
    .join('')
    .toUpperCase()}`;
}

export const CONSOLE_ROLES = [
  // Surfaces, from the back to the front.
  'canvas', // the page behind everything (cream paper)
  'sidebar', // the navigation rail, a shade deeper than the canvas
  'surface', // cards, panes, tables (white paper)
  'surface-2', // row hover, quiet wells, zebra
  'surface-3', // pressed, segmented tracks, skeletons
  'raised', // popovers, dialogs, the command palette
  // Rules.
  'line', // dividers and card edges (decorative)
  'line-strong', // input and control edges (≥ 3:1, WCAG 1.4.11)
  // Ink.
  'text',
  'muted',
  'faint',
  // The lamp: brand orange is a fill; rust is its text colour.
  'accent',
  'accent-hover',
  'on-accent',
  'accent-tint', // selected nav, selected pill
  'accent-wash', // selected row, focus well
  'accent-text',
  // Status: `X` is text-safe and mark-safe, `X-solid` a fill, `X-tint` a pill/banner background.
  'ok',
  'ok-solid',
  'ok-tint',
  'warn',
  'warn-solid',
  'warn-tint',
  'bad',
  'bad-solid',
  'on-bad',
  'bad-tint',
  'info',
  'info-solid',
  'info-tint',
  // Internal notes in the support thread (a pale amber sheet, like a sticky note).
  'note',
  'note-line',
  // Inverse chips: tooltips, toasts, the keyboard hint on dark.
  'inverse',
  'on-inverse',
  'focus',
  'shadow',
] as const;
export type ConsoleRole = (typeof CONSOLE_ROLES)[number];
export type ConsolePalette = Record<ConsoleRole, string>;

const L = themes.light;
const D = themes.dark;
const n = color.neutral;

export const lightPalette: ConsolePalette = {
  canvas: L.bg,
  sidebar: mix(n[50], n[100], 0.55),
  surface: L.surface,
  'surface-2': mix(L.surface, n[100], 0.45),
  'surface-3': n[100],
  raised: L.surfaceRaised,
  line: L.border,
  'line-strong': mix(n[400], n[600], 0.52),
  text: L.text,
  muted: L.textMuted,
  faint: mix(n[500], n[600], 0.8),
  accent: L.accent,
  'accent-hover': mix(color.primary[500], color.primary[600], 0.55),
  'on-accent': L.onAccent,
  'accent-tint': L.accentTint,
  'accent-wash': color.primary[50],
  'accent-text': L.accentText,
  ok: L.successText,
  'ok-solid': L.success,
  'ok-tint': L.successTint,
  warn: L.warningText,
  'warn-solid': L.warning,
  'warn-tint': L.warningTint,
  bad: L.dangerText,
  'bad-solid': L.danger,
  'on-bad': L.onDanger,
  'bad-tint': L.dangerTint,
  // CON-11: no blue in the Console. "Info" (on the way, notes, the customer's chat bubble) is date
  // brown, from the brand's own primary and neutral scales; the shared tokens are not touched.
  info: mix(color.primary[800], n[800], 0.4),
  'info-solid': color.primary[800],
  'info-tint': mix(n[100], color.primary[100], 0.5),
  note: color.warning[50],
  'note-line': mix(color.warning[100], color.warning[500], 0.35),
  inverse: L.text,
  'on-inverse': L.bg,
  focus: L.accentText,
  shadow: L.shadow,
};

/** Night shifts and the metrics wall: the warm near-black of `themes.dark`, lifted where AA needs it. */
export const darkPalette: ConsolePalette = {
  canvas: D.bg,
  sidebar: D.surfaceSunken,
  surface: D.surface,
  'surface-2': mix(D.surface, D.surfaceRaised, 0.5),
  'surface-3': D.surfaceRaised,
  raised: mix(D.surfaceRaised, D.border, 0.25),
  line: D.border,
  'line-strong': mix(D.borderStrong, D.textMuted, 0.3),
  text: D.text,
  muted: D.textMuted,
  faint: mix(D.textMuted, D.borderStrong, 0.3),
  accent: D.accent,
  'accent-hover': mix(D.accent, D.accentText, 0.4),
  'on-accent': D.onAccent,
  'accent-tint': D.accentTint,
  'accent-wash': mix(D.surface, D.accentTint, 0.55),
  'accent-text': D.accentText,
  ok: D.successText,
  'ok-solid': D.success,
  'ok-tint': D.successTint,
  warn: D.warningText,
  'warn-solid': D.warning,
  'warn-tint': D.warningTint,
  bad: D.dangerText,
  'bad-solid': D.danger,
  'on-bad': D.onDanger,
  'bad-tint': D.dangerTint,
  info: mix(color.primary[100], n[100], 0.5),
  'info-solid': mix(color.primary[600], n[500], 0.3),
  'info-tint': mix(D.surface, color.primary[900], 0.6),
  note: mix(D.surface, D.warningTint, 0.7),
  'note-line': mix(D.warningTint, D.warning, 0.4),
  inverse: D.text,
  'on-inverse': D.bg,
  focus: D.accentText,
  shadow: D.shadow,
};

/**
 * The date-brown island (CON-11 shell): the sidebar is the dark of a dried date in both themes, with
 * cream ink and the saffron lamp, so the working canvas stays the lightest thing on screen. It is a
 * whole palette, not a few extra roles, so every shared control inside it (icon buttons, count badges,
 * key hints, the support views) reads right without a sidebar-only variant. Set by `data-ink="date"`.
 */
const date = mix(color.primary[900], n[1000], 0.42);
export const datePalette: ConsolePalette = {
  ...darkPalette,
  canvas: date,
  sidebar: date,
  surface: date,
  'surface-2': mix(date, color.primary[700], 0.22),
  'surface-3': mix(date, color.primary[700], 0.34),
  raised: mix(date, color.primary[700], 0.34),
  line: mix(date, n[50], 0.12),
  'line-strong': mix(date, n[300], 0.55),
  text: n[50],
  muted: mix(color.primary[100], n[300], 0.35),
  faint: mix(color.primary[300], n[500], 0.45),
  'accent-tint': mix(date, color.primary[700], 0.5),
  'accent-wash': mix(date, color.primary[700], 0.3),
  'accent-text': color.primary[300],
  focus: color.primary[300],
};

export const palettes = { light: lightPalette, dark: darkPalette } as const;
export type ConsoleTheme = keyof typeof palettes;

/**
 * Every pair the Console draws, checked in `palette.test.ts`. `min` 4.5 for text, 3 for non-text
 * (control edges, focus ring, status dots and bars) and large numbers. Add a row before using a new pair.
 */
export const CONSOLE_PAIRS: ReadonlyArray<{
  fg: ConsoleRole;
  bg: ConsoleRole;
  min: 3 | 4.5;
  use: string;
}> = [
  ...(['canvas', 'sidebar', 'surface', 'surface-2', 'surface-3', 'raised'] as const).flatMap(
    (bg) => [
      { fg: 'text' as const, bg, min: 4.5 as const, use: 'body copy' },
      { fg: 'muted' as const, bg, min: 4.5 as const, use: 'secondary copy, table headers, meta' },
      { fg: 'faint' as const, bg, min: 4.5 as const, use: 'timestamps, hints' },
      { fg: 'accent-text' as const, bg, min: 4.5 as const, use: 'links, selected labels, totals' },
      { fg: 'line-strong' as const, bg, min: 3 as const, use: 'input and control edges' },
      { fg: 'focus' as const, bg, min: 3 as const, use: 'focus ring' },
    ],
  ),
  ...(['surface', 'surface-2', 'canvas'] as const).flatMap((bg) =>
    (['ok', 'warn', 'bad', 'info'] as const).map((fg) => ({
      fg,
      bg,
      min: 4.5 as const,
      use: 'status text and marks',
    })),
  ),
  ...(['ok', 'warn', 'bad', 'info'] as const).map((s) => ({
    fg: s,
    bg: `${s}-tint` as ConsoleRole,
    min: 4.5 as const,
    use: 'status pill',
  })),
  ...(['ok-solid', 'warn-solid', 'bad-solid', 'info-solid'] as const).map((fg) => ({
    fg,
    bg: 'surface' as const,
    min: 3 as const,
    use: 'status dots, bars, SLA fuse',
  })),
  { fg: 'on-accent', bg: 'accent', min: 4.5, use: 'primary button' },
  { fg: 'on-accent', bg: 'accent-hover', min: 4.5, use: 'primary button hover' },
  { fg: 'on-bad', bg: 'bad-solid', min: 4.5, use: 'destructive button' },
  { fg: 'text', bg: 'accent-tint', min: 4.5, use: 'selected nav item, selected pill' },
  { fg: 'accent-text', bg: 'accent-tint', min: 4.5, use: 'selected count badge' },
  { fg: 'muted', bg: 'accent-tint', min: 4.5, use: 'meta on a selected row' },
  { fg: 'text', bg: 'accent-wash', min: 4.5, use: 'selected queue row' },
  { fg: 'muted', bg: 'accent-wash', min: 4.5, use: 'selected queue row meta' },
  { fg: 'text', bg: 'note', min: 4.5, use: 'internal note body' },
  { fg: 'warn', bg: 'note', min: 4.5, use: 'internal note label' },
  { fg: 'muted', bg: 'note', min: 4.5, use: 'internal note meta' },
  { fg: 'text', bg: 'info-tint', min: 4.5, use: 'customer bubble' },
  { fg: 'muted', bg: 'info-tint', min: 4.5, use: 'customer bubble meta' },
  { fg: 'text', bg: 'warn-tint', min: 4.5, use: 'warning banner body' },
  { fg: 'text', bg: 'bad-tint', min: 4.5, use: 'error banner body' },
  { fg: 'text', bg: 'ok-tint', min: 4.5, use: 'success banner body' },
  { fg: 'on-inverse', bg: 'inverse', min: 4.5, use: 'tooltip, toast' },
];

/** What the date-brown sidebar draws; checked against `datePalette` in `palette.test.ts`. */
export const DATE_PAIRS: ReadonlyArray<{ fg: ConsoleRole; bg: ConsoleRole; min: 3 | 4.5; use: string }> = [
  ...(['sidebar', 'surface-2', 'accent-tint'] as const).flatMap((bg) => [
    { fg: 'text' as const, bg, min: 4.5 as const, use: 'nav item, selected nav item' },
    { fg: 'muted' as const, bg, min: 4.5 as const, use: 'nav item at rest, icons' },
  ]),
  { fg: 'faint', bg: 'sidebar', min: 4.5, use: 'group labels, key hints' },
  { fg: 'accent-text', bg: 'sidebar', min: 4.5, use: 'brand subtitle, counts on the support views' },
  { fg: 'accent-text', bg: 'accent-tint', min: 4.5, use: 'selected support view count' },
  { fg: 'muted', bg: 'surface-3', min: 4.5, use: 'count badge' },
  { fg: 'bad', bg: 'sidebar', min: 4.5, use: 'breached count' },
  { fg: 'on-bad', bg: 'bad-solid', min: 4.5, use: 'alert count badge' },
  { fg: 'accent', bg: 'sidebar', min: 3, use: 'brand tile, selected bar, count dot' },
  { fg: 'accent', bg: 'accent-tint', min: 3, use: 'selected bar beside the selected item' },
  { fg: 'focus', bg: 'sidebar', min: 3, use: 'focus ring' },
  { fg: 'on-accent', bg: 'accent', min: 4.5, use: 'brand mark ink' },
];

function channels(hex: string): string {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
}

function block(p: ConsolePalette): string {
  return CONSOLE_ROLES.map((r) => `--c-${r}:${channels(p[r])};`).join('');
}

/**
 * The CSS the root layout inlines: light on `:root` (and any `[data-theme=light]` island), dark on
 * `[data-theme=dark]` (the toggle sets it on <html>; the metrics wall sets it on its own panel).
 * Elevation shadows are the token CSS, retinted for dark.
 */
export function themeCss(): string {
  const shadows = (dark: boolean) =>
    [
      `--shadow-1:${dark ? '0 1px 2px rgb(0 0 0 / 0.5)' : elevation[1].css};`,
      `--shadow-2:${dark ? '0 6px 18px rgb(0 0 0 / 0.45)' : elevation[2].css};`,
      `--shadow-3:${dark ? '0 16px 40px rgb(0 0 0 / 0.55)' : elevation[3].css};`,
      `--scrim:${dark ? D.scrim : L.scrim};`,
    ].join('');
  return [
    `:root,[data-theme=light]{color-scheme:light;${block(lightPalette)}${shadows(false)}}`,
    `[data-theme=dark]{color-scheme:dark;${block(darkPalette)}${shadows(true)}}`,
    `[data-ink=date]{color-scheme:dark;${block(datePalette)}}`,
  ].join('\n');
}
