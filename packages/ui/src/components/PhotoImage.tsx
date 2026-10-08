import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

/** A photo from the network (a driver's face, a gate, a chat photo). */
export interface PhotoImageProps {
  uri: string;
  onError?: () => void;
  /** How the photo fills its box. Default `cover`. */
  fit?: 'cover' | 'contain';
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  testID?: string;
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

export function PhotoImage(props: PhotoImageProps) {
  const Photo = useContext(PhotoContext);
  return <Photo {...props} />;
}
