import { useColorScheme } from 'react-native';
import type { ThemeName } from '@driver/design-tokens';
import { NEW_HOME } from '@/lib/env';
import { pickTheme } from './logic';
import { useAppearance } from './pref';

/** The theme the whole app wears now: istikan until the new home is on, then sage or emerald night. */
export function useAppThemeName(): ThemeName {
  const { choice } = useAppearance();
  const phone = useColorScheme();
  return pickTheme({ newHome: NEW_HOME, choice, phone: phone === 'dark' || phone === 'light' ? phone : null });
}
