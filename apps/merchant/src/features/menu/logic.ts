/**
 * Menu admin logic (pure, unit-tested): search over Arabic names, item status, prices typed by staff,
 * modifier-group rules, section order and the photo-import correction table. No React Native here.
 */

export interface MenuModifierLike {
  nameAr: string;
  priceIqd: number;
  available: boolean;
  /** «يشبّع» for this option (joy o3); null/absent = not said. */
  servesMin?: number | null;
  servesMax?: number | null;
}

export interface MenuGroupLike {
  nameAr: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  modifiers: readonly MenuModifierLike[];
}

export interface MenuItemLike {
  id: string;
  nameAr: string;
  nameEn: string | null;
  description: string | null;
  priceIqd: number;
  categoryAr: string | null;
  sortOrder: number;
  available: boolean;
  soldOutUntil: Date | null;
  onSale: boolean;
  modifierGroups: readonly MenuGroupLike[];
}

export interface MenuCategoryLike<I extends MenuItemLike = MenuItemLike> {
  nameAr: string | null;
  items: readonly I[];
}

// ───────────────────────── search ─────────────────────────

const ARABIC_DIGITS = /[٠-٩]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;
/** Harakat, tatweel and Quranic marks: nobody types them in a search box. */
function isMark(code: number): boolean {
  return (code >= 0x064b && code <= 0x065f) || code === 0x0670 || code === 0x0640 || (code >= 0x06d6 && code <= 0x06ed);
}
function stripMarks(s: string): string {
  return [...s].filter((ch) => !isMark(ch.charCodeAt(0))).join('');
}

/** Western digits for anything a phone keyboard may type (٣٠٠٠ → 3000). */
export function westernDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660)).replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Folds the spellings people mix up (أ/إ/آ → ا, ة → ه, ى → ي, گ → ك, چ → ج) for matching only. */
export function foldArabic(s: string): string {
  return stripMarks(westernDigits(s))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/گ/g, 'ك')
    .replace(/چ/g, 'ج')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function itemMatches(item: Pick<MenuItemLike, 'nameAr' | 'nameEn' | 'description'>, query: string): boolean {
  const q = foldArabic(query);
  if (!q) return true;
  return [item.nameAr, item.nameEn ?? '', item.description ?? ''].some((s) => foldArabic(s).includes(q));
}

/** Sections with the items that match; with a query, empty sections drop out. */
export function filterMenu<I extends MenuItemLike>(categories: readonly MenuCategoryLike<I>[], query: string): MenuCategoryLike<I>[] {
  if (!foldArabic(query)) return categories.map((c) => ({ nameAr: c.nameAr, items: [...c.items] }));
  return categories.map((c) => ({ nameAr: c.nameAr, items: c.items.filter((i) => itemMatches(i, query)) })).filter((c) => c.items.length > 0);
}

// ───────────────────────── status ─────────────────────────

/** on = customers can order it; sold_out_today = back by itself at midnight; off = the toggle is off. */
export type ItemStatus = 'on' | 'sold_out_today' | 'off';

export function itemStatus(item: Pick<MenuItemLike, 'available' | 'soldOutUntil' | 'onSale'>, now: number): ItemStatus {
  if (!item.available) return 'off';
  if (item.soldOutUntil && item.soldOutUntil.getTime() > now) return 'sold_out_today';
  return item.onSale ? 'on' : 'off';
}

export interface SectionCounts {
  total: number;
  on: number;
  soldOutToday: number;
  off: number;
}

export function sectionCounts(items: readonly Pick<MenuItemLike, 'available' | 'soldOutUntil' | 'onSale'>[], now: number): SectionCounts {
  const out: SectionCounts = { total: items.length, on: 0, soldOutToday: 0, off: 0 };
  for (const i of items) {
    const s = itemStatus(i, now);
    if (s === 'on') out.on += 1;
    else if (s === 'sold_out_today') out.soldOutToday += 1;
    else out.off += 1;
  }
  return out;
}

/** The optimistic copy of an item after a toggle (the server answers with the same shape). */
export function withAvailability<I extends MenuItemLike>(item: I, available: boolean): I {
  return { ...item, available, soldOutUntil: available ? null : item.soldOutUntil, onSale: available };
}

/** Optimistic "خلص اليوم": off sale until the next Baghdad midnight. */
export function withSoldOutToday<I extends MenuItemLike>(item: I, now: number): I {
  return { ...item, soldOutUntil: new Date(nextBaghdadMidnight(now)), onSale: false };
}

const BAGHDAD_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** The next 00:00 in Baghdad (UTC+3, no DST) after `now`. */
export function nextBaghdadMidnight(now: number): number {
  const local = now + BAGHDAD_OFFSET_MS;
  return Math.floor(local / DAY_MS) * DAY_MS + DAY_MS - BAGHDAD_OFFSET_MS;
}

/** Replaces one item in the menu (by id), keeping everything else. */
export function patchMenuItem<M extends { categories: readonly MenuCategoryLike[] }>(menu: M, itemId: string, patch: (item: MenuItemLike) => MenuItemLike): M {
  return { ...menu, categories: menu.categories.map((c) => ({ ...c, items: c.items.map((i) => (i.id === itemId ? patch(i) : i)) })) };
}

// ───────────────────────── prices ─────────────────────────

export const PRICE_MAX_IQD = 10_000_000;
/** Customer prices are shown rounded to the city step. */
export const PRICE_STEP_IQD = 250;

/** What staff typed ("3,500", "٣٥٠٠", "3500 دينار") → whole IQD, or null when it isn't a price. */
export function parsePrice(text: string): number | null {
  const digits = westernDigits(text).replace(/[,،٬\s]/g, '').replace(/دينار|iqd/gi, '');
  if (!/^\d{1,8}$/.test(digits)) return null;
  const n = Number(digits);
  return n > 0 && n <= PRICE_MAX_IQD ? n : null;
}

/** True when the price isn't on the 250 step (the customer sees it rounded). */
export function offStep(priceIqd: number): boolean {
  return priceIqd % PRICE_STEP_IQD !== 0;
}

/** Modifier price deltas may be 0 ("بدون زيادة"). */
export function parseDelta(text: string): number | null {
  const t = westernDigits(text).trim();
  if (t === '' || t === '0') return 0;
  const n = parsePrice(t);
  return n !== null && n <= 1_000_000 ? n : null;
}

/** Signed change between two prices for the history sheet. */
export function priceChange(oldPriceIqd: number, newPriceIqd: number): { delta: number; direction: 'up' | 'down' | 'first' | 'same' } {
  if (oldPriceIqd === 0) return { delta: newPriceIqd, direction: 'first' };
  const delta = newPriceIqd - oldPriceIqd;
  return { delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same' };
}

// ───────────────────────── modifiers ─────────────────────────

export interface DraftModifier {
  key: string;
  nameAr: string;
  price: string;
  available: boolean;
  /** «يشبّع» as typed: "2", "2-3", "2–3" (Arabic digits fine); empty = not said. */
  serves?: string;
}

/** Most people a single option can say it feeds. */
const SERVES_MAX = 50;

/**
 * «يشبّع» as staff type it (joy o3): "" → not said (null); "3" → 3–3; "2-3" / "2–3" / "٢-٣" → 2–3;
 * anything else, zero, a range read high to low or above 50 → "invalid" (the field shows it).
 */
export function parseServes(text: string | undefined): { min: number; max: number } | null | 'invalid' {
  const t = westernDigits(text ?? '').trim();
  if (t === '') return null;
  const m = /^(\d{1,2})\s*(?:[-–—]\s*(\d{1,2}))?$/.exec(t);
  if (!m) return 'invalid';
  const min = Number(m[1]);
  const max = m[2] !== undefined ? Number(m[2]) : min;
  if (min < 1 || max < min || max > SERVES_MAX) return 'invalid';
  return { min, max };
}

/** The draft field for a saved option: "2–3", "2", or "". */
export function servesText(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null) return '';
  return max == null || max === min ? String(min) : `${min}–${max}`;
}

export interface DraftGroup {
  key: string;
  nameAr: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  modifiers: DraftModifier[];
}

export type GroupProblem = 'name' | 'no_options' | 'option_name' | 'option_price' | 'option_serves' | 'min_over_max' | 'max_over_options' | 'required_min';

/** What is wrong with a group as staff typed it (empty = fine). */
export function groupProblems(g: DraftGroup): GroupProblem[] {
  const out: GroupProblem[] = [];
  if (!g.nameAr.trim()) out.push('name');
  if (g.modifiers.length === 0) out.push('no_options');
  if (g.modifiers.some((m) => !m.nameAr.trim())) out.push('option_name');
  if (g.modifiers.some((m) => parseDelta(m.price) === null)) out.push('option_price');
  if (g.modifiers.some((m) => parseServes(m.serves) === 'invalid')) out.push('option_serves');
  if (g.minSelect > g.maxSelect) out.push('min_over_max');
  if (g.modifiers.length > 0 && g.maxSelect > g.modifiers.length) out.push('max_over_options');
  if (g.required && g.minSelect < 1) out.push('required_min');
  return out;
}

/** Required ⇔ at least one pick: flipping one keeps the other consistent. */
export function setRequired(g: DraftGroup, required: boolean): DraftGroup {
  const minSelect = required ? Math.max(1, g.minSelect) : 0;
  return { ...g, required, minSelect, maxSelect: Math.max(g.maxSelect, minSelect) };
}

export function setMinMax(g: DraftGroup, minSelect: number, maxSelect: number): DraftGroup {
  const max = Math.max(1, Math.min(20, maxSelect));
  const min = Math.max(0, Math.min(max, minSelect));
  return { ...g, minSelect: min, maxSelect: max, required: min >= 1 };
}

let keySeq = 0;
export function draftKey(prefix = 'k'): string {
  keySeq += 1;
  return `${prefix}${keySeq}`;
}

export function toDraftGroups(groups: readonly MenuGroupLike[]): DraftGroup[] {
  return groups.map((g) => ({
    key: draftKey('g'),
    nameAr: g.nameAr,
    required: g.required,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    modifiers: g.modifiers.map((m) => ({ key: draftKey('m'), nameAr: m.nameAr, price: m.priceIqd ? String(m.priceIqd) : '0', available: m.available, ...(m.servesMin != null ? { serves: servesText(m.servesMin, m.servesMax) } : {}) })),
  }));
}

export function fromDraftGroups(groups: readonly DraftGroup[]): Array<{ nameAr: string; minSelect: number; maxSelect: number; required: boolean; modifiers: Array<{ nameAr: string; priceIqd: number; available: boolean; servesMin?: number | null; servesMax?: number | null }> }> {
  return groups.map((g) => ({
    nameAr: g.nameAr.trim(),
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    required: g.required,
    modifiers: g.modifiers.map((m) => {
      const serves = parseServes(m.serves);
      return { nameAr: m.nameAr.trim(), priceIqd: parseDelta(m.price) ?? 0, available: m.available, ...(serves && serves !== 'invalid' ? { servesMin: serves.min, servesMax: serves.max } : {}) };
    }),
  }));
}

/** "اختيار واحد إجباري" / "لحد 3 اختيارات" summary inputs. */
export function groupRule(g: Pick<MenuGroupLike, 'minSelect' | 'maxSelect' | 'required'>): { kind: 'exactly' | 'range' | 'up_to'; min: number; max: number } {
  if (g.required && g.minSelect === g.maxSelect) return { kind: 'exactly', min: g.minSelect, max: g.maxSelect };
  if (g.minSelect >= 1) return { kind: 'range', min: g.minSelect, max: g.maxSelect };
  return { kind: 'up_to', min: 0, max: g.maxSelect };
}

// ───────────────────────── sections ─────────────────────────

/** Moves one entry up (−1) or down (+1); out-of-range moves return the same order. */
export function moveInOrder<T>(order: readonly T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (index < 0 || index >= order.length || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/**
 * Sort order for an item added to (or moved into) a section, so it lands at the end of that section
 * without pulling the section up the customer menu (sections are ordered by their first item).
 */
export function sortOrderForNew(categories: readonly MenuCategoryLike[], categoryAr: string | null): number {
  const all = categories.flatMap((c) => c.items);
  const section = categories.find((c) => c.nameAr === categoryAr);
  if (section && section.items.length > 0) return Math.min(10_000, Math.max(...section.items.map((i) => i.sortOrder)) + 1);
  const top = all.length > 0 ? Math.max(...all.map((i) => i.sortOrder)) : -1;
  return Math.min(10_000, Math.floor(top / 100) * 100 + 100);
}

export function categoryNames(categories: readonly MenuCategoryLike[]): string[] {
  return categories.map((c) => c.nameAr).filter((n): n is string => n !== null);
}

// ───────────────────────── photo import ─────────────────────────

export interface ImportRow {
  key: string;
  nameAr: string;
  price: string;
  categoryAr: string;
  sourceUploadId: string | null;
}

export type RowProblem = 'name' | 'price';

export function emptyRow(categoryAr = '', sourceUploadId: string | null = null): ImportRow {
  return { key: draftKey('r'), nameAr: '', price: '', categoryAr, sourceUploadId };
}

/** A row nobody touched (no name, no price) is skipped, not an error. */
export function isBlankRow(r: ImportRow): boolean {
  return !r.nameAr.trim() && !r.price.trim();
}

export function rowProblems(r: ImportRow): RowProblem[] {
  if (isBlankRow(r)) return [];
  const out: RowProblem[] = [];
  if (!r.nameAr.trim()) out.push('name');
  if (parsePrice(r.price) === null) out.push('price');
  return out;
}

export interface ImportCheck {
  ready: Array<{ nameAr: string; priceIqd: number; categoryAr: string | null; sourceUploadId: string | null }>;
  problems: number;
  blank: number;
}

/** Rows ready to apply (trimmed, priced), how many still need fixing, and how many are blank. */
export function checkImport(rows: readonly ImportRow[]): ImportCheck {
  const out: ImportCheck = { ready: [], problems: 0, blank: 0 };
  for (const r of rows) {
    if (isBlankRow(r)) {
      out.blank += 1;
      continue;
    }
    if (rowProblems(r).length > 0) {
      out.problems += 1;
      continue;
    }
    out.ready.push({ nameAr: r.nameAr.trim(), priceIqd: parsePrice(r.price)!, categoryAr: r.categoryAr.trim() || null, sourceUploadId: r.sourceUploadId });
  }
  return out;
}

// ───────────────────────── glass display ─────────────────────────

/** Narrowest a tray may get: the name, the price and «خلص اليوم · يرجع باچر» still fit. */
export const TRAY_MIN_WIDTH = { phone: 150, tablet: 172 } as const;

/** Trays a row for a shelf this wide: two at least (a phone), as many as fit, six at most. */
export function trayColumns(width: number, gap: number, wide: boolean): number {
  if (width <= 0) return wide ? 4 : 2;
  const min = wide ? TRAY_MIN_WIDTH.tablet : TRAY_MIN_WIDTH.phone;
  return Math.max(2, Math.min(6, Math.floor((width + gap) / (min + gap))));
}
