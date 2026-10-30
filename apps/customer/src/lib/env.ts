/**
 * Development affordances (the OTP dev-code strip). On in `expo start` (`__DEV__`) and in web
 * exports built with `EXPO_PUBLIC_DEV_TOOLS=1` for screenshots; the API refuses `devLastOtp` in
 * production anyway.
 */
export const DEV_TOOLS: boolean = (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_DEV_TOOLS === '1';

/**
 * The support desk's WhatsApp line (help section, audit C-13), E.164. Set the real number with
 * EXPO_PUBLIC_SUPPORT_WHATSAPP at build time; the default is a placeholder.
 */
export const SUPPORT_WHATSAPP: string = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP || '+9647800000000';

/**
 * The Golden hour map's files (docs/deploy/map.md): our Aziziyah tiles and the Arabic map letters.
 * Both set → the web map draws the Golden hour look; either missing → the original street map.
 */
export const MAP_TILES_URL: string | undefined = process.env.EXPO_PUBLIC_MAP_TILES_URL || undefined;
export const MAP_GLYPHS_URL: string | undefined = process.env.EXPO_PUBLIC_MAP_GLYPHS_URL || undefined;
