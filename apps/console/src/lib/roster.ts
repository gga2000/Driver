import type { DriverPinState, DriverRosterRow, DriversListInput, MerchantRow, RosterRole } from '@driver/contracts';
import { formatIqd } from './format';

/** Pure helpers for the drivers roster (`drivers.list`) and the merchant picker (`merchants.list`). */

export const PRESENCE_FILTERS = ['all', 'online', 'offline'] as const;
export type PresenceFilter = (typeof PRESENCE_FILTERS)[number];

export interface RosterFilter {
  presence: PresenceFilter;
  role: RosterRole | 'all';
  q: string;
}

export function rosterInput(cityId: string, f: RosterFilter, limit = 50): DriversListInput {
  const q = f.q.trim();
  return {
    cityId,
    limit,
    filter: { presence: f.presence, ...(f.role !== 'all' ? { role: f.role } : {}), ...(q ? { q } : {}) },
  };
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
