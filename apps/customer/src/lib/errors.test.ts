import { describe, expect, it } from 'vitest';
import { RequestTimeoutError } from '@driver/contracts/net-client';
import { RETRY_RULES, retryDelayMs, shouldRetryQuery } from './errors';

const answered = (httpStatus: number, code?: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(code ?? 'x'), { data: { httpStatus, ...(code ? { code } : {}), ...extra } });

describe('query retry policy (CORE-16)', () => {
  it('retries no response and our server failing, with a limit', () => {
    for (const err of [new TypeError('Network request failed'), new RequestTimeoutError(15_000), answered(500, 'internal'), answered(503, 'service_unavailable')]) {
      expect(shouldRetryQuery(0, err)).toBe(true);
      expect(shouldRetryQuery(RETRY_RULES.queryRetries - 1, err)).toBe(true);
      expect(shouldRetryQuery(RETRY_RULES.queryRetries, err)).toBe(false);
    }
  });

  it('shows a definitive answer at once', () => {
    for (const err of [answered(400, 'invalid_input'), answered(401, 'token_invalid'), answered(403, 'forbidden'), answered(404, 'not_found'), answered(409, 'store_closed')]) {
      expect(shouldRetryQuery(0, err)).toBe(false);
    }
  });

  it('waits out a short rate limit, shows a long one', () => {
    expect(shouldRetryQuery(0, answered(429, 'rate_limited', { retryAfterSec: 3 }))).toBe(true);
    expect(retryDelayMs(0, answered(429, 'rate_limited', { retryAfterSec: 3 }))).toBe(3_000);
    expect(shouldRetryQuery(0, answered(429, 'rate_limited', { retryAfterSec: 60 }))).toBe(false);
    expect(shouldRetryQuery(0, answered(429, 'rate_limited'))).toBe(false);
  });

  it('backs off exponentially with jitter, capped', () => {
    const mid = () => 0.5;
    expect(retryDelayMs(0, answered(500), mid)).toBe(1_000);
    expect(retryDelayMs(1, answered(500), mid)).toBe(2_000);
    expect(retryDelayMs(2, answered(500), mid)).toBe(4_000);
    expect(retryDelayMs(10, answered(500), mid)).toBe(RETRY_RULES.backoffMaxMs);
    expect(retryDelayMs(2, answered(500), () => 0)).toBe(3_200);
    expect(retryDelayMs(2, answered(500), () => 1)).toBe(4_800);
  });
});
