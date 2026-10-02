# @driver/design-tokens

Single source of truth for Driver's visual language. `src/tokens.ts` is authoritative;
`tokens.json` is emitted from it on `pnpm build` for Tailwind, native themes and design tools.

## RTL is the default

Every Driver screen is Arabic-first and laid out right-to-left. Tokens are direction-agnostic
on purpose: use logical properties (`margin-inline-start`, `padding-inline-end`,
`border-start-start-radius`) rather than `left`/`right`, and in React Native rely on
`I18nManager.isRTL` plus `start`/`end` style keys. Never mirror icons that carry meaning
(clocks, play buttons); do mirror directional ones (arrows, chevrons, back).

Font stacks list Arabic faces first. Latin digits are used for amounts (IQD) by convention
in Iraq; do not convert to Arabic-Indic digits.
