import { useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { PhotoImage } from '@driver/ui';
import { apiPhoto } from '@/lib/photo';
import type { FoodPhotoSource } from './photos';

/**
 * Draws a food photo whether it ships in the app (a door picture) or comes from the API (a dish
 * picture, cached on the phone once seen). Until it arrives, or when it cannot, the box keeps its own
 * dark background, so a card never shows a broken image.
 */
export function FoodPhoto({ photo, style }: { photo: FoodPhotoSource; style?: StyleProp<ImageStyle> }) {
  const [failed, setFailed] = useState(false);
  // A bundled picture is whatever require() gave (a number on phones, an object on the web).
  if (typeof photo !== 'string') return <Image source={photo} resizeMode="cover" accessible={false} style={style} />;
  const uri = apiPhoto(photo);
  if (!uri || failed) return null;
  return <PhotoImage uri={uri} onError={() => setFailed(true)} style={style} />;
}
