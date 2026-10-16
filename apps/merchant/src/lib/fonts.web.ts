import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { FONT_FILES, WEB_FONT_FACES } from './font-files';

/**
 * On web @driver/ui styles text with CSS families ("IBM Plex Sans Arabic" plus `font-weight`, and
 * "Alexandria" for the display face), not one family per weight like native. expo-font registers the
 * bundled files under their per-weight names, so once they load we alias each one as a weight of its
 * CSS family (expo-font ≥ 14 quotes the family name and URL in its generated CSS; both forms are
 * read). The files are bundled assets: no network fetch to Google Fonts, works offline.
 */
export function useAppFonts(): boolean {
  const [loaded] = useFonts(FONT_FILES);
  const [aliased, setAliased] = useState(false);
  useEffect(() => {
    if (!loaded || aliased || typeof document === 'undefined') return;
    const generated = document.getElementById('expo-generated-fonts')?.textContent ?? '';
    const rules: string[] = [];
    for (const m of generated.matchAll(/font-family:"?(\w+)"?;src:url\(([^)]+)\)/g)) {
      const face = WEB_FONT_FACES[(m[1] ?? '') as keyof typeof WEB_FONT_FACES] as (typeof WEB_FONT_FACES)[keyof typeof WEB_FONT_FACES] | undefined;
      if (face) rules.push(`@font-face{font-family:"${face.family}";font-weight:${face.weight};font-display:swap;src:url(${m[2]})}`);
    }
    if (rules.length) {
      const el = document.createElement('style');
      el.id = 'driver-font-alias';
      el.textContent = rules.join('\n');
      document.head.appendChild(el);
    }
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const ready = fonts ? Promise.all(Object.values(WEB_FONT_FACES).map((f) => fonts.load(`${f.weight} 16px "${f.family}"`, 'ع'))) : Promise.resolve();
    void ready.catch(() => undefined).then(() => setAliased(true));
  }, [loaded, aliased]);
  return loaded && aliased;
}
