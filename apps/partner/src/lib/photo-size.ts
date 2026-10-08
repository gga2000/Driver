/** Speed d3: a phone photo is 3,000–4,000 px; this long side keeps faces and plates sharp at ~200 KB. */
export const PHOTO_LONG_SIDE_PX = 1280;
/** Documents (licence, registration) keep more detail so the small print stays readable in the Console. */
export const DOCUMENT_LONG_SIDE_PX = 1600;

/** The resize for a photo bigger than `max` on its long side; null when it is already small enough. */
export function fitLongSide(width: number, height: number, max = PHOTO_LONG_SIDE_PX): { width: number } | { height: number } | null {
  if (!(width > 0 && height > 0) || Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}
