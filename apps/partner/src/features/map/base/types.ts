import type { SharedValue } from 'react-native-reanimated';
import type { LabelObstacle } from '@driver/map';
import type { DemandCell } from '@driver/map/pieces/demand';
import type { ClosedGeoJSON } from '../closed';
import type { Camera, Size } from '../geo';

/** The camera every layer reads on the UI thread: centre + zoom as three shared values. */
export interface CameraValues {
  lng: SharedValue<number>;
  lat: SharedValue<number>;
  zoom: SharedValue<number>;
}

export interface BaseMapProps {
  /** Camera the static layers were last drawn for (React state; redrawn when the camera settles). */
  drawn: Camera;
  cam: CameraValues;
  size: Size;
  /** The person started dragging/zooming: the screen stops following the courier. */
  onUserGestureStart: () => void;
  /** The person let go: the camera stays where they left it. */
  onUserCamera: (c: Camera) => void;
  /** Markers the zone names keep clear of (pins, the courier, the centre pin). Memoise it: a new array redraws the names. */
  labelAvoid?: readonly LabelObstacle[];
  /** Bands covered by the screen's own bars (top bar, sheet), px: landmarks are not drawn half-hidden under them. */
  coveredTop?: number;
  coveredBottom?: number;
  /** Zoom landmark names show from on this map (default `LANDMARK_RULES.nameZoom`). */
  landmarkNameZoom?: number;
  /** Where the orders are (N17): soft amber light drawn into the map itself, under the street names (MapLibre only). */
  glow?: readonly DemandCell[];
  /** The map drew (`true`) or dropped (`false`) the glow, so the screen knows whether to draw its own. */
  onGlow?: (drawn: boolean) => void;
  /** N20: the closed streets the road goes around (`closedData`), drawn into the map itself (MapLibre only). */
  closed?: ClosedGeoJSON;
  /** What the map drew of them (the lines; the «مسدود» labels need its glyphs), so the screen draws the rest. */
  onClosed?: (drawn: ClosedDrawn) => void;
}

export interface ClosedDrawn {
  lines: boolean;
  labels: boolean;
}
