import { useFonts } from 'expo-font';
import { FONT_FILES } from './font-files';

/**
 * Loads IBM Plex Sans Arabic (one family per weight file on native, matching `fontFace` in
 * @driver/design-tokens) and the brand faces Alexandria and Marhey (`brandFace`). The root layout
 * keeps the splash up until they are in (with a cap), so the first screen never swaps faces.
 * Web: see fonts.web.ts.
 */
export function useAppFonts(): boolean {
  const [loaded] = useFonts(FONT_FILES);
  return loaded;
}
