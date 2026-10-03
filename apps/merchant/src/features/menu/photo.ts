import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { PHOTO_MAX_BYTES, type PhotoContentType, type PhotoUploadTicket } from '@driver/contracts';
import { API_URL } from '@/lib/api';

/**
 * Food and menu photos: the camera on a phone/tablet, the photo library (a file picker on the web —
 * expo-image-picker serves both), then a signed upload (`places.photoUpload` ticket + PUT).
 */

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
  return res.assets.map((a) => ({ uri: a.uri, contentType: contentTypeOf(a.mimeType, a.uri) }));
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
