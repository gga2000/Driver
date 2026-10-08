import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './bootstrap.js';

/** CORE-05 over the wire: an old build is told to update; health and calls without the header are not. */
describe('minimum app version', () => {
  let app: NestExpressApplication;
  let base: string;
  const previous = process.env['MIN_APP_VERSIONS'];

  beforeAll(async () => {
    process.env['MIN_APP_VERSIONS'] = 'customer:1.2.0';
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/trpc`;
  });

  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env['MIN_APP_VERSIONS'];
    else process.env['MIN_APP_VERSIONS'] = previous;
  });

  const call = (path: string, header?: string) => fetch(`${base}/${path}`, { headers: header ? { 'x-driver-app': header } : {} });
  const quote = encodeURIComponent(JSON.stringify({ json: { cityId: 'aziziyah' } }));

  it('refuses an older customer build with update_required (412)', async () => {
    const res = await call(`config.city?input=${quote}`, 'customer/1.1.9');
    expect(res.status).toBe(412);
    const body = (await res.json()) as { error: { json: { data: { code: string; message_ar: string } } } };
    expect(body.error.json.data.code).toBe('update_required');
    expect(body.error.json.data.message_ar).toContain('نسخة جديدة');
  });

  it('serves the minimum build, other apps, and calls without the header', async () => {
    expect((await call(`config.city?input=${quote}`, 'customer/1.2.0')).status).toBe(200);
    expect((await call(`config.city?input=${quote}`, 'partner/0.1.0')).status).toBe(200);
    expect((await call(`config.city?input=${quote}`)).status).toBe(200);
  });

  it('always answers health, so the app can tell "update" from "offline"', async () => {
    expect((await call('health.ping', 'customer/0.0.1')).status).toBe(200);
  });
});
