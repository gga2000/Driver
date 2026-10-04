import { parseOrderTicket } from '@driver/contracts';

/**
 * Command palette search (S-K3): one box for "#1284", "1284", a driver's or restaurant's name, a
 * page ("الدعم", "كاش") or an action ("الوضع الليلي"). Pure so it is testable; the palette feeds it
 * pages, actions, restaurants and named drivers, and asks the API for orders when the query is an
 * order number.
 */

const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g; // harakat, superscript alef, Quranic marks, tatweel
const EASTERN = /[٠-٩۰-۹]/g;

/** Folds the spellings people type interchangeably: أ/إ/آ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي, گ → ك… */
export function normalize(s: string): string {
  return s
    .replace(EASTERN, (d) => String((d.charCodeAt(0) - (d >= '۰' ? 0x06f0 : 0x0660)) % 10))
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[گک]/g, 'ك')
    .replace(/[ڤ]/g, 'ف')
    .replace(/[پ]/g, 'ب')
    .replace(/[چ]/g, 'ج')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 0 = no match. Whole-label start beats a word start beats a substring; shorter labels win ties. */
export function matchScore(query: string, label: string, keywords: readonly string[] = []): number {
  const q = normalize(query);
  if (!q) return 1;
  let best = 0;
  for (const raw of [label, ...keywords]) {
    const l = normalize(raw);
    if (!l) continue;
    let s = 0;
    if (l === q) s = 100;
    else if (l.startsWith(q)) s = 80;
    else if (l.split(' ').some((w) => w.startsWith(q))) s = 60;
    else if (l.includes(q)) s = 40;
    else if (q.includes(' ') && q.split(' ').every((part) => l.includes(part))) s = 30;
    if (s > 0) s += Math.max(0, 10 - Math.floor(l.length / 4));
    best = Math.max(best, raw === label ? s : s - 5);
  }
  return best;
}

export type CommandGroup = 'orders' | 'pages' | 'drivers' | 'merchants' | 'actions';
export const GROUP_ORDER: readonly CommandGroup[] = [
  'orders',
  'pages',
  'drivers',
  'merchants',
  'actions',
];

export interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  hint?: string;
  /** Icon name (the palette maps it to a glyph). */
  icon?: string;
  keywords?: readonly string[];
  /** Navigate here… */
  href?: string;
  /** …or run this. */
  run?: () => void;
}

export interface QueryIntent {
  /** "#1284" / "1284" / "١٢٨٤": the order ticket number to look up. */
  ticket: string | null;
  /** Free text for names and pages. */
  text: string;
}

export function intentOf(query: string): QueryIntent {
  return { ticket: parseOrderTicket(query), text: query.trim() };
}

/**
 * Ranks `items` for `query` and groups them in palette order (orders first: a number typed is almost
 * always an order). Each group keeps its best `perGroup`; an empty query shows pages and actions only.
 */
export function rankCommands(
  query: string,
  items: readonly CommandItem[],
  perGroup = 6,
): Array<{ group: CommandGroup; items: CommandItem[] }> {
  const empty = query.trim() === '';
  const scored = items
    .filter((i) => !empty || i.group === 'pages' || i.group === 'actions')
    .map((i) => ({ i, s: i.group === 'orders' ? 200 : matchScore(query, i.label, i.keywords) }))
    .filter((x) => x.s > 0);
  return GROUP_ORDER.map((group) => ({
    group,
    items: scored
      .filter((x) => x.i.group === group)
      .sort((a, b) => b.s - a.s)
      .slice(0, perGroup)
      .map((x) => x.i),
  })).filter((g) => g.items.length > 0);
}

/** Flattened order for arrow-key navigation across groups. */
export function flatten(groups: ReadonlyArray<{ items: CommandItem[] }>): CommandItem[] {
  return groups.flatMap((g) => g.items);
}
