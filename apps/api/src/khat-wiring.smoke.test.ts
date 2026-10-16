import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './bootstrap.js';
import { KhatService } from './modules/khat/khat.service.js';
import { EtaService } from './modules/routing/index.js';

describe('khat wiring', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("gives the guardian's bus map its road (N14: polyline and minutes)", () => {
    const khat = app.get(KhatService);
    expect((khat as unknown as { eta: unknown }).eta).toBeInstanceOf(EtaService);
  });
});
