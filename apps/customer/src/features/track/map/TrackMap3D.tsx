import type { CourierPosition, OrderTracking } from '@driver/contracts';

export interface TrackMap3DProps {
  view: OrderTracking;
  fix: CourierPosition | null;
  stale: boolean;
  topInset: number;
  bottomInset: number;
  onFail: () => void;
}

/** Native: the flat order map until the native MapLibre map lands (TrackMap3D.web.tsx is the 3D one). */
export function TrackMap3D(_props: TrackMap3DProps): null {
  return null;
}

export const TRACK_3D = false;
