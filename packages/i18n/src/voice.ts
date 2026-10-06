/**
 * The glossary as a test (audit S-09, system-a11y-copy.md §4; voice spec §4 and §7). Every Arabic
 * string the apps or the API show goes through `voiceProblems`, so a banned word fails CI in the
 * shared table, the merchant table and the API's error table alike.
 */

export interface BannedTerm {
  /** What to write instead (shown in the failure). */
  use: string;
  pattern: RegExp;
  /** Keys allowed to keep the word (fixed phrases, legal copy). */
  allow?: (key: string) => boolean;
}

// Arabic letters are not \w, so "word boundaries" are spelled out: start, space or punctuation.
const B = '(?:^|[\\s،؛:.(«"\\-/])';
const E = '(?=$|[\\s،؛:.؟)»"\\-/!])';
const word = (w: string, prefixes = '(?:ال|بال|لل|وال|و|ب|ل)?') => new RegExp(`${B}${prefixes}${w}${E}`);

export const BANNED_TERMS: Readonly<Record<string, BannedTerm>> = {
  /** Food, parcel and errand courier. */
  'مندوب': { use: 'الدليفري', pattern: /مندوب/ },
  'موصّل': { use: 'الدليفري', pattern: word('موص[ّ]?ل(?:ين)?') },
  'كابتن': { use: 'السايق', pattern: /كابتن/ },
  'سائق': { use: 'السايق', pattern: /سائق/ },
  /** The dispatcher is الديسباتشر (approved loanword). */
  'الموزّع': { use: 'الديسباتشر', pattern: word('موز[ّ]?ع') },
  'درايفر ماركت': { use: 'درايفر للمطاعم', pattern: /درايفر ماركت/ },
  'هسه': { use: 'هسة', pattern: word('هسه', '') },
  'الآن': { use: 'هسة', pattern: /الآن/ },
  'يرجى': { use: 'a direct verb', pattern: /يرجى/ },
  'سوف': { use: 'راح / دـ', pattern: word('سوف', '') },
  'لقد': { use: '—', pattern: word('لقد', '') },
  'لا يوجد': { use: 'ماكو', pattern: /لا يوجد/ },
  'عزيزي': { use: 'هلا {name}', pattern: word('عزيزي', '') },
  'العميل': { use: 'الزبون', pattern: word('عميل|عملاء') },
  'د.ع': { use: 'دينار', pattern: /د\.ع/ },
  'قيد': { use: 'دا + verb', pattern: word('قيد', '') },
  'جاري': { use: 'دا + verb', pattern: word('جاري', '') },
  'مغلق': { use: 'مسكّر', pattern: word('مغلق(?:ة)?') },
  'نقد': { use: 'كاش', pattern: word('نقد(?:ي|اً|ا|ية)?') },
  'أوردر': { use: 'طلب', pattern: /أوردر/ },
  'أموال': { use: 'فلوس', pattern: /أموال/ },
  'حدّث الصفحة': { use: 'the app refetches by itself', pattern: /حد[ّ]?ث الصفحة/ },
  'المدخلات': { use: 'say which field', pattern: /المدخلات/ },
  'الإجراء': { use: 'هذا', pattern: /الإجراء/ },
  /** IBM Plex Sans Arabic has no ✓ glyph: use the check icon. */
  '✓': { use: 'the check icon', pattern: /✓/ },
  /** "د" also starts "دينار": minutes are written out (`time.minutes_short` is the one exception). */
  'د (minutes)': {
    use: '{n} دقيقة',
    pattern: /\{\w*(?:min|minutes|mins)\w*\} د(?=$|[\s،.)·])/,
    // Short clock pieces, and Ali's one-tap accept chip "اقبل · 15 د" (decision 2026-10-04) with its
    // siblings on the same tight row.
    allow: (k) => ['time.minutes_short', 'time.hm_short', 'merchant.accept.minutes', 'merchant.accept.one_tap', 'merchant.busy.chip_on'].includes(k),
  },
  /**
   * Minute agreement is automatic (joy J-D9, `agreeMinutes` in `t()`): a template writes the 11+ form
   * "{minutes} دقيقة" and reads «5 دقايق» for 5 but «15 دقيقة» for 15. A hard-coded "{x} دقايق" would
   * read «15 دقايق».
   */
  '{x} دقايق': { use: '{x} دقيقة (t() picks دقيقة / دقيقتين / دقايق)', pattern: /\{\w+\}\s+دقايق/,
    // A `_few` key is picked for 3–10 only (plural keys, `agoText`), so its «دقايق» is always right.
    allow: (k) => k.endsWith('_few'),
  },
};

/** Exclamation marks: only "طلب جديد!" for merchants and "مبروك" for tier-ups (voice spec §2.8). */
export const EXCLAMATION_ALLOWED: ReadonlySet<string> = new Set([
  'push.merchant_new_order.title',
  'merchant.board.alert_new',
  'partner.tier_up',
]);

/**
 * In-town taxi/tuktuk rides are a مشوار; رحلة belongs to الرجعة. These key families are taxi-only
 * (`safety.*` serves الرجعة too, so it is not checked).
 */
const TAXI_FAMILIES = /^(?:trip|ride)\./;

export interface VoiceProblem {
  key: string;
  value: string;
  problem: string;
}

/**
 * Glossary and voice problems in an Arabic table: banned words, Eastern digits, emojis, stray
 * exclamation marks, رحلة on a taxi ride. Empty array = clean.
 */
export function voiceProblems(table: Record<string, string>): VoiceProblem[] {
  const out: VoiceProblem[] = [];
  for (const [key, value] of Object.entries(table)) {
    // WhatsApp templates and legal copy follow their own registration rules.
    if (key.startsWith('legal.')) continue;
    for (const [term, rule] of Object.entries(BANNED_TERMS)) {
      if (rule.pattern.test(value) && !rule.allow?.(key)) out.push({ key, value, problem: `«${term}» → ${rule.use}` });
    }
    if (/[٠-٩]/.test(value)) out.push({ key, value, problem: 'Eastern digits → 0–9' });
    // Arrows (↔ in "الزبون ↔ الدليفري") are text symbols, not emoji.
    if (/(?![\u2190-\u21FF])\p{Extended_Pictographic}/u.test(value)) out.push({ key, value, problem: 'emoji' });
    if (value.includes('!') && !EXCLAMATION_ALLOWED.has(key)) out.push({ key, value, problem: 'exclamation mark' });
    if (TAXI_FAMILIES.test(key) && /رحل[ةت]/.test(value)) out.push({ key, value, problem: '«رحلة» on a taxi ride → مشوار' });
  }
  return out;
}
