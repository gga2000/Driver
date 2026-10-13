import type { Vertical } from '@driver/contracts';
import type { ServiceId } from './ServicesRow';

/** The home tiles that need a service the city may not have launched yet (both are الرجعة/intercity). */
const NEEDS: Partial<Record<ServiceId, Vertical>> = { trips: 'intercity', rajaa: 'intercity' };

/**
 * Whether home shows a service's tile, from the launched services `system.season` sends. Until the
 * server has said (first read, an older server) only the always-open ones show, so a service that
 * hasn't opened never flashes on home.
 */
export function tileLaunched(id: ServiceId, launched: readonly Vertical[] | undefined): boolean {
  const needs = NEEDS[id];
  return !needs || (launched?.includes(needs) ?? false);
}

/** The coming-soon services that have a door in «وعدنا هم» at the end of home once they open (only طرود so far). */
const DOORS: Partial<Record<ServiceId, Vertical>> = { parcel: 'parcel' };

/**
 * Whether a coming-soon service has opened in the city, so home shows its door instead of its «جاي قريب» chip.
 * Until the server has said, it stays coming soon.
 */
export function doorOpen(id: ServiceId, launched: readonly Vertical[] | undefined): boolean {
  const v = DOORS[id];
  return !!v && (launched?.includes(v) ?? false);
}
