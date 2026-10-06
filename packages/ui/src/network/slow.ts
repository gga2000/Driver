/**
 * Is the connection slow or metered-and-saving? Web: the Network Information API (`saveData`, or an
 * effective type of 2G/3G). Browsers without it say nothing (not slow). Native resolves `slow.native.ts`.
 */
interface NetInfoLike {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: 'change', fn: () => void) => void;
  removeEventListener?: (type: 'change', fn: () => void) => void;
}

const SLOW_TYPES = new Set(['slow-2g', '2g', '3g']);

function connection(): NetInfoLike | null {
  const nav = (globalThis as { navigator?: { connection?: NetInfoLike } }).navigator;
  return nav?.connection ?? null;
}

function slowNow(): boolean {
  const c = connection();
  return Boolean(c && (c.saveData || (c.effectiveType && SLOW_TYPES.has(c.effectiveType))));
}

export function subscribeSlow(onChange: (slow: boolean) => void): () => void {
  onChange(slowNow());
  const c = connection();
  if (!c?.addEventListener || !c.removeEventListener) return () => undefined;
  const fn = () => onChange(slowNow());
  c.addEventListener('change', fn);
  return () => c.removeEventListener?.('change', fn);
}
