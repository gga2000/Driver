import type { DriverPinState, DriverRosterRow, DriversListInput, DriverTier, MerchantRow, RosterRole } from '@driver/contracts';
import { formatIqd } from './format';

/** Pure helpers for the drivers roster (`drivers.list`) and the merchant picker (`merchants.list`). */

export const PRESENCE_FILTERS = ['all', 'online', 'offline'] as const;
export type PresenceFilter = (typeof PRESENCE_FILTERS)[number];

export interface RosterFilter {
  presence: PresenceFilter;
  role: RosterRole | 'all';
  /** A name ("حيدر", "حيدر ك") or a person id pasted from somewhere ("p_103"). */
  q: string;
  tier?: DriverTier | 'all' | undefined;
  docsExpiring?: boolean | undefined;
}

/** A pasted person id (Latin letters, digits, _ or -) rather than a name. */
export function looksLikeId(q: string): boolean {
  return /^[a-z][a-z0-9_-]*\d[a-z0-9_-]*$/i.test(q.trim());
}

/** `drivers.list` input: names go to the API's logged name search, ids to the id filter. */
export function rosterInput(cityId: string, f: RosterFilter, limit = 50): DriversListInput {
  const q = f.q.trim();
  const byName = q.length > 0 && !looksLikeId(q);
  return {
    cityId,
    limit,
    filter: {
      presence: f.presence,
      ...(f.role !== 'all' ? { role: f.role } : {}),
      ...(q && !byName ? { q } : {}),
      ...(byName ? { name: q.slice(0, 60) } : {}),
      ...(f.tier && f.tier !== 'all' ? { tier: f.tier } : {}),
      ...(f.docsExpiring ? { docsExpiring: true } : {}),
    },
  };
}

/** Owed against the cap as a 0–1 share (over 1 when over the cap); 0 when nothing counts. */
export function capFill(c: { owedIqd: number; capIqd: number }): number {
  if (c.capIqd <= 0) return c.owedIqd > 0 ? 1 : 0;
  return Math.max(0, c.owedIqd) / c.capIqd;
}

/**
 * Problems first (DESIGN.md, lists): over the cap, at the cap's edge, papers expired, near the cap,
 * then who is working (on a job, offered, free) and the offline last. Ties keep the server's order.
 */
export function rosterRank(r: Pick<DriverRosterRow, 'state' | 'cash' | 'docs' | 'frozen'>): number {
  const fill = r.cash ? capFill(r.cash) : 0;
  if (r.state === 'over_cap' || r.cash?.overCap || fill >= 1) return 0;
  if (fill >= 0.9) return 1;
  if (r.docs?.state === 'expired' || r.frozen) return 2;
  if (fill >= 0.7) return 3;
  if (r.state === 'on_job' || r.state === 'offered') return 4;
  if (r.state === 'free') return 5;
  return 6;
}

export function sortRoster<T extends Pick<DriverRosterRow, 'state' | 'cash' | 'docs' | 'frozen'>>(rows: readonly T[]): T[] {
  return rows
    .map((r, i) => [r, rosterRank(r), i] as const)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2])
    .map(([r]) => r);
}

/** Rows of every loaded page, once each (a driver can move between pages while polling). */
export function flattenRoster(pages: ReadonlyArray<{ rows: readonly DriverRosterRow[] }> | undefined): DriverRosterRow[] {
  const seen = new Set<string>();
  const out: DriverRosterRow[] = [];
  for (const page of pages ?? []) {
    for (const r of page.rows) {
      if (seen.has(r.personId)) continue;
      seen.add(r.personId);
      out.push(r);
    }
  }
  return out;
}

export type StateTone = 'live' | 'ready' | 'done' | 'bad' | 'neutral';

export const PIN_STATE_TONE: Readonly<Record<DriverPinState, StateTone>> = {
  free: 'done',
  offered: 'ready',
  on_job: 'live',
  over_cap: 'bad',
  offline_recent: 'neutral',
};

/** Picker label: "كباب الزهراء · 45,000". */
export function merchantOptionLabel(m: Pick<MerchantRow, 'name' | 'balanceIqd'>): string {
  return `${m.name} · ${formatIqd(m.balanceIqd)}`;
}

/** Merchants over their exposure cap first, then by name (the API sorts by name). */
export function merchantsForPicker(list: readonly MerchantRow[]): MerchantRow[] {
  return [...list].sort((a, b) => Number(b.overExposure) - Number(a.overExposure) || a.name.localeCompare(b.name, 'ar'));
}
