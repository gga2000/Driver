'use client';

import { useEffect, useRef, useState } from 'react';
import { isTypingTarget, stepIndex, useHotkeys } from './hotkeys';

/** Enter opens the highlighted row only when focus is on the page itself, not on a control. */
export function rowEnterTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return true;
  if (isTypingTarget(el)) return false;
  return !(el as HTMLElement).closest('button, a, select, summary, [role=button], [role=tab], [role=radio], [role=option], dialog');
}

/**
 * j/k move a highlight through a table's rows and Enter opens the highlighted one (the lists on
 * /orders and /drivers); Escape drops the highlight. The highlighted row is the DataTable's
 * `activeKey` and is scrolled into view as it moves. Letters never fire while the person types in
 * a field, and Enter and Escape keep their usual meaning on buttons, links and dialogs.
 */
export function useRowKeys<T>(rows: readonly T[], keyOf: (row: T) => string, onOpen: (row: T) => void, enabled = true) {
  const [active, setActive] = useState<string | null>(null);
  const latest = useRef({ rows, keyOf, onOpen, active });
  latest.current = { rows, keyOf, onOpen, active };
  const move = (d: 1 | -1) => {
    const i = active === null ? -1 : rows.findIndex((r) => keyOf(r) === active);
    const next = rows[stepIndex(i, rows.length, d)];
    if (next) setActive(keyOf(next));
  };
  useHotkeys({ j: () => move(1), k: () => move(-1) }, { enabled });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const { rows: list, keyOf: key, onOpen: open, active: cur } = latest.current;
      if (cur === null || e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!rowEnterTarget(e.target)) return;
      if (e.key === 'Escape') setActive(null);
      else if (e.key === 'Enter') {
        const row = list.find((r) => key(r) === cur);
        if (row) {
          e.preventDefault();
          open(row);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
  useEffect(() => {
    if (active === null) return;
    document.querySelector('tr[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return [active, setActive] as const;
}
