/**
 * What the device says about its network — web and tests: `navigator.onLine` and the window's
 * `online` / `offline` events (instant in every browser). Native resolves `device.native.ts` (NetInfo).
 */
export function deviceOnlineNow(): boolean {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  return nav?.onLine !== false;
}

export function subscribeDevice(onChange: (online: boolean) => void): () => void {
  const w = globalThis as {
    addEventListener?: (type: string, fn: () => void) => void;
    removeEventListener?: (type: string, fn: () => void) => void;
  };
  if (typeof w.addEventListener !== 'function' || typeof w.removeEventListener !== 'function') return () => undefined;
  const on = () => onChange(true);
  const off = () => onChange(false);
  w.addEventListener('online', on);
  w.addEventListener('offline', off);
  return () => {
    w.removeEventListener?.('online', on);
    w.removeEventListener?.('offline', off);
  };
}
