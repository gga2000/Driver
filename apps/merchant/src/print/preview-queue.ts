import type { PrintJob } from './doc';

/**
 * The ticket currently shown in the on-screen preview (null = closed). The web printer pushes
 * every ticket here; on any platform "شوف الوصل" pushes one too. `PrintJobPreview` renders it.
 */
type Listener = () => void;

let current: PrintJob | null = null;
const listeners = new Set<Listener>();

export const previewQueue = {
  get: (): PrintJob | null => current,
  show(r: PrintJob) {
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
