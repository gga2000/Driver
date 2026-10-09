/**
 * Day-one d02: a screen that fails keeps the app around it (tabs, rail, the orders board) and fixes
 * itself when it can. Plain Node, tested.
 */

/** The web build loads each screen's code on first use; with no net that load fails like this. */
export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : '';
  return name === 'AsyncRequireError' || name === 'ChunkLoadError' || /Loading module .* failed|Failed to fetch dynamically imported module|Loading chunk .* failed/i.test(message);
}

export type TroubleStep = 'wait' | 'retry' | 'reload';

/**
 * What the screen's own error card does next: while the net is down it waits (and says so); once it is
 * back it tries again by itself — a render error re-renders the screen, while a screen whose code never
 * arrived on the web reloads the page (the browser remembers a failed load, so re-rendering can't fix it).
 */
export function troubleStep(p: { chunk: boolean; online: boolean; web: boolean }): TroubleStep {
  if (!p.online) return 'wait';
  return p.chunk && p.web ? 'reload' : 'retry';
}
