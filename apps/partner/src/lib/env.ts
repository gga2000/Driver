/**
 * Development affordances (the OTP dev-code strip). On in `expo start` (`__DEV__`) and in web
 * exports built with `EXPO_PUBLIC_DEV_TOOLS=1` for screenshots; the API refuses `devLastOtp` in
 * production anyway.
 */
export const DEV_TOOLS: boolean = (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_DEV_TOOLS === '1';

/**
 * The Console, where staff answer safety alerts (the staff-alert screen opens it): `EXPO_PUBLIC_CONSOLE_URL`
 * at build time. No default on purpose: until it is set the screen shows no link (an address we don't own
 * must never sit in a safety link) and says to open the Console on a computer.
 */
export const CONSOLE_URL: string | null = process.env.EXPO_PUBLIC_CONSOLE_URL?.trim() || null;
