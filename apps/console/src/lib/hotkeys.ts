'use client';

import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts (K-07). A binding is a key spec: `"j"`, `"shift+/"`, `"mod+k"` (⌘ on a Mac,
 * Ctrl elsewhere), `"mod+enter"`, or a two-key sequence `"g s"` (press g, then s within 1 s).
 * Plain-key bindings never fire while the person is typing in a field; `mod+` bindings do (so ⌘K
 * and ⌘Enter work from the composer). Pure parts are exported for tests.
 */

export interface KeySpec {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  slash: '/',
  question: '?',
  space: ' ',
};

export function parseKey(spec: string): KeySpec {
  const parts = spec.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  return {
    key: ALIASES[key] ?? key,
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  };
}

/** Latin letter for an event, also on an Arabic keyboard layout (e.code `KeyJ` → `j`). */
export function eventKey(e: KeyLike): string {
  if (e.code && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (e.code === 'Slash') return '/';
  return e.key.toLowerCase();
}

export function matches(e: KeyLike, spec: KeySpec, isMac: boolean): boolean {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== spec.mod) return false;
  if (e.altKey !== spec.alt) return false;
  const k = eventKey(e);
  // "?" is shift+/ on most layouts: accept either spelling.
  if (spec.key === '?') return k === '?' || (k === '/' && e.shiftKey);
  if (e.shiftKey !== spec.shift) return false;
  return k === spec.key;
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const node = el as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((node as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return node.isContentEditable === true;
}

/** Next index in a list for j/k: clamps at the ends, starts at 0 (or the end) when nothing is selected. */
export function stepIndex(current: number, length: number, delta: 1 | -1): number {
  if (length === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.min(length - 1, Math.max(0, current + delta));
}

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

/**
 * Binds `map` on window while mounted (latest handlers always used). Sequences ("g s") wait 1 s for
 * the second key. `enabled: false` pauses the bindings (e.g. while a dialog is open).
 */
export function useHotkeys(map: HotkeyMap, opts: { enabled?: boolean } = {}) {
  const ref = useRef(map);
  ref.current = map;
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled) return;
    const isMac =
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    let pending: { first: string; at: number } | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const typing = isTypingTarget(e.target);
      const entries = Object.entries(ref.current);
      // Two-key sequences.
      if (pending && Date.now() - pending.at < 1000 && !typing) {
        for (const [spec, fn] of entries) {
          const seq = spec.split(' ');
          if (
            seq.length === 2 &&
            seq[0] === pending.first &&
            matches(e, parseKey(seq[1]!), isMac)
          ) {
            pending = null;
            e.preventDefault();
            fn(e);
            return;
          }
        }
      }
      pending = null;
      for (const [spec, fn] of entries) {
        const seq = spec.split(' ');
        if (seq.length === 2) {
          if (!typing && matches(e, parseKey(seq[0]!), isMac))
            pending = { first: seq[0]!, at: Date.now() };
          continue;
        }
        const k = parseKey(spec);
        if (typing && !k.mod && k.key !== 'escape') continue;
        if (matches(e, k, isMac)) {
          e.preventDefault();
          fn(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** "⌘K" on a Mac, "Ctrl K" elsewhere — for hints. */
export function modLabel(): string {
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return isMac ? '⌘' : 'Ctrl';
}
