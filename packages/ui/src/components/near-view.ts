import { useEffect, useRef, useState, type RefObject } from 'react';
import { Platform, type View } from 'react-native';

/** How far ahead of the screen a photo starts loading: about one more screen of scrolling. */
export const NEAR_VIEW_MARGIN = '600px';

/**
 * Speed w2 (Ali, 2026-10-08): true once the view is on screen or about to scroll onto it, and from
 * then on. Web only: on a phone it is true at once (photos there come from the app or its disk cache,
 * and long lists already draw only what's near). Without IntersectionObserver (old browsers, tests)
 * it is true at once too, so nothing ever stays empty.
 */
export function useNearView(eager = false): { ref: RefObject<View | null>; near: boolean } {
  const ref = useRef<View | null>(null);
  const watch = !eager && Platform.OS === 'web' && typeof IntersectionObserver !== 'undefined';
  const [near, setNear] = useState(!watch);
  useEffect(() => {
    if (!watch || near) return;
    const node = ref.current as unknown as Element | null;
    if (!node) {
      setNear(true);
      return;
    }
    // The closest scrolling box is the root, so photos inside a sideways row wait for it too.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: NEAR_VIEW_MARGIN },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [watch, near]);
  return { ref, near };
}
