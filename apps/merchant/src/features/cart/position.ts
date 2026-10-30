import type { Point } from './spot';

export type HereState = { state: 'asking' } | { state: 'here'; at: Point } | { state: 'none' };

/**
 * Phones: the Merchant app has no location module yet (a native build adds it before carts launch), so
 * the owner keeps last night's spot or picks the area he stands in.
 */
export function useHere(): HereState {
  return { state: 'none' };
}
