import { FlatTownMap } from './FlatTownMap';
import type { LiveTownMapProps } from './live-map-types';

/** Phones: the flat live map (the 3D Golden map lives in `LiveTownMap.web.tsx`). */
export function LiveTownMap(props: LiveTownMapProps) {
  return <FlatTownMap {...props} />;
}
