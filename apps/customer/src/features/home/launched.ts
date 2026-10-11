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
