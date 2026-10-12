import type { PostPricesInput, StallPriceRow } from '@driver/contracts';

/**
 * «أسعار اليوم» (shopping, 2026-10-11): what the stall owner decided for each item this morning.
 * `same` keeps yesterday's price, `new` carries the typed price; a row already posted today counts as
 * ready until he changes it. A photo taken this morning travels as its upload id. Pure, no React.
 */
export type PriceChoice = { kind: 'untouched' } | { kind: 'same' } | { kind: 'new'; text: string };

export interface RowDraft {
  choice: PriceChoice;
  /** Upload id of today's photo, once it is up. */
  photoUploadId?: string;
  /** The photo on this phone, shown while it uploads and after. */
  photoUri?: string;
}

/** Digits a seller typed (Western or Arabic-Indic, with separators) → whole dinars, or null. */
export function parsePrice(text: string): number | null {
  const digits = text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) && n > 0 && n <= 10_000_000 ? n : null;
}

/** Ready to publish: posted today and not reopened, «نفس البارحة», or a valid new price. */
export function isReady(row: StallPriceRow, draft: RowDraft | undefined): boolean {
  const c = draft?.choice;
  if (!c || c.kind === 'untouched') return row.postedToday;
  return c.kind === 'same' || parsePrice(c.text) !== null;
}

/** «4 من 6». */
export function readyCount(rows: readonly StallPriceRow[], drafts: Readonly<Record<string, RowDraft>>): number {
  return rows.filter((r) => isReady(r, drafts[r.itemId])).length;
}

/** Rows still waiting for a decision, for «الباقي كله نفس البارحة». */
export function untouchedIds(rows: readonly StallPriceRow[], drafts: Readonly<Record<string, RowDraft>>): string[] {
  return rows.filter((r) => !r.postedToday && (drafts[r.itemId]?.choice.kind ?? 'untouched') === 'untouched').map((r) => r.itemId);
}

/** What «انشر» sends: every row decided this morning. */
export function postItems(rows: readonly StallPriceRow[], drafts: Readonly<Record<string, RowDraft>>): PostPricesInput['items'] {
  const out: PostPricesInput['items'] = [];
  for (const r of rows) {
    const d = drafts[r.itemId];
    if (!d) continue;
    const price = d.choice.kind === 'new' ? parsePrice(d.choice.text) : null;
    if (d.choice.kind === 'new' && price === null) continue;
    // A new photo alone re-posts a row already posted today; an undecided row waits for its price.
    if (d.choice.kind === 'untouched' && !(d.photoUploadId && r.postedToday)) continue;
    out.push({
      itemId: r.itemId,
      ...(price !== null ? { priceIqd: price } : d.choice.kind === 'untouched' ? { priceIqd: r.priceIqd } : {}),
      ...(d.photoUploadId ? { photoUrl: `upload:${d.photoUploadId}` } : {}),
      available: true,
    });
  }
  return out;
}
