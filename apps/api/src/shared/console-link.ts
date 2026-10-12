import { t } from '@driver/i18n';
import { baseUrlFromEnv } from './public-url.js';

/**
 * The Console address staff alerts (SOS, on-call, خطوط sweep, Console watch) link to. Staff alert
 * links only ever point at the company's own Console: `CONSOLE_BASE_URL`, with deliberately no default
 * address. Unset → null, and the messages carry no link (the alert number and "open the Console on a
 * computer" instead). Production refuses to boot without it (`config/boot-check.ts`).
 */
export function consoleBaseFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  return baseUrlFromEnv('CONSOLE_BASE_URL', env);
}

/**
 * The `link` words of a staff alert: the Console page (`base` + `path`) when the address is set;
 * otherwise no link, only the alert number when there is one (`ref`) and "open the Console on a
 * computer". A WhatsApp template parameter is never empty, so the words take the link's place.
 */
export function consoleLinkParam(base: string | null, path: string, ref?: string): string {
  if (base) return `${base.replace(/\/+$/, '')}${path}`;
  return ref ? t('notify.staff_alert.ref_no_link', { id: ref }) : t('notify.staff_alert.no_link');
}
