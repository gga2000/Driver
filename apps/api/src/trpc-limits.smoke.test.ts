import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { REQUEST_LIMITS } from '@driver/contracts';
import { createApp } from './bootstrap.js';

/** SEC-03 over the wire: how many calls one HTTP request may carry. */
describe('tRPC batch size (SEC-03)', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    app = await createApp({ logger: { log() {}, error() {}, warn() {} } });
    await app.listen(0);
    const address = app.getHttpServer().address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app.close();
  });

  /** A GET batch of `n` `config.city` reads, as the apps' batch link sends them. */
  const batch = (n: number) => {
    const paths = Array.from({ length: n }, () => 'config.city').join(',');
    const input = Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { json: { cityId: 'aziziyah' } }]));
    return fetch(`${base}/trpc/${paths}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`);
  };

  it(`a batch of ${REQUEST_LIMITS.maxBatchSize} calls is served, one more is refused whole`, async () => {
    const ok = await batch(REQUEST_LIMITS.maxBatchSize);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as unknown[]).length).toBe(REQUEST_LIMITS.maxBatchSize);
    const refused = await batch(REQUEST_LIMITS.maxBatchSize + 1);
    expect(refused.status).toBe(400);
  });

  it('a refused call answers 429 with retry-after (CON-21)', async () => {
    // Price checks from one guest address are enforced at launch; calls count before their input is read.
    const quotes = (n: number) => {
      const paths = Array.from({ length: n }, () => 'pricing.quote').join(',');
      const input = Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { json: {} }]));
      return fetch(`${base}/trpc/${paths}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`);
    };
    // The limit counts in fixed one-minute windows: start well inside one, or a window edge in the
    // middle of the loop resets the count and the last call is served (400) instead of refused.
    const left = REQUEST_LIMITS.windowMs - (Date.now() % REQUEST_LIMITS.windowMs);
    if (left < 15_000) await new Promise((r) => setTimeout(r, left + 50));
    for (let sent = 0; sent < REQUEST_LIMITS.quotePerGuestIp; sent += REQUEST_LIMITS.clientBatchItems) {
      expect((await quotes(Math.min(REQUEST_LIMITS.clientBatchItems, REQUEST_LIMITS.quotePerGuestIp - sent))).status).toBe(400);
    }
    const refused = await quotes(1);
    expect(refused.status).toBe(429);
    const wait = Number(refused.headers.get('retry-after'));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
  }, 45_000);

  it('the apps split their batches well below the limit', () => {
    expect(REQUEST_LIMITS.clientBatchItems).toBeLessThan(REQUEST_LIMITS.maxBatchSize);
  });
});
