import { request as httpRequest, type ClientRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './bootstrap.js';
import { maxInflightFromEnv } from './shared/busy-cap.js';

/** x3 over the wire: past the cap a call is turned away at once with server_busy; health still answers. */
describe('busy cap', () => {
  let app: NestExpressApplication;
  let port = 0;
  let base: string;
  const previous = process.env['MAX_INFLIGHT_REQUESTS'];

  beforeAll(async () => {
    process.env['MAX_INFLIGHT_REQUESTS'] = '1';
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    port = typeof address === 'object' && address ? address.port : 0;
    base = `http://127.0.0.1:${port}/trpc`;
  });

  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env['MAX_INFLIGHT_REQUESTS'];
    else process.env['MAX_INFLIGHT_REQUESTS'] = previous;
  });

  const quote = encodeURIComponent(JSON.stringify({ json: { cityId: 'aziziyah' } }));
  const city = () => fetch(`${base}/config.city?input=${quote}`);

  /** A POST whose body never finishes: it holds the one slot until `end()`. */
  function holdSlot(): Promise<{ req: ClientRequest; done: Promise<number> }> {
    return new Promise((resolve) => {
      let status: (n: number) => void;
      const done = new Promise<number>((r) => (status = r));
      const req = httpRequest({ agent: false, host: '127.0.0.1', port, path: '/trpc/identity.refresh', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '64' } }, (res) => {
        res.resume();
        res.on('end', () => status(res.statusCode ?? 0));
      });
      req.write('{"json":');
      req.on('error', () => status(0));
      // Give the server a moment to count it.
      setTimeout(() => resolve({ req, done }), 150);
    });
  }

  it('reads its setting: default 50, "off" or 0 turns it off, nonsense refuses to boot', () => {
    expect(maxInflightFromEnv(undefined)).toBe(50);
    expect(maxInflightFromEnv(' 80 ')).toBe(80);
    expect(maxInflightFromEnv('off')).toBe(0);
    expect(maxInflightFromEnv('0')).toBe(0);
    expect(() => maxInflightFromEnv('lots')).toThrow(/MAX_INFLIGHT_REQUESTS/);
  });

  it('answers 503 server_busy with Retry-After while full, serves health, and frees the slot after', async () => {
    expect((await city()).status).toBe(200);
    const held = await holdSlot();
    const busy = await city();
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('1');
    const body = (await busy.json()) as { error: { json: { data: { code: string; message_ar: string; retryAfterSec: number } } } };
    expect(body.error.json.data).toMatchObject({ code: 'server_busy', retryAfterSec: 1 });
    expect(body.error.json.data.message_ar).toContain('الضغط عالي');
    expect((await fetch(`${base}/health.ping`)).status).toBe(200);
    held.req.end('"x"}'.padEnd(56, ' '));
    expect(await held.done).toBeGreaterThan(0);
    expect((await city()).status).toBe(200);
  });

  it('a caller who hangs up frees the slot too', async () => {
    const held = await holdSlot();
    expect((await city()).status).toBe(503);
    held.req.destroy();
    await new Promise((r) => setTimeout(r, 100));
    expect((await city()).status).toBe(200);
  });
});
