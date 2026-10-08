import { useEffect, useState } from 'react';

/**
 * Web fonts (speed w3, Ali 2026-10-08): public/index.html declares the faces @driver/ui names in CSS
 * ("IBM Plex Sans Arabic" by `font-weight`, "Alexandria" and "Marhey" for the brand faces) from small
 * woff2 files with only Arabic and Latin letters (scripts/fonts/subset-web-fonts.py), and starts the
 * two main weights downloading with the page itself, before the program. Medium (500) is drawn with
 * the 600 file. Here we only wait for those two main weights; the root layout stops waiting after
 * FONT_HOLD_MAX_MS and the rest swap in when they arrive (font-display: swap). No Google Fonts call.
 */
export const MAIN_WEB_FACES = ['400 16px "IBM Plex Sans Arabic"', '600 16px "IBM Plex Sans Arabic"'] as const;

export function useAppFonts(): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const fonts = typeof document === 'undefined' ? undefined : (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) {
      setLoaded(true);
      return;
    }
    let live = true;
    void Promise.all(MAIN_WEB_FACES.map((f) => fonts.load(f, 'ع')))
      .catch(() => undefined)
      .then(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return loaded;
}
