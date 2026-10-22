import type { StaffChange } from '@driver/contracts';

/** Per store: the newest change its owner has seen on this device (ISO time). */
export const STAFF_SEEN_KEY = 'driver.merchant.staff_changes_seen';
/** A device that never opened the list counts only the last week as new (not the whole setup). */
export const NEW_WINDOW_MS = 7 * 24 * 60 * 60_000;

export type SeenMap = Readonly<Record<string, string>>;

export function parseSeen(raw: string | null): Record<string, string> {
  try {
    const v: unknown = JSON.parse(raw ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string' && !Number.isNaN(Date.parse(e[1]))));
  } catch {
    return {};
  }
}

/** The changes newer than what he last saw here (or, the first time, from the last week). */
export function unseenChanges(rows: readonly StaffChange[], seenIso: string | undefined, now: number): StaffChange[] {
  const since = seenIso ? Date.parse(seenIso) : now - NEW_WINDOW_MS;
  return rows.filter((r) => new Date(r.at).getTime() > since);
}

/** Opening the list sees everything up to its newest row; an older mark never replaces a newer one. */
export function markSeen(seen: SeenMap, merchantOrgId: string, rows: readonly StaffChange[]): Record<string, string> {
  const newest = rows.reduce<number>((m, r) => Math.max(m, new Date(r.at).getTime()), 0);
  const had = seen[merchantOrgId] ? Date.parse(seen[merchantOrgId]) : 0;
  if (newest <= had) return { ...seen };
  return { ...seen, [merchantOrgId]: new Date(newest).toISOString() };
}
