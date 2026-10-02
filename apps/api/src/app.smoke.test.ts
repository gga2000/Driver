import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { transformer, type AppRouter } from '@driver/contracts';
import { createApp } from './bootstrap.js';

describe('API smoke', () => {
  let app: NestExpressApplication;
  let url: string;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    url = `http://127.0.0.1:${port}/trpc`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots and answers health.ping', async () => {
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const res = await client.health.ping.query();
    expect(res.ok).toBe(true);
    expect(res.service).toBe('driver-api');
    // No DATABASE_URL / REDIS_URL in unit tests: the API still answers and reports both as unavailable.
    expect(['ok', 'unavailable']).toContain(res.db);
    expect(['ok', 'unavailable']).toContain(res.redis);
    if (!process.env['DATABASE_URL']) expect(res.db).toBe('unavailable');
    if (!process.env['REDIS_URL']) expect(res.redis).toBe('unavailable');
  });

  it('serves a quote for an Aziziyah taxi trip over the wire', async () => {
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const quote = await client.pricing.quote.query({
      cityId: 'aziziyah',
      vertical: 'taxi',
      stops: [{ zoneId: 'centre', type: 'pickup' }, { zoneId: 'zakur', type: 'dropoff' }],
      options: { doorPickup: true },
      at: new Date('2026-10-02T09:00:00Z'),
      distanceKm: 3,
      durationMin: 9,
    });
    expect(quote.total).toBe(5000);
    expect(quote.shadowComponents.map((c) => c.key)).toEqual(['distance', 'time']);
  });

  it('returns the city config and null for unknown cities', async () => {
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const city = await client.config.city.query({ cityId: 'aziziyah' });
    expect(city?.name_ar).toBe('العزيزية');
    expect(await client.config.city.query({ cityId: 'nowhere' })).toBeNull();
  });
});
