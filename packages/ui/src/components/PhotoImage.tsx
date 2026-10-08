import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { Image, StyleSheet, View, type ImageSourcePropType, type ImageStyle, type StyleProp } from 'react-native';
import { useNearView } from './near-view';

/** A photo from the network (a driver's face, a gate, a chat photo). */
export interface PhotoImageProps {
  uri: string;
  onError?: () => void;
  /** How the photo fills its box. Default `cover`. */
  fit?: 'cover' | 'contain';
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  testID?: string;
  /**
   * Load at once even off screen (the first screen's big picture). By default, on the web a photo waits
   * until it is about to scroll into view (speed w2); on a phone it always loads at once.
   */
  eager?: boolean;
}

/** Plain React Native image: no disk cache, so a photo seen yesterday downloads again. */
function NativePhoto({ uri, onError, fit = 'cover', style, accessibilityLabel, testID }: PhotoImageProps) {
  return <Image source={{ uri }} onError={onError} resizeMode={fit} style={style} accessibilityLabel={accessibilityLabel} accessibilityIgnoresInvertColors testID={testID} />;
}

const PhotoContext = createContext<ComponentType<PhotoImageProps>>(NativePhoto);

/**
 * Lets an app draw network photos with its own image component, e.g. expo-image with a memory and disk
 * cache (speed d4). Apps that pass nothing keep React Native's `Image`.
 */
export function PhotoImageProvider({ component, children }: { component: ComponentType<PhotoImageProps>; children: ReactNode }) {
  return <PhotoContext.Provider value={component}>{children}</PhotoContext.Provider>;
}

/**
 * Until a waiting photo is near the screen, an empty box with the photo's own size and place holds its
 * spot (whatever is behind it shows through), so nothing moves when the photo arrives.
 */
function Waiting({ holdRef, style, testID }: { holdRef: ReturnType<typeof useNearView>['ref']; style: StyleProp<ImageStyle>; testID: string | undefined }) {
  const box: Record<string, unknown> = { ...StyleSheet.flatten(style) };
  for (const imageOnly of ['resizeMode', 'tintColor', 'overlayColor']) delete box[imageOnly];
  return <View ref={holdRef} style={box} testID={testID ? `${testID}-waiting` : undefined} />;
}

export function PhotoImage(props: PhotoImageProps) {
  const Photo = useContext(PhotoContext);
  const { ref, near } = useNearView(props.eager);
  if (!near) return <Waiting holdRef={ref} style={props.style} testID={props.testID} />;
  return <Photo {...props} />;
}

/** A picture bundled with the app (a kitchen scene, a door photo). */
export interface LocalPhotoProps {
  source: ImageSourcePropType;
  fit?: 'cover' | 'contain';
  style?: StyleProp<ImageStyle>;
  /** See `PhotoImageProps.eager`. */
  eager?: boolean;
  testID?: string;
}

/**
 * React Native's `Image` for a bundled picture, decorative (hidden from screen readers), that on the web
 * downloads only when it is about to scroll into view unless `eager` (speed w2).
 */
export function LocalPhoto({ source, fit = 'cover', style, eager, testID }: LocalPhotoProps) {
  const { ref, near } = useNearView(eager);
  if (!near) return <Waiting holdRef={ref} style={style} testID={testID} />;
  return <Image source={source} resizeMode={fit} accessible={false} style={style} testID={testID} />;
}
