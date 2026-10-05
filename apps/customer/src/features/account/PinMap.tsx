import { PinMapSketch, type PinMapProps } from './PinMapSketch';

/** Native pin picker: the schematic map until MapLibre ships in a dev-client build (see `BaseMap.tsx`). */
export function PinMap(props: PinMapProps) {
  return <PinMapSketch {...props} />;
}
