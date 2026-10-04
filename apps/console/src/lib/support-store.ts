'use client';

import { useSyncExternalStore } from 'react';
import { isSupportView, type SupportView } from './support-views';

/**
 * Desk state shared by the sidebar (nested views), the command palette ("تذكرة جديدة") and the
 * support desk: the current smart view (remembered per browser) and a one-shot "open the new-ticket
 * dialog" request.
 */

const KEY = 'driver.console.support.view';
let view: SupportView | null = null;
let newTicket = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

function current(): SupportView {
  if (view) return view;
  try {
    const v = window.localStorage.getItem(KEY);
    view = isSupportView(v) ? v : 'open';
  } catch {
    view = 'open';
  }
  return view;
}

export function setSupportView(v: SupportView) {
  view = v;
  try {
    window.localStorage.setItem(KEY, v);
  } catch {
    /* remembered for this visit only */
  }
  emit();
}

export function useSupportView(): SupportView {
  return useSyncExternalStore(subscribe, current, () => 'open');
}

export function requestNewTicket() {
  newTicket += 1;
  emit();
}

/** Increments each time someone asks for the new-ticket dialog. */
export function useNewTicketRequests(): number {
  return useSyncExternalStore(
    subscribe,
    () => newTicket,
    () => 0,
  );
}
