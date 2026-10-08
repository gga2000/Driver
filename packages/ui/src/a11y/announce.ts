import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Says `text` to the screen reader when it changes (REL-17). Android and the web already read an
 * `accessibilityLiveRegion` / `aria-live` element; iOS VoiceOver ignores live regions, so there the
 * new text is announced explicitly. The first value is not announced (the screen just opened and
 * VoiceOver reads it in order) unless `initial` is set, for a card or toast that appears by itself.
 */
export function useAnnounce(text: string | null | undefined, { enabled = true, initial = false }: { enabled?: boolean; initial?: boolean } = {}): void {
  const last = useRef(initial ? null : text);
  useEffect(() => {
    const prev = last.current;
    last.current = text;
    if (!enabled || !text || text === prev || !shouldAnnounce(Platform.OS)) return;
    AccessibilityInfo.announceForAccessibility?.(text);
  }, [text, enabled]);
}

/** Only iOS needs the explicit announcement; elsewhere it would be read twice. */
export function shouldAnnounce(os: string): boolean {
  return os === 'ios';
}
