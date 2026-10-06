import { useEffect, useState } from 'react';
import { useFonts } from '@expo-google-fonts/ibm-plex-sans-arabic';
import { PLEX_FILES } from './font-files';

const WEIGHT: Record<string, number> = {
  IBMPlexSansArabic_400Regular: 400,
  IBMPlexSansArabic_500Medium: 500,
  IBMPlexSansArabic_600SemiBold: 600,
  IBMPlexSansArabic_700Bold: 700,
};

/**
 * On web @driver/ui styles text with the CSS family "IBM Plex Sans Arabic" plus `font-weight`
 * (not one family per weight like native). expo-font registers the bundled files under their
 * per-weight names, so once they load we alias them as weights of the CSS family (expo-font ≥ 14
 * quotes the family name and URL in its generated CSS; both forms are read). The files are
 * bundled assets: no network fetch to Google Fonts, works offline.
 */
export function useAppFonts(): boolean {
  const [loaded] = useFonts(PLEX_FILES);
  const [aliased, setAliased] = useState(false);
  useEffect(() => {
    if (!loaded || aliased || typeof document === 'undefined') return;
    const generated = document.getElementById('expo-generated-fonts')?.textContent ?? '';
    const rules: string[] = [];
    for (const m of generated.matchAll(/font-family:"?(\w+)"?;src:url\(([^)]+)\)/g)) {
      const weight = WEIGHT[m[1] ?? ''];
      if (weight) rules.push(`@font-face{font-family:"IBM Plex Sans Arabic";font-weight:${weight};font-display:swap;src:url(${m[2]})}`);
    }
    if (rules.length) {
      const el = document.createElement('style');
      el.id = 'driver-plex-alias';
      el.textContent = rules.join('\n');
      document.head.appendChild(el);
    }
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const ready = fonts ? Promise.all([400, 500, 600, 700].map((w) => fonts.load(`${w} 16px "IBM Plex Sans Arabic"`, 'ع'))) : Promise.resolve();
    void ready.catch(() => undefined).then(() => setAliased(true));
  }, [loaded, aliased]);
  return loaded && aliased;
}
