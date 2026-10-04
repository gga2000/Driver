/**
 * Arabic search folding, shared by the API (catalog search, `catalog.restaurants` query filter) and
 * the apps (ride "where to", the customer search screen's recents), so what people type in chat
 * matches what a menu spells:
 *
 *  - tashkeel and tatweel go ("مشكّل" = "مشكل");
 *  - alef forms fold (أ إ آ ٱ → ا), taa marbuta → ه, alef maqsura → ي, hamza seats (ؤ → و, ئ → ي);
 *  - Iraqi / Persian letters fold to their base (گ ک → ك, چ → ج, ڤ → ف, پ → ب, ی → ي);
 *  - Eastern Arabic and Persian digits become Western ("٣٠" = "30");
 *  - punctuation becomes a space, and a leading "ال" drops from every word longer than three
 *    letters ("الشاورما" = "شاورما", but "الف" stays).
 */
const EASTERN = /[٠-٩]/g;
const PERSIAN = /[۰-۹]/g;

/** Western digits 0–9 (voice guide §5): seed and typed text may carry "٣٠". */
export function westernDigits(s: string): string {
  return s.replace(EASTERN, (d) => String(d.charCodeAt(0) - 0x0660)).replace(PERSIAN, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function foldArabic(s: string): string {
  return westernDigits(s.normalize('NFKC'))
    .toLowerCase()
    .replace(/[ً-ْٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىی]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[گک]/g, 'ك')
    .replace(/چ/g, 'ج')
    .replace(/ڤ/g, 'ف')
    .replace(/پ/g, 'ب')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w))
    .join(' ');
}

/**
 * How well a folded query names a text: 3 exact, 2 every query word starts a word of the text,
 * 1 every query word is inside the text, 0 no match. Every word has to match (narrowing, like a
 * contacts search). Both sides are folded here; pass raw strings.
 */
export function searchScore(query: string, text: string): number {
  const q = foldArabic(query);
  const n = foldArabic(text);
  if (!q || !n) return 0;
  if (n === q) return 3;
  const words = q.split(' ');
  const textWords = n.split(' ');
  if (words.every((w) => textWords.some((tw) => tw.startsWith(w)))) return 2;
  if (words.every((w) => n.includes(w))) return 1;
  return 0;
}
