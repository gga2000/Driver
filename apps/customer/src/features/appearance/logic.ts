import type { ThemeName } from '@driver/design-tokens';

/**
 * Light or dark for the customer app (home redesign step 2, docs/specs/2026-11-01-home-redesign.md
 * §2: "follows the phone's setting; a switch in حسابي (تلقائي / فاتح / غامق) overrides it").
 */
export type Appearance = 'auto' | 'light' | 'dark';

export const APPEARANCES: readonly Appearance[] = ['auto', 'light', 'dark'];

/** Stored values we don't know (an older or broken write) read as `auto`. */
export function parseAppearance(v: string | null | undefined): Appearance {
  return v === 'light' || v === 'dark' ? v : 'auto';
}

/**
 * The theme the app wears. Until the new home is switched on (`EXPO_PUBLIC_NEW_HOME`), the app keeps
 * today's istikan look whatever the setting says, so customers see no change. With it on: `light` →
 * sage, `dark` → emerald night, `auto` → whatever the phone says (light when it says nothing).
 */
export function pickTheme(input: { newHome: boolean; choice: Appearance; phone: 'light' | 'dark' | null | undefined }): ThemeName {
  if (!input.newHome) return 'istikan';
  const dark = input.choice === 'dark' || (input.choice === 'auto' && input.phone === 'dark');
  return dark ? 'emeraldNight' : 'sage';
}
