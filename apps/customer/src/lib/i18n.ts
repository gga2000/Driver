import { useMemo } from 'react';
import { createT, type MessageKey } from '@driver/i18n';
import { useProfile, type AppLocale } from './profile';

export type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Strings for the current UI locale (Iraqi Arabic by default; English from حسابي → اللغة).
 * Screens call `const t = useT()` and never hard-code copy: add keys to both
 * packages/i18n/src/locales/ar-IQ.json and en.json (the i18n test enforces parity).
 */
export function useT(): TFn {
  const { locale } = useProfile();
  return useMemo(() => createT(locale), [locale]);
}

export function useLocale(): AppLocale {
  return useProfile().locale;
}
