import { NOTIFY_TEMPLATES, type NotifyTemplateDef, type NotifyTemplateId } from '@driver/contracts';
import { formatClock, locales, t, type Locale, type MessageKey } from '@driver/i18n';
import { BAGHDAD_OFFSET_MIN } from '../../shared/local-time.js';

export type Params = Record<string, string>;

export interface Rendered {
  title: string | null;
  body: string | null;
  deepLink: string | null;
  /** WhatsApp template call: Meta name, language and the ordered body params. */
  whatsapp: { template: string; language: 'ar' | 'en'; params: string[]; text: string } | null;
  /** The SMS twin's text. */
  sms: string;
}

/** `{{1}}`-style WhatsApp text filled with ordered params. */
export function fillNumbered(text: string, params: readonly string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}

function fillNamed(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? params[k]! : `{${k}}`));
}

function waText(key: MessageKey, locale: Locale): string {
  return (locales[locale] as Record<string, string>)[key] ?? (locales['ar-IQ'] as Record<string, string>)[key] ?? key;
}

const SMS_MAX = 300;

/**
 * Renders one template for one person: push title / body (`push.*` keys with `{name}` params, or the
 * caller's own text for chat), the WhatsApp call (`wa.*` with `{{n}}` params in the template's
 * declared order) and the SMS (the template's own `sms.*` words when it has them, else the WhatsApp
 * text when there is one, else "title — body").
 */
export function render(templateId: NotifyTemplateId, params: Params, locale: Locale, content?: { title: string; body: string } | null): Rendered {
  const def: NotifyTemplateDef = NOTIFY_TEMPLATES[templateId];
  const title = content?.title ?? (def.push ? t(def.push.title, params, locale) : null);
  const body = content?.body ?? (def.push ? t(def.push.body, params, locale) : null);
  const deepLink = def.push ? fillNamed(def.push.deepLink, params) : null;
  let whatsapp: Rendered['whatsapp'] = null;
  if (def.whatsapp) {
    const ordered = def.whatsapp.params.map((p) => params[p] ?? '');
    whatsapp = { template: def.whatsapp.name, language: locale === 'en' ? 'en' : 'ar', params: ordered, text: fillNumbered(waText(def.whatsapp.key, locale), ordered) };
  }
  const brand = locale === 'en' ? 'Driver' : 'درايفر';
  const smsKey = def.sms ? (params['code'] && def.sms.withCode ? def.sms.withCode : def.sms.key) : null;
  const smsCore = smsKey ? t(smsKey, params, locale) : (whatsapp?.text ?? [title, body].filter(Boolean).join(' — '));
  const sms = `${brand}: ${smsCore}`.slice(0, SMS_MAX);
  return { title, body, deepLink, whatsapp, sms };
}

// ───────────────────────── formatting (voice spec §5) ─────────────────────────

/** `12,500`: Western digits, comma thousands. */
export function iqd(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function local(at: Date): Date {
  return new Date(at.getTime() + BAGHDAD_OFFSET_MIN * 60_000);
}

/** `2026-10-04`, Baghdad local. */
export function localDate(at: Date): string {
  return local(at).toISOString().slice(0, 10);
}

/** `7:30 م`: the city's one clock with the part of day (`formatClock` in packages/i18n). */
export function localTime(at: Date): string {
  return formatClock(at);
}
