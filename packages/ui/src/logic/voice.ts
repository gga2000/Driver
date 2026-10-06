/**
 * The voice face (Marhey, joy J-D2) is hand lettering for brand lines of a few words: welcome, arrival,
 * home section titles. It has no tabular digits, so a price, a time or a count never goes in it.
 */
export const VOICE_MAX_WORDS = 6;

/** Western, Arabic-Indic and Extended (Persian) digits. */
const DIGIT = /[0-9٠-٩۰-۹]/;

/** True when `text` may be set in the voice face: 1–6 words and no digit anywhere. */
export function voiceAllowed(text: string): boolean {
  if (DIGIT.test(text)) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= VOICE_MAX_WORDS;
}

/** The plain text of React children (strings and numbers, or arrays of them); null when it holds elements. */
export function textOf(children: unknown): string | null {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    const parts = children.map(textOf);
    return parts.every((p): p is string => p !== null) ? parts.join('') : null;
  }
  return null;
}
