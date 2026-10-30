/**
 * p4 (Ali 2026-10-08): the owner's side of a photo Driver's team took down (pure, unit-tested). The menu
 * says why on the dish until a new photo goes up; the board says it once, on this device.
 */

export const PHOTO_DOWN_REASONS = ['blurry', 'wrong_dish', 'people', 'other'] as const;
export type PhotoDownReason = (typeof PHOTO_DOWN_REASONS)[number];

/** The server's reason, or `other` for one this build doesn't know yet. */
export function photoDownReason(reason: string): PhotoDownReason {
  return (PHOTO_DOWN_REASONS as readonly string[]).includes(reason) ? (reason as PhotoDownReason) : 'other';
}

interface ItemLike {
  id: string;
  nameAr: string;
  photoUrl: string | null;
  photoTakenDown?: { reason: string; at: Date } | null;
}

/** One take-down, as this device remembers it once «تمام» is tapped. */
export function photoDownKey(itemId: string, at: Date): string {
  return `${itemId}:${at.getTime()}`;
}

export interface PhotoDownNotice {
  key: string;
  itemId: string;
  dishName: string;
  reason: PhotoDownReason;
}

/** Take-downs the board hasn't told about on this device yet, newest first (dishes still without a photo). */
export function unseenPhotoDowns(categories: readonly { items: readonly ItemLike[] }[] | undefined, seen: readonly string[]): PhotoDownNotice[] {
  const out: (PhotoDownNotice & { at: number })[] = [];
  for (const c of categories ?? []) {
    for (const i of c.items) {
      const d = i.photoTakenDown;
      if (!d || i.photoUrl) continue;
      const key = photoDownKey(i.id, d.at);
      if (seen.includes(key)) continue;
      out.push({ key, itemId: i.id, dishName: i.nameAr, reason: photoDownReason(d.reason), at: d.at.getTime() });
    }
  }
  return out.sort((a, b) => b.at - a.at).map(({ at: _at, ...n }) => n);
}

/**
 * An item a write sent back carries no take-down (only the menu read has it): keep the one on screen
 * while the dish still has no photo, so a price change doesn't hide why the photo is gone.
 */
export function keepPhotoDown<I extends ItemLike>(before: I | undefined, next: I): I {
  if (next.photoUrl || next.photoTakenDown !== undefined || !before?.photoTakenDown) return next;
  return { ...next, photoTakenDown: before.photoTakenDown };
}
