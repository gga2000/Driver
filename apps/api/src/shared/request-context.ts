import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * The request id of the HTTP call being served, kept for the life of the request (every `await` inside
 * it) so the logger can stamp it on each line. A caller may send `x-request-id` (the e2e script does,
 * one prefix per flow); otherwise one is generated. Work that outlives the request (outbox subscribers,
 * queued jobs) runs without one.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

interface RequestContext {
  readonly requestId: string;
  /** Background work (a queued job, an outbox delivery), not a phone waiting on an answer. */
  readonly background?: boolean;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The current request's id, or undefined outside a request. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Runs `fn` with `requestId` as the current request id. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** Runs `fn` as background work with `id` stamped on its log lines (a queued job, an outbox delivery). */
export function runAsBackground<T>(id: string, fn: () => T): T {
  return storage.run({ requestId: id, background: true }, fn);
}

/**
 * Whether the code running now serves an HTTP request (someone is waiting: short database limits)
 * or is background work (jobs, sweeps, outbox deliveries, boot: long limits). Anything outside a
 * request (an interval sweep, a timer) counts as background.
 */
export function workKind(): 'request' | 'background' {
  const ctx = storage.getStore();
  return ctx && !ctx.background ? 'request' : 'background';
}

// Printable ASCII, no spaces, bounded: a header value never becomes a log-injection vector.
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** The incoming header when it is a sane id, a fresh UUID otherwise. */
export function requestIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && SAFE_ID.test(value) ? value : randomUUID();
}

interface Req {
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  setHeader(name: string, value: string): unknown;
}

/** Express middleware: reads or makes the id, echoes it on the response, runs the rest of the chain inside it. */
export function requestIdMiddleware(req: Req, res: Res, next: () => void): void {
  const requestId = requestIdFrom(req.headers[REQUEST_ID_HEADER]);
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequestId(requestId, next);
}
