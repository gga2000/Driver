import { t } from '@driver/i18n';

/**
 * The Console address staff alerts (SOS, on-call, خطوط sweep, Console watch) link to. Staff alert
 * links only ever point at the company's own Console: `CONSOLE_BASE_URL`, with deliberately no default
 * address. Unset → null, and the messages carry no link (the alert number and "open the Console on a
 * computer" instead). Production refuses to boot without it (`config/boot-check.ts`).
 */
export function consoleBaseFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env['CONSOLE_BASE_URL']?.trim();
  return raw ? raw.replace(/\/+$/, '') : null;
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

const PRIVATE_HOST = [
  /^localhost$/,
  /\.localhost$/,
  /\.(internal|local|flycast)$/,
  /^0\.0\.0\.0$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/,
  /^\[(::1?|f[cd][0-9a-f]*:.*|fe[89ab][0-9a-f]*:.*)\]$/,
];

/**
 * What is wrong with a deployed `CONSOLE_BASE_URL` (null: nothing). It must be a public https address:
 * not this computer, not a private network. The value is never echoed (boot errors reach the logs).
 */
export function consoleBaseProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'CONSOLE_BASE_URL is not a web address';
  }
  if (url.protocol !== 'https:') return 'CONSOLE_BASE_URL must start with https://';
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.some((re) => re.test(host))) return 'CONSOLE_BASE_URL points at a computer or a private network, not the public Console';
  if (url.username || url.password || url.search || url.hash) return 'CONSOLE_BASE_URL must be the plain Console address (no sign-in, ? or #)';
  return null;
}
