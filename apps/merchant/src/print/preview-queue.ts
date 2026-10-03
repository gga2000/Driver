import type { Receipt } from './receipt';

/**
 * The ticket currently shown in the on-screen 80 mm preview (null = closed). The web printer pushes
 * every ticket here; on any platform "شوف الوصل" pushes one too. `ReceiptPreview` renders it.
 */
type Listener = () => void;

let current: Receipt | null = null;
const listeners = new Set<Listener>();

export const previewQueue = {
  get: (): Receipt | null => current,
  show(r: Receipt) {
    current = r;
    for (const l of listeners) l();
  },
  close() {
    current = null;
    for (const l of listeners) l();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
