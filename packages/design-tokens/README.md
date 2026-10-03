# @driver/design-tokens

Single source of truth for Driver's visual language. `src/tokens.ts` is authoritative;
`tokens.json` is emitted from it on `pnpm build` for Tailwind, native themes and design tools.

## RTL is the default

Every Driver screen is Arabic-first and laid out right-to-left. Tokens are direction-agnostic
on purpose: use logical properties (`margin-inline-start`, `padding-inline-end`,
`border-start-start-radius`) rather than `left`/`right`, and in React Native rely on
`I18nManager.isRTL` plus `start`/`end` style keys. Never mirror icons that carry meaning
(clocks, play buttons); do mirror directional ones (arrows, chevrons, back).

## Palette and themes

`themes.light` (launch default) is the brand palette from `docs/specs/2026-10-03-brand.md`: cream
`#FBF6EE` ground, white surfaces, ink `#1F1A14`, deep orange accent `#E08A1E`. `themes.dark` is a
complete stub on the same role names (warm near-black `#16120E`) so it can be switched on in QA.

Components read roles (`bg`, `surface`, `text`, `accent`, `onAccent`, `accentTint`, `accentText`,
`successText`, …), never raw scales. Two rules came out of the contrast check:

- Text on the orange is ink (`onAccent = #1F1A14`, 6.4:1). White on `#E08A1E` is 2.7:1 and fails
  even the large-text threshold, so it is never used.
- Status hues (`success`, `warning`, `danger`, `info`) are fills and icons; text in those hues uses
  the darker `*Text` roles on the `*Tint` washes (all ≥ 4.9:1).

Every text/background pair a component draws is listed in `contrastPairs`; `src/contrast.test.ts`
fails if any pair in either theme drops below WCAG AA (4.5:1, or 3:1 for pairs marked `large`).

## Fonts

Font stacks list Arabic faces first. Latin digits are used for amounts (IQD) by convention
in Iraq; do not convert to Arabic-Indic digits.
