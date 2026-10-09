/**
 * The slice of `fetch` the messaging providers use. Production passes the global `fetch`; tests pass
 * a fake that records requests and answers from a script, so no provider test touches the network.
 */
export interface HttpRequest {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: HttpRequest) => Promise<HttpResponse>;

/**
 * How long one provider call may take, body included. The sign-in SMS is sent inside the request, so
 * a gateway that hangs instead of failing would otherwise hold every sign-in for undici's own limit
 * (about 5 minutes). Past this it fails as a `network` error, which is already retried.
 */
export const PROVIDER_TIMEOUT_MS = 10_000;

type RawFetch = (url: string, init: RequestInit) => Promise<{ status: number; text(): Promise<string> }>;

/** `fetch` with a deadline over the whole call; the body is read before returning so it is covered too. */
export function timedFetch(timeoutMs: number, fetchFn: RawFetch = fetch): FetchLike {
  return async (url, init) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await fetchFn(url, { method: init.method, headers: init.headers, signal, ...(init.body !== undefined ? { body: init.body } : {}) });
    const body = await res.text();
    return { status: res.status, text: async () => body };
  };
}

export const globalFetch: FetchLike = timedFetch(PROVIDER_TIMEOUT_MS);

/**
 * A provider refused or failed a message. `permanent`: retrying the same request cannot help
 * (invalid number, unknown template, bad credentials, unregistered push token) — the delivery is
 * marked failed at once; otherwise it is retried with backoff. `invalidRecipient`: the token or
 * number is dead and should be pruned.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
    message: string,
    readonly permanent: boolean,
    readonly invalidRecipient = false,
  ) {
    super(`${provider}: ${code}: ${message}`);
    this.name = 'ProviderError';
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}

/** 429 and 5xx are worth retrying; any other 4xx is not. */
export function transientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** `a.b.0.c` lookup into parsed JSON. */
export function pick(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Network failures (DNS, reset, timeout) are transient, whether they hit the request or the body. */
export async function send(provider: string, fetchImpl: FetchLike, url: string, init: HttpRequest): Promise<{ status: number; body: string }> {
  let res: HttpResponse;
  let body: string;
  try {
    res = await fetchImpl(url, init);
    body = await res.text();
  } catch (err) {
    throw new ProviderError(provider, 'network', (err as Error).message, false);
  }
  return { status: res.status, body };
}
