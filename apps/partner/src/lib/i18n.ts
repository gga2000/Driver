import { useMemo } from 'react';
import { createT, type MessageKey } from '@driver/i18n';

export type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;
export type AppLocale = 'ar-IQ' | 'en';

/**
 * Strings for the Partner app: Iraqi Arabic (`partner.*` and shared keys in packages/i18n). Add
 * keys to both packages/i18n/src/locales/ar-IQ.json and en.json (the i18n test enforces parity),
 * then `pnpm --filter @driver/i18n build`. A language switch (wave 2) only changes `useLocale`.
 */
export function useLocale(): AppLocale {
  return 'ar-IQ';
}

export function useT(): TFn {
  const locale = useLocale();
  return useMemo(() => createT(locale), [locale]);
}
