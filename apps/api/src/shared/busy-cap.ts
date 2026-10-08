import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { DriverError } from '@driver/contracts';

/**
 * x3 (speed round four): one web machine serves at most `MAX_INFLIGHT_REQUESTS` requests at once
 * (default 50). Past that the server used to keep queueing until its heap passed the 1.5 GB cap and the machine
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

/**
 * One HTTP request's place in the count. A request is counted only when the procedure gate first runs,
 * and the gate waits until the call's input has fully arrived (`publicProcedure` in contracts reads it
 * first): a caller that sends its headers and then stalls the body never holds a slot, so slow or
 * stalled uploads cannot lock everyone else out.
 */
interface Slot {
  state: { inflight: number; max: number };
  res: Response;
  counted: boolean;
  refused: boolean;
  closed: boolean;
}

const slots = new AsyncLocalStorage<Slot>();

/**
 * For the procedure gate, at the start of every call: counts the request on its first call, or, when
 * the machine is already full, refuses it (every call in a refused batch gets the same answer).
 */
export function busyRefusal(path: string): DriverError | null {
  const slot = slots.getStore();
  if (!slot || slot.counted || path.startsWith('health.')) return null;
  if (!slot.refused && slot.state.inflight < slot.state.max) {
    // A caller who already hung up is not counted (its `close` has fired; nothing would release it).
    if (!slot.closed) {
      slot.counted = true;
      slot.state.inflight += 1;
    }
    return null;
  }
  if (!slot.refused) {
    slot.refused = true;
    if (!slot.res.headersSent) slot.res.setHeader('Retry-After', String(BUSY_RETRY_AFTER_SEC));
  }
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
  /** Requests being served now (for tests and the metrics wall). */
  inflight(): number;
}

/** The Express middleware: gives each request its slot; the procedure gate counts or refuses it. */
export function createBusyCap(max: number = maxInflightFromEnv(process.env['MAX_INFLIGHT_REQUESTS'])): BusyCap {
  const state = { inflight: 0, max };
  const cap = ((req: Request, res: Response, next: NextFunction) => {
    if (max <= 0 || exempt(req)) return next();
    const slot: Slot = { state, res, counted: false, refused: false, closed: false };
    // `finish` when the answer went out, `close` when the caller hung up first: either frees the slot.
    const release = () => {
      slot.closed = true;
      if (!slot.counted) return;
      slot.counted = false;
      state.inflight -= 1;
    };
    res.once('finish', release);
    res.once('close', release);
    slots.run(slot, next);
  }) as BusyCap;
  cap.inflight = () => state.inflight;
  return cap;
}
