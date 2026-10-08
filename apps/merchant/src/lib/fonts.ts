import { useFonts } from 'expo-font';
import { FONT_FILES } from './font-files';

/**
 * Loads IBM Plex Sans Arabic (one family per weight file on native, matching `fontFace` in
 * @driver/design-tokens) and Alexandria (`brandFace.display`). Screens render immediately with the
 * system face and switch once the files are in. Web: see fonts.web.ts.
 */
export function useAppFonts(): boolean {
  const [loaded] = useFonts(FONT_FILES);
  return loaded;
}
