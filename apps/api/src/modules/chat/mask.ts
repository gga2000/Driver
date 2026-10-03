/**
 * Server-side masking of Iraqi mobile numbers typed into chat (customer app §4 "masked call"; the
 * platform never lets the parties swap numbers through the app). Catches the ways people write them:
 * `07701234567`, `0770 123 4567`, `0770-123-4567`, `+964 770 123 4567`, `00964…`, `964…`, a bare
 * `7701234567`, and the same in Arabic-Indic (٠٧٧٠…) or Persian digits, with spaces, dots or dashes
 * between digits. A longer digit run (an order number, an amount) is left alone.
 */

const DIGIT = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
const SEP = '[\\s.\\-\\u00A0]{0,2}';
const ZERO = '[0\\u0660\\u06F0]';
const SEVEN = '[7\\u0667\\u06F7]';
const COUNTRY = `[9\\u0669\\u06F9]${SEP}[6\\u0666\\u06F6]${SEP}[4\\u0664\\u06F4]`;
const PREFIX = `(?:(?:\\+|${ZERO}${ZERO})${SEP}${COUNTRY}${SEP}|${COUNTRY}${SEP}|${ZERO}${SEP})?`;

/** A whole Iraqi mobile number, not glued to more digits on either side. */
export const IRAQI_MOBILE_RE = new RegExp(`(?<!${DIGIT})${PREFIX}${SEVEN}(?:${SEP}${DIGIT}){9}(?!${DIGIT})`, 'gu');

/** What a masked number reads as in the stored message. */
export const MASKED_PHONE = '[رقم مخفي]';

export function maskIraqiPhones(text: string): { text: string; masked: boolean } {
  let masked = false;
  const out = text.replace(IRAQI_MOBILE_RE, () => {
    masked = true;
    return MASKED_PHONE;
  });
  return { text: out, masked };
}
