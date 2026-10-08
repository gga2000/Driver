import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { DriverError } from '@driver/contracts';

/**
 * x3 (speed round four): one web machine takes at most `MAX_INFLIGHT_REQUESTS` calls at once (default
 * 50). Past that the server used to keep queueing until its heap passed the 1.5 GB cap and the machine
 * restarted, failing everyone. Now a call beyond the cap is answered at once with `server_busy` (HTTP
 * 503, `Retry-After: 1`) before it touches the database; the apps retry such a call by themselves after
 * a second (`classifyError` → busy), so on a record night a few people wait a moment instead.
 *
 * Not counted and never refused: live streams (`text/event-stream`, they stay open for minutes) and
 * `health.*` (Fly must still see a busy machine as alive). `0` or `off` turns the cap off.
 */
export const DEFAULT_MAX_INFLIGHT = 50;
export const BUSY_RETRY_AFTER_SEC = 1;

export function maxInflightFromEnv(raw: string | undefined): number {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return DEFAULT_MAX_INFLIGHT;
  if (v === 'off') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`MAX_INFLIGHT_REQUESTS must be a whole number or "off" (got "${raw}")`);
  return n;
}

const overCap = new AsyncLocalStorage<boolean>();

/** For the procedure gate: the refusal for a call that arrived while this machine was full. */
export function busyRefusal(path: string): DriverError | null {
  if (!overCap.getStore() || path.startsWith('health.')) return null;
  return new DriverError('server_busy', { retryAfterSec: BUSY_RETRY_AFTER_SEC });
}

/**
 * Never counted, never refused: `health.*`, and live streams. A stream is told apart by its
 * `Accept: text/event-stream` (browsers, the apps' XHR and fetch EventSources) and, should a client
 * ever leave that out, by its path (`live.*` except the `live.token` query): an uncounted stream is
 * harmless, a counted one would hold a slot for minutes.
 */
function exempt(req: Request): boolean {
  if (String(req.headers.accept ?? '').includes('text/event-stream')) return true;
  // Mounted at /trpc: the path is `/health.live`, or a batch `/health.live,health.ready`.
  const paths = req.path.replace(/^\//, '').split(',');
  return paths.every((p) => p.startsWith('health.')) || (paths.length === 1 && paths[0]!.startsWith('live.') && paths[0] !== 'live.token');
}

export interface BusyCap {
  (req: Request, res: Response, next: NextFunction): void;
  /** Calls being served now (for tests and the metrics wall). */
  inflight(): number;
}

/** The Express middleware: counts calls in flight and marks the ones beyond the cap. */
export function createBusyCap(max: number = maxInflightFromEnv(process.env['MAX_INFLIGHT_REQUESTS'])): BusyCap {
  let inflight = 0;
  const cap = ((req: Request, res: Response, next: NextFunction) => {
    if (max <= 0 || exempt(req)) return next();
    if (inflight >= max) {
      res.setHeader('Retry-After', String(BUSY_RETRY_AFTER_SEC));
      // Not counted: it is refused at the first procedure step, before any database work (the request
      // log and metrics still see it, as SERVICE_UNAVAILABLE / server_busy).
      return overCap.run(true, next);
    }
    inflight += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inflight -= 1;
    };
    // `finish` when the answer went out, `close` when the caller hung up first: either frees the slot.
    res.once('finish', release);
    res.once('close', release);
    overCap.run(false, next);
  }) as BusyCap;
  cap.inflight = () => inflight;
  return cap;
}
