import { PICKUP_SPOT_RULES, type PickupSpotPhoto, type PickupSpotView, type SetPickupSpotInput } from '@driver/contracts';

/**
 * «مكان الاستلام» editing as plain data: the screen keeps a draft (note + photos already uploaded),
 * compares it with what is saved to light the save button, and turns it into the one `setPickupSpot`
 * call. Kept pure so the rules (2 photos, 140 characters, no repeats) are tested without a screen.
 */
export interface PickupDraft {
  note: string;
  photos: PickupSpotPhoto[];
}

/** The draft a saved spot starts from (an empty one when never set). */
export function draftFrom(view: Pick<PickupSpotView, 'note' | 'photos'>): PickupDraft {
  return { note: view.note ?? '', photos: view.photos.map((p) => ({ ...p })) };
}

/** Same note (ignoring spaces at the ends) and the same photos in the same order: nothing to save. */
export function sameDraft(a: PickupDraft, b: PickupDraft): boolean {
  return a.note.trim() === b.note.trim() && a.photos.length === b.photos.length && a.photos.every((p, i) => p.id === b.photos[i]?.id);
}

/** Room for another photo (the add buttons hide at the limit). */
export function canAddPhoto(draft: PickupDraft): boolean {
  return draft.photos.length < PICKUP_SPOT_RULES.maxPhotos;
}

/** Adds an uploaded photo at the end; a repeat or one past the limit leaves the draft as it is. */
export function addPhoto(draft: PickupDraft, photo: PickupSpotPhoto): PickupDraft {
  if (!canAddPhoto(draft) || draft.photos.some((p) => p.id === photo.id)) return draft;
  return { ...draft, photos: [...draft.photos, photo] };
}

export function removePhoto(draft: PickupDraft, id: string): PickupDraft {
  return { ...draft, photos: draft.photos.filter((p) => p.id !== id) };
}

/** The note cut to what the API accepts, so typing past the limit simply stops. */
export function withNote(draft: PickupDraft, note: string): PickupDraft {
  return { ...draft, note: note.slice(0, PICKUP_SPOT_RULES.noteMaxChars) };
}

/** Characters still free in the note (counted on the trimmed text, as the API counts). */
export function noteLeft(draft: PickupDraft): number {
  return Math.max(0, PICKUP_SPOT_RULES.noteMaxChars - draft.note.trim().length);
}

/** The save call: a blank note is none, photos in the order the owner sees them. */
export function toInput(merchantOrgId: string, draft: PickupDraft): SetPickupSpotInput {
  const note = draft.note.trim();
  return { merchantOrgId, note: note.length > 0 ? note : null, photoIds: draft.photos.map((p) => p.id) };
}
