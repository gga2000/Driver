import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { createT, type MessageKey } from '@driver/i18n';
import { englishReady, englishVersion, loadEnglish, onEnglish } from './english';
import { useProfile, type AppLocale } from './profile';

export type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Strings for the current UI locale (Iraqi Arabic by default; English from حسابي → اللغة).
 * Screens call `const t = useT()` and never hard-code copy: add keys to both
 * packages/i18n/src/locales/ar-IQ.json and en.json (the i18n test enforces parity).
 */
export function useT(): TFn {
  const { locale } = useProfile();
  const words = useSyncExternalStore(onEnglish, englishVersion, englishVersion);
  useEffect(() => {
    if (locale === 'en') void loadEnglish();
  }, [locale]);
  // `words` is on purpose: a new t once English arrives, so memoised screens draw again in English.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createT(locale), [locale, words]);
}

/**
 * Whether English can show yet: always on a phone; on the website, once its words are in (or failed
 * to come, then Arabic shows). The root waits on it so an English reader never sees Arabic first.
 */
export function useEnglishWords(locale: AppLocale): boolean {
  useSyncExternalStore(onEnglish, englishVersion, englishVersion);
  useEffect(() => {
    if (locale === 'en') void loadEnglish();
  }, [locale]);
  return locale !== 'en' || englishReady();
}

export function useLocale(): AppLocale {
  return useProfile().locale;
}
