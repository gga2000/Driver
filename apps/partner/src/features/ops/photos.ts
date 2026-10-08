import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { PHOTO_MAX_BYTES, type PhotoContentType, type PhotoUploadTicket } from '@driver/contracts';
import { API_URL } from '@/lib/api';
import { DOCUMENT_LONG_SIDE_PX } from '@/lib/photo-size';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { countData, HEADERS_BYTES } from '@/lib/data-usage';

/**
 * Field photos (landmarks, menus): camera on a phone, the file picker on the web (expo-image-picker
 * serves both), then the two-step upload: `places.photoUpload` for a signed ticket, PUT the bytes.
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

/** One photo, or several from the library (menu pages); [] = cancelled; 'denied' = no camera permission. */
export async function pickPhotos(source: PhotoSource, multiple = false): Promise<PickedPhoto[] | 'denied'> {
  const useCamera = source === 'camera' && Platform.OS !== 'web';
  if (useCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return 'denied';
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false, exif: false, allowsMultipleSelection: multiple && !useCamera, selectionLimit: multiple ? 10 : 1 };
  const res = useCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled) return [];
  // Menu pages keep the document size so prices stay readable.
  return Promise.all(res.assets.map((a) => shrinkPhoto({ uri: a.uri, contentType: contentTypeOf(a.mimeType, a.uri) }, a.width, a.height, DOCUMENT_LONG_SIDE_PX)));
}

/** Upload URLs from the API may be relative to its origin (dev storage). */
export function absoluteUrl(url: string, apiUrl: string = API_URL): string {
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('file:')) return url;
  try {
    return new URL(url, new URL(apiUrl).origin).toString();
  } catch {
    return url;
  }
}

/** Returns the upload id to pass to `ops.*`; throws on a refused or failed upload. */
export async function uploadPhoto(photo: PickedPhoto, requestTicket: (input: { contentType: PhotoContentType; sizeBytes: number }) => Promise<PhotoUploadTicket>): Promise<string> {
  const blob = await (await fetch(photo.uri)).blob();
  if (blob.size === 0 || blob.size > PHOTO_MAX_BYTES) throw new Error('photo_size');
  const ticket = await requestTicket({ contentType: photo.contentType, sizeBytes: blob.size });
  const put = await fetch(absoluteUrl(ticket.uploadUrl), { method: ticket.method, headers: ticket.headers, body: blob });
  countData(blob.size + HEADERS_BYTES);
  if (!put.ok) throw new Error(`upload_${put.status}`);
  return ticket.uploadId;
}
