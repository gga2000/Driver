import { t as sharedT, type MessageKey } from '@driver/i18n';
import ar from '../../locales/ar.json';
import en from '../../locales/en.json';

/**
 * Merchant copy: the app's own `merchant.*` strings live in apps/merchant/locales/{ar,en}.json (so
 * this app's screens never collide with another app's edits to the shared file); shared keys
 * (`onboarding.*`, `action.*`, `merchant.accept`…) still come from @driver/i18n. Plain Node, tested.
 */

export type LocalKey = keyof typeof ar;
export type TKey = LocalKey | MessageKey;
export type Locale = 'ar-IQ' | 'en';
export type Params = Record<string, string | number>;

export const LOCAL: Record<Locale, Record<string, string>> = { 'ar-IQ': ar, en };

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

/** Local table first (falls back to Arabic), then the shared one; unknown keys render as themselves. */
export function translate(key: TKey, params: Params | undefined, locale: Locale): string {
  const local = LOCAL[locale][key] ?? LOCAL['ar-IQ'][key];
  if (local !== undefined) return interpolate(local, params);
  return sharedT(key as MessageKey, params, locale);
}

export function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}
