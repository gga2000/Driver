import type { BaseMapProps } from './types';
import { SvgBase } from './SvgBase';

/**
 * Native base map. TODO(native-map): swap in `@maplibre/maplibre-react-native` (MapView + the
 * `@driver/map` light style, camera from `cam`) once the app ships as a dev-client build — it cannot
 * run in Expo Go or be built offline here. The overlay (courier, route, pins) is renderer-agnostic.
 */
export function BaseMap(props: BaseMapProps) {
  return <SvgBase {...props} />;
}

export const BASE_MAP_KIND: 'svg' | 'maplibre' = 'svg';
