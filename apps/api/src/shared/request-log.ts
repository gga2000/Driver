import type { NextFunction, Request, Response } from 'express';
import { observeProcedures, type ProcedureCall } from '@driver/contracts/router';
import { currentRequestId, REQUEST_ID_HEADER, requestIdFrom } from './request-context.js';
import type { Metrics } from './metrics.js';

/** One request-log line: what was asked, by whom (pseudonymous), how it ended and how long it took. Never inputs or phones. */
export interface RequestLogLine {
  requestId: string;
  method: string;
  /** The procedures in the URL (one, or several for a batch). */
  procedures: string[];
  batch: number;
  status: number;
  ms: number;
  /** The signed-in person's id, when a procedure saw one. */
  personId?: string;
  /** Each procedure's result, when it is not plain success. */
  failed?: Array<{ procedure: string; code: string; driverCode?: string }>;
  /** A live stream (SSE): `ms` is how long it stayed open. */
  stream?: true;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The procedures of a tRPC URL path (`/orders.place` or `/orders.get,catalog.home`). */
export function proceduresOf(path: string): string[] {
  const p = path.replace(/^\/+/, '').split('?')[0] ?? '';
  return p ? p.split(',').map((s) => safeDecode(s).slice(0, 100)) : [];
}

const MAX_LOGGED_PROCEDURES = 20;

/**
 * The request log (CRIT1-03, plan 7.4): one JSON line per HTTP request on /trpc, written when the
 * answer is finished (or the stream closes), plus the RED metrics per procedure. The tRPC base
 * procedure reports each call (`observeProcedures`); calls are matched to their HTTP request by the
 * request id, decided here and carried by `requestIdMiddleware` into every call of the request.
 *
 * `write` gets the line; production writes it through the app logger as JSON (`LOG_FORMAT=json`).
 */
export function createRequestLog(metrics: Metrics, write: (line: RequestLogLine) => void, now: () => number = () => performance.now()) {
  // Keyed by request id; `open` counts requests sharing an id (a caller may reuse one).
  const calls = new Map<string, { list: ProcedureCall[]; open: number }>();

  observeProcedures((call) => {
    metrics.procedure(call.path, call.type, call.code, call.ms);
    const id = currentRequestId();
    if (!id) return;
    calls.get(id)?.list.push(call);
  });

  return function requestLog(req: Request, res: Response, next: NextFunction): void {
    const started = now();
    // Decide the id here (the same rule as requestIdMiddleware, which then reads it back from the
    // header), so the calls of this request can be collected under it from the start.
    const id = requestIdFrom(req.headers[REQUEST_ID_HEADER]);
    req.headers[REQUEST_ID_HEADER] = id;
    const entry = calls.get(id) ?? { list: [], open: 0 };
    entry.open++;
    calls.set(id, entry);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const seen = entry.list;
      if (--entry.open === 0) calls.delete(id);
      const procedures = proceduresOf(req.path);
      const failed = seen.filter((c) => c.code !== 'OK').map((c) => ({ procedure: c.path, code: c.code, ...(c.driverCode ? { driverCode: c.driverCode } : {}) }));
      const personId = seen.find((c) => c.personId)?.personId ?? undefined;
      const stream = String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream');
      metrics.httpStatus(res.statusCode);
      write({
        requestId: id,
        method: req.method,
        procedures: procedures.slice(0, MAX_LOGGED_PROCEDURES),
        batch: procedures.length,
        status: res.statusCode,
        ms: Math.round(now() - started),
        ...(personId ? { personId } : {}),
        ...(failed.length ? { failed } : {}),
        ...(stream ? { stream: true as const } : {}),
      });
    };
    res.once('finish', finish);
    res.once('close', finish);
    next();
  };
}
