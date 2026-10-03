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
