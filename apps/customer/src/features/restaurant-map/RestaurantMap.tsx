import type { MapShop } from './shops';

export interface RestaurantMapProps {
  shops: MapShop[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  topInset: number;
  bottomInset: number;
  lite: boolean;
  onFail: () => void;
}

/** Native: no 3D map until the native MapLibre map lands (RestaurantMap.web.tsx is the map); the screen shows the list. */
export function RestaurantMap(_props: RestaurantMapProps): null {
  return null;
}

/** Whether this build can draw the restaurant map. */
export const RESTAURANT_MAP = false;
