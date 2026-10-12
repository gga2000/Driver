import type { CartsMapProps } from './carts-map-types';

export type { CartsMapProps } from './carts-map-types';

/**
 * Phones: the carts map waits for the native cart layer (`@driver/map/pieces/carts`, map thread #289);
 * until then the screen shows the list. Keeps the map code off the phone bundle meanwhile.
 */
export const CARTS_MAP = false;

export function CartsMap(_props: CartsMapProps) {
  return null;
}
