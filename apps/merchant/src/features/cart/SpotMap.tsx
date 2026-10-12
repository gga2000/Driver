import type { Point } from './spot';

export interface SpotMapProps {
  /** Where the pin starts (and comes back to when `at` changes from outside). */
  at: Point;
  /** The bubble over the pin: «إنت هنا: يم {zone}». */
  bubble: string;
  /** The pin's point after each move of the map. */
  onMove: (at: Point) => void;
  /** The map could not draw (no files, no WebGL): the screen goes on without it. */
  onFail: () => void;
  height: number;
}

/** Phones: no map in the Merchant app yet; the open screen goes without one. */
export const SPOT_MAP = false;

export function SpotMap(_props: SpotMapProps) {
  return null;
}
