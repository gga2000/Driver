import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { PhotoContentType } from '@driver/contracts';
import { fitLongSide, PHOTO_LONG_SIDE_PX } from './photo-size';

/**
 * Resizes a big photo before upload (speed d3: 1.5–3 MB → about 200 KB on mobile data). If that fails
 * for any reason the original is sent, as before.
 */
export async function shrinkPhoto<P extends { uri: string; contentType: PhotoContentType }>(photo: P, width: number | undefined, height: number | undefined, max = PHOTO_LONG_SIDE_PX): Promise<P> {
  const resize = fitLongSide(width ?? 0, height ?? 0, max);
  if (!resize) return photo;
  try {
    const image = await ImageManipulator.manipulate(photo.uri).resize(resize).renderAsync();
    const out = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return { ...photo, uri: out.uri, contentType: 'image/jpeg' };
  } catch {
    return photo;
  }
}
