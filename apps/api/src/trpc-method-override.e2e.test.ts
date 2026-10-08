import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { transformer, type AppRouter } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { TrpcService } from './trpc/trpc.module.js';

/**
 * A query too big for a URL (a large basket with Arabic notes) is sent by the apps as POST (audit
 * FOOD-18); the server answers it like the same query sent as GET.
 */
describe('queries sent as POST (e2e)', () => {
  let app: NestExpressApplication;
  let url: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
    app.get(TrpcService).mount(app);
    await app.listen(0);
    const address = app.getHttpServer().address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/trpc`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a POSTed query the same as a GET one', async () => {
    const get = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const post = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer, methodOverride: 'POST' })] });
    const input = { cityId: 'aziziyah', query: 'كباب' };
    const viaGet = await get.catalog.search.query(input);
    const viaPost = await post.catalog.search.query(input);
    expect(viaPost).toEqual(viaGet);
    expect((await post.health.ping.query()).ok).toBe(true);
  });
});
