import { customerThemes, homeLook, type CustomerThemeName, type HomeLook } from '@driver/design-tokens';
import { tp } from '@driver/i18n';
import { useTheme } from '../theme/ThemeProvider';

/** The new home's colours for the theme in use: sage or emerald night (other themes borrow by scheme). */
export function useHomeLook(): HomeLook {
  const theme = useTheme();
  const name = (customerThemes as readonly string[]).includes(theme.name) ? (theme.name as CustomerThemeName) : theme.scheme === 'dark' ? 'emeraldNight' : 'sage';
  return homeLook[name];
}

/** The word beside a big counted number («5» + «دقايق», «22» + «مطعم فاتح»), from the i18n plural families. */
export function countWord(n: number, base: 'home.unit.minute' | 'home.unit.open' | 'home.unit.offer'): string {
  return tp(base, n);
}
