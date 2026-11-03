import { customerThemes, homeLook, type CustomerThemeName, type HomeLook } from '@driver/design-tokens';
import { t, type MessageKey } from '@driver/i18n';
import { useTheme } from '../theme/ThemeProvider';

/** The new home's colours for the theme in use: sage or emerald night (other themes borrow by scheme). */
export function useHomeLook(): HomeLook {
  const theme = useTheme();
  const name = (customerThemes as readonly string[]).includes(theme.name) ? (theme.name as CustomerThemeName) : theme.scheme === 'dark' ? 'emeraldNight' : 'sage';
  return homeLook[name];
}

/** Arabic counts 3–10 take the plural noun («5 دقايق», «4 مطاعم فاتحة»); 1, 2 and 11+ the singular. */
export function countWord(n: number, one: MessageKey, plural: MessageKey): string {
  const r = Math.abs(Math.trunc(n)) % 100;
  return t(r >= 3 && r <= 10 ? plural : one);
}
