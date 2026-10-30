import { normalizeIraqiPhone, toWesternDigits } from '@/lib/phone';

/**
 * Day-one d08: say why the number can't be right, under the field, as soon as it is clear — not only a
 * pale button. The field always holds the local form (`formatPhoneInput`: 07XX XXX XXXX), so a number
 * is wrong once its first two digits aren't «07», or once all 11 digits are in and it still isn't a
 * mobile; after leaving the field, any unfinished number. Copy only: the sign-in rules don't change.
 */
export function phoneReason(value: string, touched: boolean): 'rule' | null {
  const digits = toWesternDigits(value).replace(/\D/g, '');
  if (digits.length === 0 || normalizeIraqiPhone(value)) return null;
  if (digits.length >= 2 && !digits.startsWith('07')) return 'rule';
  if (digits.length >= 11) return 'rule';
  return touched ? 'rule' : null;
}
