import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { PHOTO_MAX_BYTES, type LatLng, type PhotoContentType, type PhotoUploadTicket } from '@driver/contracts';
import { API_URL } from '@/lib/api';
import { absoluteUrl } from './geo';

/**
 * Device capabilities the account screens use: the gate photo (camera on a phone, file picker on
 * the web — expo-image-picker serves both) and a GPS fix for "موقعي هنا" (expo-location; the
 * browser's geolocation on the web).
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

/** null = cancelled; 'denied' = permission refused (show `error.camera_denied`). */
export async function pickGatePhoto(source: PhotoSource): Promise<PickedPhoto | null | 'denied'> {
  const useCamera = source === 'camera' && Platform.OS !== 'web';
  if (useCamera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return 'denied';
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false, exif: false };
  const res = useCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  const asset = res.canceled ? null : res.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, contentType: contentTypeOf(asset.mimeType, asset.uri) };
}

/**
 * Two steps: `places.photoUpload` for a signed ticket, then PUT the bytes to it. Returns the upload
 * id to pass in `photoIds`. Throws on a refused or failed upload (`error.upload_failed`).
 */
export async function uploadPhoto(photo: PickedPhoto, requestTicket: (input: { contentType: PhotoContentType; sizeBytes: number }) => Promise<PhotoUploadTicket>): Promise<string> {
  const blob = await (await fetch(photo.uri)).blob();
  if (blob.size === 0 || blob.size > PHOTO_MAX_BYTES) throw new Error('photo_size');
  const ticket = await requestTicket({ contentType: photo.contentType, sizeBytes: blob.size });
  const put = await fetch(absoluteUrl(ticket.uploadUrl, API_URL), { method: ticket.method, headers: ticket.headers, body: blob });
  if (!put.ok) throw new Error(`upload_${put.status}`);
  return ticket.uploadId;
}

export type Fix = { pin: LatLng; accuracyM: number | null };

/** One GPS fix; 'denied' when location permission is refused, null when no fix came. */
export async function currentFix(): Promise<Fix | 'denied' | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return 'denied';
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { pin: { lat: pos.coords.latitude, lng: pos.coords.longitude }, accuracyM: pos.coords.accuracy ?? null };
  } catch {
    return null;
  }
}

/** Photo URLs from the API may be relative to its origin (dev storage). */
export function photoUri(url: string): string {
  return absoluteUrl(url, API_URL);
}
