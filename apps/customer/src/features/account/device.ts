import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';
import { PHOTO_MAX_BYTES, type LatLng, type PhotoContentType, type PhotoUploadTicket } from '@driver/contracts';
import { API_URL } from '@/lib/api';
import { absoluteUrl } from './geo';
import { fitLongSide } from './photo-size';

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
  return shrinkPhoto({ uri: asset.uri, contentType: contentTypeOf(asset.mimeType, asset.uri) }, asset.width, asset.height);
}

/** Resizes a big photo before upload; if that fails for any reason the original is sent as before. */
async function shrinkPhoto(photo: PickedPhoto, width: number, height: number): Promise<PickedPhoto> {
  const resize = fitLongSide(width, height);
  if (!resize) return photo;
  try {
    const image = await ImageManipulator.manipulate(photo.uri).resize(resize).renderAsync();
    const out = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return { uri: out.uri, contentType: 'image/jpeg' };
  } catch {
    return photo;
  }
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

/** A GPS read never hangs the screen (audit FLOW-22): after this long the last fix of the past minute is used, or none. */
export const FIX_TIMEOUT_MS = 10_000;
const LAST_KNOWN_MAX_AGE_MS = 60_000;

/** One GPS fix; 'denied' when location permission is refused, null when no fix came in time. */
export async function currentFix(): Promise<Fix | 'denied' | null> {
  if (Platform.OS === 'web') return browserFix();
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return 'denied';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
    });
    const pos = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), late]).finally(() => clearTimeout(timer));
    const got = pos ?? (await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).catch(() => null));
    return got ? { pin: { lat: got.coords.latitude, lng: got.coords.longitude }, accuracyM: got.coords.accuracy ?? null } : null;
  } catch {
    return null;
  }
}

type GeoError = { code: number };
const PERMISSION_DENIED = 1;

function browserRead(geo: Geolocation, opts: PositionOptions): Promise<GeolocationPosition | GeoError> {
  return new Promise((resolve) => geo.getCurrentPosition(resolve, (e) => resolve({ code: e.code }), opts));
}

/**
 * The browser's position. A computer has no GPS: it places itself by Wi-Fi, which often fails at
 * once (macOS «kCLErrorLocationUnknown») when the browser is off in the system's location settings or
 * no network is known. So: a fresh-enough remembered position first, then a coarse read with a long
 * wait, then one precise read, and only then give up (the screen says to check the browser's
 * location setting or move the map by hand, `error.location_web`).
 */
async function browserFix(): Promise<Fix | 'denied' | null> {
  const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
  if (!geo) return null;
  const tries: PositionOptions[] = [
    { enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 15_000 },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
  ];
  for (const opts of tries) {
    const r = await browserRead(geo, opts);
    if ('coords' in r) return { pin: { lat: r.coords.latitude, lng: r.coords.longitude }, accuracyM: r.coords.accuracy ?? null };
    if (r.code === PERMISSION_DENIED) return 'denied';
  }
  return null;
}

/** The toast when no position came: go outdoors on a phone; on the web, the browser's location setting or the map by hand. */
export function locationWeakToast(t: (key: 'error.location_weak' | 'error.location_web' | 'error.location_web_hint') => string) {
  return Platform.OS === 'web'
    ? { message: t('error.location_web'), detail: t('error.location_web_hint'), tone: 'danger' as const }
    : { message: t('error.location_weak'), tone: 'danger' as const };
}

/**
 * The toast for a refused location permission, with a button to the phone's settings (audit FLOW-22);
 * the web has no settings to open, so it keeps the words only.
 */
export function locationDeniedToast(t: (key: 'error.location_denied' | 'location.open_settings') => string) {
  return {
    message: t('error.location_denied'),
    tone: 'danger' as const,
    ...(Platform.OS === 'web' ? {} : { action: { label: t('location.open_settings'), onPress: () => void Linking.openSettings().catch(() => undefined) } }),
  };
}

/** Photo URLs from the API may be relative to its origin (dev storage). */
export function photoUri(url: string): string {
  return absoluteUrl(url, API_URL);
}
