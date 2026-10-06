/**
 * Dish and kitchen photos as the catalog stores them, and as an app can load them. A photo the
 * merchant uploaded (item editor, menu photo service) is stored as `upload:<id>` — an id in the
 * places blob store, whose read links are signed and expire — while seeded or outside photos are
 * plain URLs. Every read that leaves the API turns the first kind into a signed link; one that cannot
 * sign (no blob store wired) drops it rather than hand an app a string it cannot load.
 */

/** Prefix of a stored photo that is an upload id, not a URL. */
export const UPLOAD_PHOTO_PREFIX = 'upload:';

/** What signing needs: the blob store's read link for an upload id (places `BlobStore` fits). */
export interface PhotoLinks {
  readUrl(uploadId: string): string;
}

/** A stored photo → what the app loads (null = no photo to show). */
export type PhotoLink = (stored: string | null) => string | null;

/** Nest token for the signer the customer catalog read uses (bound to the places blob store). */
export const STOREFRONT_PHOTOS = Symbol('STOREFRONT_PHOTOS');

/** `upload:<id>` → a signed read link; a plain URL passes through; nothing to sign with → null. */
export function itemPhotoUrl(links: PhotoLinks | null | undefined, stored: string | null): string | null {
  if (!stored) return null;
  if (!stored.startsWith(UPLOAD_PHOTO_PREFIX)) return stored;
  return links ? links.readUrl(stored.slice(UPLOAD_PHOTO_PREFIX.length)) : null;
}

/** `itemPhotoUrl` bound to one signer, for the view builders that take a `PhotoLink`. */
export function photoLink(links: PhotoLinks | null | undefined): PhotoLink {
  return (stored) => itemPhotoUrl(links, stored);
}
