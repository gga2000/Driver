import { PICKUP_SPOT_RULES, type PickupSpotPhoto, type PickupSpotView, type SetPickupSpotInput } from './merchant-io.js';

/**
 * «مكان الاستلام» editing as plain data, shared by the Merchant app (the owner) and the Console (field
 * ops, Ali 2026-10-07): a screen keeps a draft (note + photos already uploaded), compares it with what
 * is saved to light the save button, and turns it into the one save call (`merchant.setPickupSpot` /
 * `ops.pickupSpots.set`, the same input). Kept pure so the rules (2 photos, 140 characters, no
 * repeats) are tested once, without a screen.
 */
export interface PickupDraft {
  note: string;
  photos: PickupSpotPhoto[];
}

/** The draft a saved spot starts from (an empty one when never set). */
function from(view: Pick<PickupSpotView, 'note' | 'photos'>): PickupDraft {
  return { note: view.note ?? '', photos: view.photos.map((p) => ({ ...p })) };
}

/** Same note (ignoring spaces at the ends) and the same photos in the same order: nothing to save. */
function same(a: PickupDraft, b: PickupDraft): boolean {
  return a.note.trim() === b.note.trim() && a.photos.length === b.photos.length && a.photos.every((p, i) => p.id === b.photos[i]?.id);
}

/** Room for another photo (the add buttons hide at the limit). */
function canAddPhoto(draft: PickupDraft): boolean {
  return draft.photos.length < PICKUP_SPOT_RULES.maxPhotos;
}

/** Adds an uploaded photo at the end; a repeat or one past the limit leaves the draft as it is. */
function addPhoto(draft: PickupDraft, photo: PickupSpotPhoto): PickupDraft {
  if (!canAddPhoto(draft) || draft.photos.some((p) => p.id === photo.id)) return draft;
  return { ...draft, photos: [...draft.photos, photo] };
}

function removePhoto(draft: PickupDraft, id: string): PickupDraft {
  return { ...draft, photos: draft.photos.filter((p) => p.id !== id) };
}

/** The note cut to what the API accepts, so typing past the limit simply stops. */
function withNote(draft: PickupDraft, note: string): PickupDraft {
  return { ...draft, note: note.slice(0, PICKUP_SPOT_RULES.noteMaxChars) };
}

/** Characters still free in the note (counted on the trimmed text, as the API counts). */
function noteLeft(draft: PickupDraft): number {
  return Math.max(0, PICKUP_SPOT_RULES.noteMaxChars - draft.note.trim().length);
}

/** The save call: a blank note is none, photos in the order they are shown. */
function toInput(merchantOrgId: string, draft: PickupDraft): SetPickupSpotInput {
  const note = draft.note.trim();
  return { merchantOrgId, note: note.length > 0 ? note : null, photoIds: draft.photos.map((p) => p.id) };
}

export const pickupDraft = { from, same, canAddPhoto, addPhoto, removePhoto, withNote, noteLeft, toInput } as const;
