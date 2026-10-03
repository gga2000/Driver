import type { ThemeColorKey } from '@driver/design-tokens';
import type { Theme } from './ThemeProvider';

/** A theme role name, or any raw colour string. */
export type ColorValue = ThemeColorKey | (string & {});

export function resolveColor(theme: Theme, c: ColorValue): string {
  return (theme.colors as unknown as Record<string, string>)[c] ?? c;
}

/** `#RRGGBB` + alpha → `rgba()`, for state layers and soft rings. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}
