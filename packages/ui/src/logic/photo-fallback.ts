import { useCallback, useState } from 'react';

/**
 * Photos from the API are signed links that expire (about an hour): a cart or a screen kept from an
 * earlier session can hold one that no longer loads. Instead of a broken image the component falls
 * back to what it shows without a photo (the drawn dish, the person's initial). Only the link that
 * failed is dropped, so a fresh link for the same photo (a refetch) is tried again.
 */
export function shownPhoto(uri: string | null | undefined, failed: string | null): string | null {
  return uri && uri !== failed ? uri : null;
}

/** `uri` to render (null once it failed to load) and the `onError` to put on the `Image`. */
export function usePhotoFallback(uri: string | null | undefined): { uri: string | null; onError: () => void } {
  const [failed, setFailed] = useState<string | null>(null);
  const onError = useCallback(() => setFailed(uri ?? null), [uri]);
  return { uri: shownPhoto(uri, failed), onError };
}
