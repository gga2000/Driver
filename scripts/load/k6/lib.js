// Shared helpers for the launch load test (scripts/load/k6/launch.js).
//
// The API speaks tRPC with superjson, the same wire format the apps use:
//   queries    GET  /trpc/a,b?batch=1&input={"0":{"json":…},"1":{"json":…}}
//   mutations  POST /trpc/a?batch=1           body {"0":{"json":…}}
//   streams    GET  /trpc/live.order?input={"json":…}&connectionParams={"streamToken":…}   (SSE)
//
// Every virtual user signs in as its own load person: tokens.json (written by prepare.mjs, never
// printed, never uploaded) holds refresh tokens, one per session. A refresh token rotates on every use
// and reusing an old one ends the session, so no two virtual users (or app visits) ever share one:
// each scenario takes its own slice of the sessions, indexed by its iteration number.
import http from 'k6/http';
import { check, fail } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { Rate, Trend, Counter } from 'k6/metrics';
import { runPlan } from './profiles.js';

export const BASE = (__ENV.LOAD_API_URL || 'http://localhost:3999/trpc').replace(/\/$/, '');
const TOKENS_FILE = __ENV.LOAD_TOKENS || './tokens.json';
const WORLD_FILE = __ENV.LOAD_WORLD || './world.json';

export const customers = new SharedArray('customers', () => JSON.parse(open(TOKENS_FILE)).customers);
export const merchants = new SharedArray('merchants', () => JSON.parse(open(TOKENS_FILE)).merchants);
export const world = JSON.parse(open(WORLD_FILE));

export const PLAN = runPlan(__ENV.LOAD_PROFILE || 'smoke', { k: __ENV.LOAD_K, duration: __ENV.LOAD_DURATION });

/** Anything but a success, except (at 3×) a 503 that sheds load; a listed status (a race the app expects) is fine. */
const bad = new Rate('bad_responses');
const shed = new Trend('shed_ms', true);
const shedWithoutRetryAfter = new Counter('shed_without_retry_after');

let badLogged = 0;
function errorCode(res) {
  try {
    const b = res.json();
    const e = Array.isArray(b) ? b[0] && b[0].error : b && b.error;
    return (e && e.json && e.json.data && e.json.data.code) || '';
  } catch {
    return '';
  }
}

function note(res, flow, okStatuses) {
  const ok = res.status === 200 || (okStatuses && okStatuses.includes(res.status));
  if (res.status === 503) {
    shed.add(res.timings.duration, { flow });
    if (!res.headers['Retry-After']) shedWithoutRetryAfter.add(1, { flow });
  }
  const isBad = !ok && !(PLAN.shedding && res.status === 503);
  bad.add(isBad, { flow });
  if (isBad && badLogged < 20) {
    // The API's error code only (never the body: it can echo input).
    badLogged += 1;
    console.warn(`bad response: ${flow} HTTP ${res.status} ${errorCode(res)}`);
  }
  check(res, { [`${flow} ok`]: () => ok });
}

/** Access tokens last 15 minutes; refresh well before that. */
const REFRESH_EVERY_MS = 10 * 60_000;

let seq = 0;
function requestId(flow) {
  seq += 1;
  return `load-${flow}-${exec.vu.idInTest}-${seq}`;
}

function headers(flow, token) {
  const h = { 'x-request-id': requestId(flow), 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

/** Plain JSON → superjson envelope. Load inputs carry no Dates, so `meta` is never needed. */
const wrap = (json) => ({ json });

function batchInput(inputs) {
  const o = {};
  inputs.forEach((v, i) => {
    o[i] = wrap(v === undefined ? null : v);
  });
  return o;
}

/** Unwraps a batch response; returns `null` entries for errors (k6 already counted the status). */
function unwrap(res, n) {
  let body;
  try {
    body = res.json();
  } catch {
    return new Array(n).fill(null);
  }
  if (!Array.isArray(body)) return new Array(n).fill(null);
  return body.map((r) => (r && r.result && r.result.data ? r.result.data.json : null));
}

/** One batched GET of queries, the way the app's httpBatchLink sends them. */
export function queryRequest(flow, token, calls) {
  const procs = calls.map((c) => c[0]).join(',');
  const input = encodeURIComponent(JSON.stringify(batchInput(calls.map((c) => c[1]))));
  return {
    method: 'GET',
    url: `${BASE}/${procs}?batch=1&input=${input}`,
    params: { headers: headers(flow, token), tags: { flow, name: `${BASE}/${flow}` } },
  };
}

export function query(flow, token, calls) {
  const r = queryRequest(flow, token, calls);
  const res = http.get(r.url, r.params);
  note(res, flow);
  return { res, data: unwrap(res, calls.length) };
}

/** Several batches in parallel (the app fires its home queries in 2–3 batches at once). */
export function queryParallel(flow, token, batches) {
  const reqs = batches.map((calls) => queryRequest(flow, token, calls));
  const out = http.batch(reqs);
  out.forEach((res) => note(res, flow));
  return out.map((res, i) => ({ res, data: unwrap(res, batches[i].length) }));
}

export function mutate(flow, token, proc, input, okStatuses) {
  const res = http.post(`${BASE}/${proc}?batch=1`, JSON.stringify(batchInput([input])), {
    headers: headers(flow, token),
    tags: { flow, name: `${BASE}/${proc}` },
  });
  note(res, flow, okStatuses);
  return { res, data: unwrap(res, 1)[0] };
}

/**
 * A signed-in person for this virtual user. Refreshes on first use and every 10 minutes; the new
 * refresh token replaces the old one in memory only.
 */
export function session(kind, index) {
  const pool = kind === 'merchant' ? merchants : customers;
  if (index >= pool.length) {
    fail(`not enough ${kind} load accounts: need #${index + 1}, prepared ${pool.length} (run prepare.mjs with more)`);
  }
  const seed = pool[index];
  let refreshToken = seed.refreshToken;
  let access = null;
  let at = 0;
  return {
    personId: seed.personId,
    orgId: seed.orgId,
    token() {
      if (access && Date.now() - at < REFRESH_EVERY_MS) return access;
      const res = http.post(
        `${BASE}/identity.refresh?batch=1`,
        JSON.stringify(batchInput([{ refreshToken }])),
        { headers: headers('refresh', null), tags: { flow: 'refresh', name: `${BASE}/identity.refresh` } },
      );
      const data = unwrap(res, 1)[0];
      note(res, 'refresh');
      if (res.status !== 200 || !data || !data.accessToken) {
        fail(`refresh failed for a ${kind} load account (HTTP ${res.status}); re-run prepare.mjs before each run`);
      }
      access = data.accessToken;
      refreshToken = data.refreshToken;
      at = Date.now();
      return access;
    },
  };
}

export const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
export const sleepJitter = (s) => s * (0.8 + Math.random() * 0.4);
