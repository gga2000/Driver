import { t, type MessageKey } from '@driver/i18n';

/**
 * Arabic counts the way people say them: "ولا طلب", "طلب واحد", "طلبين", "5 طلبات", "12 طلب".
 * A count family is five keys sharing a stem: `<stem>_0`, `_1`, `_2`, `_few` (3–10) and `_many`
 * (11 and up, and the fallback); `{n}` is the number. English fills the same keys.
 */
export type CountForm = '0' | '1' | '2' | 'few' | 'many';

export function countForm(n: number): CountForm {
  const k = Math.abs(Math.trunc(n));
  if (k === 0) return '0';
  if (k === 1) return '1';
  if (k === 2) return '2';
  const tail = k % 100;
  return tail >= 3 && tail <= 10 ? 'few' : 'many';
}

export function countText(stem: string, n: number): string {
  return t(`${stem}_${countForm(n)}` as MessageKey, { n });
}
