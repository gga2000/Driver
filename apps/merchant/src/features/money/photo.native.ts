import type { PhotoContentType, PhotoUploadTicket } from '@driver/contracts';
import { API_URL } from '@/lib/api';

/**
 * Native evidence photos. TODO(native-camera): open the camera with an image-picker module once the
 * Merchant dev-client build carries one (the menu's photo replace needs the same); until then the
 * button reports "cancelled" and the owner answers with a note only.
 */

export interface PickedPhoto {
  uri: string;
  contentType: PhotoContentType;
  blob: Blob;
}

export function pickPhoto(): Promise<PickedPhoto | null> {
  return Promise.resolve(null);
}

export function absoluteUploadUrl(url: string, apiUrl: string = API_URL): string {
  if (/^https?:\/\//.test(url)) return url;
  const origin = apiUrl.replace(/^(https?:\/\/[^/]+).*$/, '$1');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

export async function uploadPhoto(photo: PickedPhoto, ticket: (input: { contentType: PhotoContentType; sizeBytes: number }) => Promise<PhotoUploadTicket>): Promise<string> {
  const t = await ticket({ contentType: photo.contentType, sizeBytes: photo.blob.size });
  const put = await fetch(absoluteUploadUrl(t.uploadUrl), { method: t.method, headers: t.headers, body: photo.blob });
  if (!put.ok) throw new Error(`upload_${put.status}`);
  return t.uploadId;
}
