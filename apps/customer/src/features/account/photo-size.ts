/** A gate photo only needs to show the door: about 200 KB instead of the camera's 1.5–3 MB on mobile data. */
export const PHOTO_LONG_SIDE_PX = 1280;

/** The resize that brings the longer side down to `max` (null when the photo is already small enough or its size is unknown). */
export function fitLongSide(width: number, height: number, max = PHOTO_LONG_SIDE_PX): { width: number } | { height: number } | null {
  if (!(width > 0 && height > 0) || Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}
