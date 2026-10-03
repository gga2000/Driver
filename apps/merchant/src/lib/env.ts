/**
 * Development affordances (the OTP dev-code strip). On in `expo start` (`__DEV__`) and in web
 * exports built with `EXPO_PUBLIC_DEV_TOOLS=1` for screenshots; the API refuses `devLastOtp` in
 * production anyway.
 */
export const DEV_TOOLS: boolean = (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_DEV_TOOLS === '1';

/**
 * Merchant support line ("اتصل بدرايفر"). TODO(ops): the real number before launch; set it with
 * EXPO_PUBLIC_SUPPORT_PHONE at build time.
 */
export const SUPPORT_PHONE: string = process.env.EXPO_PUBLIC_SUPPORT_PHONE || '+9647800000000';
