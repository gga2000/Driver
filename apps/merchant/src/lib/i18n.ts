import { useMemo } from 'react';
import { translate, type Locale, type Params, type TKey } from './i18n-core';
import { usePrefs } from './prefs';

export type { TKey } from './i18n-core';
export type TFn = (key: TKey, params?: Params) => string;

/**
 * Strings for the current UI locale. Screens call `const t = useT()` and never hard-code copy: add
 * app strings to apps/merchant/locales/ar.json and en.json (parity and voice checks are tested).
 */
export function useT(): TFn {
  const { locale } = usePrefs();
  return useMemo(() => (key: TKey, params?: Params) => translate(key, params, locale), [locale]);
}

export function useLocale(): Locale {
  return usePrefs().locale;
}
