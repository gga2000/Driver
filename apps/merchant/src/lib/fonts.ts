import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFonts } from 'expo-font';
import { Platform } from 'react-native';
import { FONT_FILES } from './font-files';

/**
 * Loads IBM Plex Sans Arabic (one family per weight file on native, matching `fontFace` in
 * @driver/design-tokens) and Alexandria (`brandFace.display`). Screens render immediately with the
 * system face and switch once the files are in. Web: see fonts.web.ts.
 */
function useRuntimeFonts(): boolean {
  const [loaded] = useFonts(FONT_FILES);
  return loaded;
}

/**
 * Android builds carry the same files inside the app (the expo-font plugin in app.json), where the
 * family is the file name, so the faces are there at first paint and nothing waits on loading.
 * Expo Go can't carry them and iOS registers them under different names, so both load at runtime.
 */
const EMBEDDED =
  Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

export const useAppFonts: () => boolean = EMBEDDED ? () => true : useRuntimeFonts;
