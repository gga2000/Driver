/**
 * Delivery photos (maps program f11) as trips sees them: the uploads live in the places module's blob
 * store; trips only checks a photo is the courier's own, signs a read URL for support, and deletes it
 * at the end of retention.
 */
export interface HandoverPhotos {
  /** A stored upload of `personId` (a pending or someone else's upload is not a delivery photo). */
  owns(uploadId: string, personId: string): Promise<boolean>;
  readUrl(uploadId: string): string;
  remove(uploadId: string): Promise<void>;
}

export const HANDOVER_PHOTOS = Symbol('HANDOVER_PHOTOS');
