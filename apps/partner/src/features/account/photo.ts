import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { PHOTO_MAX_BYTES, type PhotoContentType, type PhotoUploadTicket } from '@driver/contracts';
import { API_URL } from '@/lib/api';
import { DOCUMENT_LONG_SIDE_PX, PHOTO_LONG_SIDE_PX } from '@/lib/photo-size';
import { shrinkPhoto } from '@/lib/shrink-photo';

/**
 * Photos for documents and the daily selfie: the camera on a phone (front camera for the selfie),
 * the file picker on the web — expo-image-picker serves both. Uploads follow the API's pattern:
 * `places.photoUpload` for a signed ticket, PUT the bytes, then pass the upload id.
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

/** null = cancelled; 'denied' = camera permission refused. */
export async function pickPhoto(source: PhotoSource, opts: { selfie?: boolean; document?: boolean } = {}): Promise<PickedPhoto | null | 'denied'> {
  const useCamera = source === 'camera' && Platform.OS !== 'web';
  if (useCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return 'denied';
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.6,
    allowsEditing: false,
    exif: false,
    ...(opts.selfie && useCamera ? { cameraType: ImagePicker.CameraType.front } : {}),
  };
  const res = useCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  const picked = { uri: asset.uri, contentType: contentTypeOf(asset.mimeType, asset.uri) };
  return shrinkPhoto(picked, asset.width, asset.height, opts.document ? DOCUMENT_LONG_SIDE_PX : PHOTO_LONG_SIDE_PX);
}

/** Upload URLs from the dev storage are relative to the API's origin. */
export function absoluteUrl(url: string, apiUrl: string = API_URL): string {
  if (/^https?:\/\//.test(url)) return url;
  const origin = apiUrl.replace(/\/trpc\/?$/, '').replace(/\/$/, '');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Ticket → PUT → upload id. Throws on a refused or failed upload. */
export async function uploadPhoto(photo: PickedPhoto, requestTicket: (input: { contentType: PhotoContentType; sizeBytes: number }) => Promise<PhotoUploadTicket>): Promise<string> {
  const blob = await (await fetch(photo.uri)).blob();
  if (blob.size === 0 || blob.size > PHOTO_MAX_BYTES) throw new Error('photo_size');
  const ticket = await requestTicket({ contentType: photo.contentType, sizeBytes: blob.size });
  const put = await fetch(absoluteUrl(ticket.uploadUrl), { method: ticket.method, headers: ticket.headers, body: blob });
  if (!put.ok) throw new Error(`upload_${put.status}`);
  return ticket.uploadId;
}
