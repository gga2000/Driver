import { useCallback, useEffect, useRef, useState } from 'react';
import type { View } from 'react-native';
import { usePageScroll } from '@/components/Page';

/**
 * A zone tapped on the map is found in the list too: the list's rows register here by key, and
 * `revealRow(key)` scrolls the page to that row once the screen has re-rendered with the new pick
 * (the zone card above the list may change height first). A row already on screen — the list
 * beside the map on a wide tablet — is left where it is; the highlight alone shows the pick.
 */
export function useRowReveal(): { rowRef: (key: string) => (node: View | null) => void; revealRow: (key: string) => void } {
  const page = usePageScroll();
  const rows = useRef(new Map<string, View>());
  // A fresh object per request so tapping the same zone twice still scrolls back to it.
  const [pending, setPending] = useState<{ key: string } | null>(null);
  // Each request scrolls once: a later viewport change (rotation) must not pull the page back to it.
  const handled = useRef<{ key: string } | null>(null);

  useEffect(() => {
    if (!pending || !page || handled.current === pending) return;
    handled.current = pending;
    const node = rows.current.get(pending.key);
    if (node) page.reveal(node);
  }, [pending, page]);

  const rowRef = useCallback(
    (key: string) => (node: View | null) => {
      if (node) rows.current.set(key, node);
      else rows.current.delete(key);
    },
    [],
  );
  const revealRow = useCallback((key: string) => setPending({ key }), []);
  return { rowRef, revealRow };
}
