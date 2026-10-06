import { PHOTO_MAX_BYTES, PhotoContentType, type PhotoUploadTicket, type PickupStoreRow } from '@driver/contracts';

/**
 * Console › المطاعم (Ali 2026-10-07): the pure parts of the store list and of a pickup-spot photo
 * upload. The draft rules themselves are shared with the Merchant app (`pickupDraft` in contracts).
 */

/** Letters that differ only in how people type them: «أ/إ/آ» → «ا», «ة» → «ه», «ى» → «ي», no tatweel or marks. */
function fold(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .trim();
}

/** Stores whose name holds the typed words (any order), however the hamza or taa marbuta were typed. */
export function filterStores<T extends Pick<PickupStoreRow, 'name'>>(rows: readonly T[], query: string): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((r) => {
    const name = fold(r.name);
    return words.every((w) => name.includes(w));
  });
}

/** Stores with nothing set: no note and no photo (the list's hint counts them). */
export function missingCount(rows: readonly Pick<PickupStoreRow, 'note' | 'photos'>[]): number {
  return rows.filter((r) => !r.note && r.photos === 0).length;
}

export type PhotoProblem = 'type' | 'size';

/** A picked file the API will take (JPEG, PNG or WebP up to PHOTO_MAX_BYTES), or why not. */
export function photoProblem(file: { type: string; size: number }): PhotoProblem | null {
  if (!PhotoContentType.safeParse(file.type).success) return 'type';
  if (file.size <= 0 || file.size > PHOTO_MAX_BYTES) return 'size';
  return null;
}

/**
 * Two steps, as every app uploads: a signed ticket (`places.photoUpload`), then PUT the bytes to it
 * (a relative URL resolves against the API's origin). Returns the upload id to save with the spot.
 */
export async function uploadPhoto(
  file: Blob & { type: string },
  requestTicket: (input: { contentType: PhotoContentType; sizeBytes: number }) => Promise<PhotoUploadTicket>,
  resolveUrl: (url: string) => string,
  put: typeof fetch = fetch,
): Promise<string> {
  const contentType = PhotoContentType.parse(file.type);
  const ticket = await requestTicket({ contentType, sizeBytes: file.size });
  const res = await put(resolveUrl(ticket.uploadUrl), { method: ticket.method, headers: ticket.headers, body: file });
  if (!res.ok) throw new Error(`upload_${res.status}`);
  return ticket.uploadId;
}
