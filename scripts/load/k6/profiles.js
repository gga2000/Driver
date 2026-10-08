// Load-test sizes (plan §7.1), shared by the k6 script and prepare.mjs (plain JS: k6 and Node both load it).
//
// "k" multiplies the app-visit rate: at 1× a visit every 1.33 s (0.75 home opens/s, 0.5 menus/s,
// 0.25 searches/s, 0.25 orders/s). `live` is the live orders being watched, `streams` how many of them
// have the tracking stream open.

// §7.1 pass numbers. At 3× the API may refuse work (503), but quickly and with Retry-After.
const COMMON = {
  home_open: ['p(95)<800'],
  'http_req_duration{flow:menu}': ['p(95)<600'],
  'http_req_duration{flow:place}': ['p(95)<1000'],
  bad_responses: ['rate<0.001'],
  sse_open_failed: ['count==0'],
};

export const PROFILES = {
  smoke: { k: 0.2, duration: '3m', live: 20, streams: 10, shedding: false, thresholds: COMMON },
  '1x': { k: 1, duration: '2h', live: 225, streams: 112, shedding: false, thresholds: COMMON },
  '2x': { k: 2, duration: '1h', live: 450, streams: 250, shedding: false, thresholds: { ...COMMON, sse_connect: ['p(95)<1000'] } },
  '3x': {
    k: 3,
    duration: '15m',
    live: 675,
    streams: 336,
    shedding: true,
    thresholds: { bad_responses: ['rate<0.001'], shed_ms: ['p(95)<100'], shed_without_retry_after: ['count==0'], sse_open_failed: ['count==0'] },
  },
};

/** App visits per minute at k = 1. */
const VISITS_PER_MIN_1X = 45;

export function parseDuration(s) {
  const m = /^(\d+)(s|m|h)$/.exec(String(s));
  if (!m) throw new Error(`LOAD_DURATION must look like 90s, 15m or 2h (got ${s})`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];
}

/**
 * The run's shape. Customer sessions are used once each (a refresh token rotates on use): first the
 * live orders without a stream, then those with one, then one per app visit (+5 % for uneven arrivals).
 */
export function runPlan(name, overrides = {}) {
  const p = PROFILES[name];
  if (!p) throw new Error(`LOAD_PROFILE must be one of ${Object.keys(PROFILES).join(', ')} (got ${name})`);
  const k = overrides.k ? Number(overrides.k) : p.k;
  const durationS = parseDuration(overrides.duration || p.duration);
  if (!(k > 0 && k <= 10)) throw new Error(`LOAD_K must be between 0 and 10 (got ${overrides.k})`);
  const visitsPerMin = Math.max(1, Math.round(VISITS_PER_MIN_1X * k));
  const live = Math.max(0, p.live - p.streams);
  const streams = p.streams;
  const visitSessions = Math.ceil(visitsPerMin * (durationS / 60) * 1.05) + 20;
  return {
    name,
    k,
    durationS,
    visitsPerMin,
    live,
    streams,
    shedding: p.shedding,
    thresholds: p.thresholds,
    offsets: { live: 0, streams: live, visits: live + streams },
    sessions: live + streams + visitSessions,
  };
}
