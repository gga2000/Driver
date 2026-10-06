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

/** How each bundled file is exposed to CSS on web: the family @driver/ui names, and the weight. */
export const WEB_FONT_FACES: Readonly<Record<keyof typeof FONT_FILES, { family: string; weight: number }>> = {
  IBMPlexSansArabic_400Regular: { family: 'IBM Plex Sans Arabic', weight: 400 },
  IBMPlexSansArabic_500Medium: { family: 'IBM Plex Sans Arabic', weight: 500 },
  IBMPlexSansArabic_600SemiBold: { family: 'IBM Plex Sans Arabic', weight: 600 },
  IBMPlexSansArabic_700Bold: { family: 'IBM Plex Sans Arabic', weight: 700 },
  Alexandria_700Bold: { family: 'Alexandria', weight: 700 },
  Marhey_700Bold: { family: 'Marhey', weight: 700 },
};
