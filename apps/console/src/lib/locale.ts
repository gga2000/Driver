import { DEFAULT_LOCALE, isRtl, type Locale } from '@driver/i18n';

/**
 * The Console's language, in one place (CON-19). Today it is always Iraqi Arabic; the English mode
 * after launch (K9) changes only this, and `lang` / `dir`, joiners, units and the clock follow,
 * because none of them are written into the screens any more.
 */
export const CONSOLE_LOCALE: Locale = DEFAULT_LOCALE;

export function consoleLang(locale: Locale = CONSOLE_LOCALE): string {
  return locale;
}

export function consoleDir(locale: Locale = CONSOLE_LOCALE): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}
