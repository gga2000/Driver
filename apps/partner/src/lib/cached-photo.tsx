import { Image } from 'expo-image';
import type { PhotoImageProps } from '@driver/ui';

/**
 * Network photos through expo-image (speed d4): kept in memory and on disk, so a place photo or his own main
 * photo seen once doesn't download again, and big photos are decoded at the size they're drawn.
 */
export function CachedPhoto({ uri, onError, fit = 'cover', style, accessibilityLabel, testID }: PhotoImageProps) {
  return <Image source={{ uri }} onError={onError} contentFit={fit} cachePolicy="memory-disk" transition={120} style={style} accessibilityLabel={accessibilityLabel} accessibilityIgnoresInvertColors testID={testID} />;
}
