import type { PhotoContentType, PhotoUploadTicket } from '@driver/contracts';
import { API_URL } from '@/lib/api';

/**
 * Evidence photos for a dispute answer. Web: the browser's file picker (camera on a phone browser).
 * Native: `photo.native.ts` (camera through an image-picker module in a dev-client build).
 */

export interface PickedPhoto {
  uri: string;
  contentType: PhotoContentType;
  blob: Blob;
}

function typeOf(mime: string): PhotoContentType | null {
  if (mime === 'image/png') return 'image/png';
  if (mime === 'image/webp') return 'image/webp';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'image/jpeg';
  return null;
}

/** Opens the picker; null when cancelled or the file isn't a JPEG/PNG/WebP. */
export function pickPhoto(): Promise<PickedPhoto | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const file = input.files?.[0];
      const contentType = file ? typeOf(file.type) : null;
      resolve(file && contentType ? { uri: URL.createObjectURL(file), contentType, blob: file } : null);
    };
    input.click();
  });
}

/** Upload URLs may be relative to the API's origin (dev storage). */
export function absoluteUploadUrl(url: string, apiUrl: string = API_URL): string {
  if (/^https?:\/\//.test(url)) return url;
  const origin = apiUrl.replace(/^(https?:\/\/[^/]+).*$/, '$1');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Ticket, then PUT the bytes; returns the upload id for `respondDispute`. */
export async function uploadPhoto(photo: PickedPhoto, ticket: (input: { contentType: PhotoContentType; sizeBytes: number }) => Promise<PhotoUploadTicket>): Promise<string> {
  const t = await ticket({ contentType: photo.contentType, sizeBytes: photo.blob.size });
  const put = await fetch(absoluteUploadUrl(t.uploadUrl), { method: t.method, headers: t.headers, body: photo.blob });
  if (!put.ok) throw new Error(`upload_${put.status}`);
  return t.uploadId;
}
