import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { PHOTO_MAX_BYTES, type PhotoContentType, type PhotoUploadTicket } from '@driver/contracts';
import { API_URL } from '@/lib/api';

/**
 * Food and menu photos: the camera on a phone/tablet, the photo library (a file picker on the web —
 * expo-image-picker serves both), then a signed upload (`places.photoUpload` ticket + PUT).
 *
 * Every photo is shrunk to at most 1,280 px on its long side before it leaves the phone (perf d3): a
 * phone camera's 1.5–3 MB becomes about 200 KB on mobile data, and the menu never shows it bigger.
 */

/** The long side a photo is shrunk to before upload. */
export const UPLOAD_LONG_SIDE = 1280;

/** The size to shrink to, or null when the photo is already small enough (or its size is unknown). */
export function fitWithin(width: number, height: number, longSide: number = UPLOAD_LONG_SIDE): { width: number; height: number } | null {
  if (!(width > 0 && height > 0)) return null;
  const long = Math.max(width, height);
  if (long <= longSide) return null;
  const k = longSide / long;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

export interface PickedPhoto {
  uri: string;
  contentType: PhotoContentType;
}

export type PhotoSource = 'camera' | 'library';

function contentTypeOf(mime: string | null | undefined, uri: string): PhotoContentType {
  const m = (mime ?? '').toLowerCase();
  if (m === 'image/png' || /\.png$/i.test(uri)) return 'image/png';
  if (m === 'image/webp' || /\.webp$/i.test(uri)) return 'image/webp';
  return 'image/jpeg';
}

/** null = cancelled; 'denied' = permission refused. Several photos for a menu import. */
export async function pickPhotos(source: PhotoSource, opts: { multiple?: boolean; square?: boolean } = {}): Promise<PickedPhoto[] | null | 'denied'> {
  const useCamera = source === 'camera' && Platform.OS !== 'web';
  if (useCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return 'denied';
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.7,
    exif: false,
    allowsEditing: !!opts.square && !opts.multiple && Platform.OS !== 'web',
    ...(opts.square ? { aspect: [4, 3] as [number, number] } : {}),
    allowsMultipleSelection: !!opts.multiple && !useCamera,
    selectionLimit: opts.multiple ? 10 : 1,
  };
  const res = useCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (res.canceled || res.assets.length === 0) return null;
  return Promise.all(res.assets.map((a) => shrink({ uri: a.uri, contentType: contentTypeOf(a.mimeType, a.uri) }, a.width, a.height)));
}

/** Re-encodes a big photo as a 1,280 px JPEG; on any failure the original goes up as it was. */
async function shrink(photo: PickedPhoto, width: number, height: number): Promise<PickedPhoto> {
  const size = fitWithin(width, height);
  if (!size) return photo;
  try {
    const image = await ImageManipulator.manipulate(photo.uri).resize(size).renderAsync();
    const out = await image.saveAsync({ compress: 0.75, format: SaveFormat.JPEG });
    return { uri: out.uri, contentType: 'image/jpeg' };
  } catch {
    return photo;
  }
}

/** Photo URLs from the API may be relative to its origin (dev storage). */
export function absoluteUrl(url: string): string {
  if (/^(https?:|data:|blob:|file:)/.test(url)) return url;
  return new URL(url, API_URL).toString();
}

/** Two steps: a signed ticket, then PUT the bytes. Returns the upload id. */
export async function uploadPhoto(photo: PickedPhoto, requestTicket: (input: { contentType: PhotoContentType; sizeBytes: number }) => Promise<PhotoUploadTicket>): Promise<string> {
  const blob = await (await fetch(photo.uri)).blob();
  if (blob.size === 0 || blob.size > PHOTO_MAX_BYTES) throw new Error('photo_size');
  const ticket = await requestTicket({ contentType: photo.contentType, sizeBytes: blob.size });
  const put = await fetch(absoluteUrl(ticket.uploadUrl), { method: ticket.method, headers: ticket.headers, body: blob });
  if (!put.ok) throw new Error(`upload_${put.status}`);
  return ticket.uploadId;
}
