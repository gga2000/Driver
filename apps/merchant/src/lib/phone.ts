/**
 * Iraqi mobile numbers on the client: the same rules as the API's `normalizeIraqiPhone`
 * (apps/api/src/modules/identity/phone.ts) so we reject a bad number before sending an OTP.
 *
 * Accepted: `07XX XXX XXXX`, `7XX…`, `9647…`, `+9647…`, `009647…`, with spaces/dashes/brackets
 * and Arabic-Indic (٠–٩) or Persian (۰–۹) digits — people paste numbers from WhatsApp.
 */

export const IRAQ_CALLING_CODE = '+964';

/** Arabic-Indic and Persian digits → 0–9 (voice spec §5: Western digits everywhere). */
export function toWesternDigits(raw: string): string {
  return raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/** The 10-digit national significant number (`7XXXXXXXXX`), or null if it can't be one. */
function nationalPart(raw: string): string {
  const digits = toWesternDigits(raw).replace(/\D/g, '');
  if (digits.startsWith('00964')) return digits.slice(5);
  if (digits.startsWith('964')) return digits.slice(3);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** `0770 123 4567` → `+9647701234567`; null when it isn't an Iraqi mobile. */
export function normalizeIraqiPhone(raw: string): string | null {
  const national = nationalPart(raw);
  return /^7\d{9}$/.test(national) ? `${IRAQ_CALLING_CODE}${national}` : null;
}

export function isValidIraqiPhone(raw: string): boolean {
  return normalizeIraqiPhone(raw) !== null;
}

/**
 * Formats what the person is typing as `07XX XXX XXXX` (local form, how Iraqis write numbers).
 * Keeps at most 11 digits; a pasted `+964…` is converted to the local form.
 */
export function formatPhoneInput(raw: string): string {
  const western = toWesternDigits(raw).replace(/\D/g, '');
  let local = western;
  if (western.startsWith('00964')) local = `0${western.slice(5)}`;
  else if (western.startsWith('964')) local = `0${western.slice(3)}`;
  else if (western.startsWith('7')) local = `0${western}`;
  local = local.slice(0, 11);
  const parts = [local.slice(0, 4), local.slice(4, 7), local.slice(7, 11)].filter(Boolean);
  return parts.join(' ');
}

/** `+9647701234567` → `0770 123 4567` for display. */
export function displayPhone(e164: string): string {
  return formatPhoneInput(e164);
}

const NBSP = ' ';
const DOT = '•';

/**
 * d16 · a staff phone the same way everywhere: «0780 ••• 4455» — the local head, three dots, the last
 * four — from whatever the API sends: an invite's hint («0780 ••• 4455»), the masked member form
 * («+96477*****67»), or a whole number. The groups are joined by no-break spaces so the number never
 * breaks across lines. A digit the API hid stays a dot: the member form keeps only «077» and the last
 * two, so a member reads «077• ••• ••67» (same shape, nothing invented). Null when it isn't a phone.
 */
export function maskedPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = toWesternDigits(raw).replace(/[\s\u00A0⁦-⁩-]/g, '').replace(/[*•xX·]/g, '?');
  let rest = s;
  if (rest.startsWith('+964')) rest = rest.slice(4);
  else if (rest.startsWith('00964')) rest = rest.slice(5);
  else if (rest.startsWith('964')) rest = rest.slice(3);
  else if (rest.startsWith('0')) rest = rest.slice(1);
  if (!/^[\d?]+$/.test(rest) || !/^7/.test(rest)) return null;
  // Head digits, the hidden run, tail digits; the national number is always 10 long.
  const m = /^(\d*)(\?*)(\d*)$/.exec(rest);
  if (!m) return null;
  const [, head = '', , tail = ''] = m;
  if (head.length + tail.length > 10) return null;
  const local = `0${head}${'?'.repeat(10 - head.length - tail.length)}${tail}`.replace(/\?/g, DOT);
  return [local.slice(0, 4), DOT.repeat(3), local.slice(7, 11)].join(NBSP);
}
