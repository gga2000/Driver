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

export const globalFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
  return { status: res.status, text: () => res.text() };
};

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

/** Network failures (DNS, reset, timeout) are transient. */
export async function send(provider: string, fetchImpl: FetchLike, url: string, init: HttpRequest): Promise<{ status: number; body: string }> {
  let res: HttpResponse;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new ProviderError(provider, 'network', (err as Error).message, false);
  }
  return { status: res.status, body: await res.text() };
}
