import type { SharedValue } from 'react-native-reanimated';
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
}
