import arIQ from './locales/ar-IQ.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };

export const locales = { 'ar-IQ': arIQ, en } as const;
export type Locale = keyof typeof locales;
export type MessageKey = keyof typeof arIQ;

export const DEFAULT_LOCALE: Locale = 'ar-IQ';
export const RTL_LOCALES: ReadonlySet<string> = new Set(['ar-IQ', 'ar']);

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.has(locale) || locale.startsWith('ar-');
}

type Params = Record<string, string | number>;

/**
 * Interpolates `{name}` placeholders. Unknown keys fall back to Arabic, then to the key itself,
 * so a missing translation never crashes a screen.
 */
export function t(key: MessageKey, params?: Params, locale: Locale = DEFAULT_LOCALE): string {
  const table: Record<string, string> = locales[locale];
  const template = table[key] ?? (locales['ar-IQ'] as Record<string, string>)[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}

/** Bind a locale once per app session. */
export function createT(locale: Locale) {
  return (key: MessageKey, params?: Params) => t(key, params, locale);
}
