import type { SharedValue } from 'react-native-reanimated';

export { mapBoxNight } from './map-box';

export interface MapBoxProps {
  night: boolean;
  /** The live line on the drawn town: «8 فاتحين هسة», or when they open. */
  fact: string;
  /** The page's scroll; the box must be a direct child of the page, so its layout is page-relative. */
  scrollY: SharedValue<number>;
  width: number;
}

/** Native: the restaurant map's cards come with the native map (MapBox.web.tsx is the box); home shows nothing here. */
export function MapBox(_props: MapBoxProps): null {
  return null;
}
