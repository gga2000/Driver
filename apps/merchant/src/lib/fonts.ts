import { useFonts } from '@expo-google-fonts/ibm-plex-sans-arabic';
import { PLEX_FILES } from './font-files';

/**
 * Loads IBM Plex Sans Arabic (one family per weight file on native, matching `fontFace` in
 * @driver/design-tokens). Screens render immediately with the system face and switch once the
 * files are in. Web: see fonts.web.ts.
 */
export function useAppFonts(): boolean {
  const [loaded] = useFonts(PLEX_FILES);
  return loaded;
}
