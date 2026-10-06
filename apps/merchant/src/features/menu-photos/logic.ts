import { MENU_PHOTO_RULES, OPEN_MENU_PHOTO_STATES, type AdminMenu, type MenuPhotoDish, type MenuPhotoRequestState, type MenuPhotoRequestView, type RequestMenuPhotosInput } from '@driver/contracts';

/**
 * «تصوير المنيو» as plain data (no React Native, unit-tested): the request form's draft and its one
 * API call, the four status steps the owner follows, and which photos still wait for his yes or no.
 */

/** The four steps on the status card: طلبنا · موعد التصوير · تصوّرت · خلص. */
export const STATUS_STEPS = ['requested', 'scheduled', 'shot', 'done'] as const satisfies readonly MenuPhotoRequestState[];

/** Where the request is on those steps; null for a cancelled one (it shows its own line instead). */
export function stepIndex(state: MenuPhotoRequestState): number | null {
  const i = STATUS_STEPS.findIndex((s) => s === state);
  return i === -1 ? null : i;
}

export function isOpen(state: MenuPhotoRequestState): boolean {
  return OPEN_MENU_PHOTO_STATES.includes(state);
}

/** The request still running (one per store at most), and the closed ones under it. */
export function splitRequests(list: readonly MenuPhotoRequestView[]): { current: MenuPhotoRequestView | null; past: MenuPhotoRequestView[] } {
  const current = list.find((r) => isOpen(r.state)) ?? null;
  return { current, past: list.filter((r) => r !== current) };
}

export interface RequestDraft {
  wholeMenu: boolean;
  /** Picked dishes (when not the whole menu). */
  itemIds: string[];
  note: string;
}

export const EMPTY_DRAFT: RequestDraft = { wholeMenu: true, itemIds: [], note: '' };

/** Picks or un-picks a dish; past the limit nothing more is added. */
export function toggleDish(draft: RequestDraft, itemId: string): RequestDraft {
  if (draft.itemIds.includes(itemId)) return { ...draft, itemIds: draft.itemIds.filter((id) => id !== itemId) };
  if (draft.itemIds.length >= MENU_PHOTO_RULES.maxItems) return draft;
  return { ...draft, itemIds: [...draft.itemIds, itemId] };
}

/** The note cut to what the API accepts, so typing past the limit simply stops. */
export function withNote(draft: RequestDraft, note: string): RequestDraft {
  return { ...draft, note: note.slice(0, MENU_PHOTO_RULES.noteMaxChars) };
}

export function canSubmit(draft: RequestDraft): boolean {
  return draft.wholeMenu || draft.itemIds.length > 0;
}

/** Dishes without a photo first: those are the ones customers skip. */
export function menuDishes(menu: AdminMenu | undefined): Array<{ id: string; nameAr: string; photoUrl: string | null }> {
  const all = (menu?.categories ?? []).flatMap((c) => c.items.map((i) => ({ id: i.id, nameAr: i.nameAr, photoUrl: i.photoUrl })));
  return [...all.filter((d) => !d.photoUrl), ...all.filter((d) => d.photoUrl)];
}

/** The one `request` call: no dishes = the whole menu, a blank note is none. */
export function toRequestInput(merchantOrgId: string, draft: RequestDraft): RequestMenuPhotosInput {
  const note = draft.note.trim();
  return { merchantOrgId, itemIds: draft.wholeMenu ? [] : [...draft.itemIds], ...(note ? { note } : {}) };
}

/** Photos handed over and waiting for the owner. */
export function waitingDishes(view: MenuPhotoRequestView): MenuPhotoDish[] {
  return view.state === 'shot' ? view.dishes.filter((d) => d.shot?.state === 'proposed') : [];
}

/** Dishes with a photo from this visit (any decision), in menu order: the review list. */
export function shotDishes(view: MenuPhotoRequestView): MenuPhotoDish[] {
  return view.dishes.filter((d) => d.shot !== null);
}

/** The owner may still call it off: before the photos are handed over. */
export function canCancel(view: MenuPhotoRequestView): boolean {
  return view.canAct && (view.state === 'requested' || view.state === 'scheduled');
}
