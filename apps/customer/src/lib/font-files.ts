import { Alexandria_700Bold } from '@expo-google-fonts/alexandria/700Bold';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { Marhey_700Bold } from '@expo-google-fonts/marhey/700Bold';

/**
 * IBM Plex Sans Arabic, one bundled file per weight (names match `fontFace` in @driver/design-tokens),
 * plus the Istikan brand faces (joy J-D2, names match `brandFace`): Alexandria 700 for headings and
 * hero numerals, Marhey 700 for short brand lines. Imported by weight so only these files are bundled.
 */
export const FONT_FILES = {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  Alexandria_700Bold,
  Marhey_700Bold,
};
