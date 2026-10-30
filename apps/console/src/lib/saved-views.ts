import type { LinkParams } from './url-state';

/**
 * Saved views (o5): a staff member names the orders list they keep coming back to ("late food
 * orders in Hay Al-Askari") and opens it with one tap. Kept per viewer in localStorage as the same
 * link values the page already writes, so a saved view is exactly the list its link would open.
 * Search text is never saved: it can hold a phone number or a name.
 */
export type SavedView = { id: string; name: string; params: LinkParams };

export const MAX_VIEWS = 8;
export const MAX_NAME = 40;

/** Only the values that differ from the page's defaults, so two spellings of one list compare equal. */
export function trimParams(params: LinkParams, defaults: LinkParams): LinkParams {
  const out: LinkParams = {};
  for (const k of Object.keys(defaults)) {
    const v = params[k];
    if (v !== undefined && v !== '' && v !== defaults[k]) out[k] = v;
  }
  return out;
}

export function sameParams(a: LinkParams, b: LinkParams, defaults: LinkParams): boolean {
  const x = trimParams(a, defaults);
  const y = trimParams(b, defaults);
  const kx = Object.keys(x);
  return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k]);
}

/**
 * Adds a view at the front. Saving a list that is already saved renames it instead of adding a
 * twin; past the limit the oldest one drops off.
 */
export function addView(list: readonly SavedView[], name: string, params: LinkParams, defaults: LinkParams, id: string): SavedView[] {
  const clean = name.trim().slice(0, MAX_NAME);
  if (!clean) return [...list];
  const trimmed = trimParams(params, defaults);
  const twin = list.find((v) => sameParams(v.params, trimmed, defaults));
  if (twin) return list.map((v) => (v.id === twin.id ? { ...v, name: clean } : v));
  return [{ id, name: clean, params: trimmed }, ...list].slice(0, MAX_VIEWS);
}

export function removeView(list: readonly SavedView[], id: string): SavedView[] {
  return list.filter((v) => v.id !== id);
}

/** Whatever localStorage held, back as a clean list (a bad entry is dropped, not fatal). */
export function parseViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedView[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const { id, name, params } = v as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || !name.trim() || !params || typeof params !== 'object') continue;
    const p: LinkParams = {};
    for (const [k, val] of Object.entries(params as Record<string, unknown>)) if (typeof val === 'string') p[k] = val;
    out.push({ id, name: name.slice(0, MAX_NAME), params: p });
  }
  return out.slice(0, MAX_VIEWS);
}
