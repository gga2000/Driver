import { createHmac } from 'node:crypto';
import { DriverError } from '@driver/contracts';

/** Normalises Iraqi mobiles to E.164 (+9647xxxxxxxxx). Accepts 07xx…, 7xx…, 9647xx…, +9647xx…, with spaces/dashes and Arabic-Indic digits. */
export function normalizeIraqiPhone(raw: string): string {
  const western = raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const digits = western.replace(/[^\d]/g, '');
  let national: string;
  if (digits.startsWith('00964')) national = digits.slice(5);
  else if (digits.startsWith('964')) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;
  if (!/^7\d{9}$/.test(national)) throw new DriverError('phone_invalid');
  return `+964${national}`;
}

/** `+96477*****12` — enough for a person to recognise their own number, useless to anyone else. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 6)}*****${e164.slice(-2)}`;
}

/**
 * Peppered HMAC-SHA256 of the E.164 number. The pepper is a server secret (PHONE_HASH_PEPPER), so a
 * leaked `people`/`participants` table cannot be joined to a phone list by brute force.
 */
export function hashPhone(e164: string, pepper: string): string {
  return createHmac('sha256', pepper).update(e164).digest('hex');
}
