import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PHOTO_MAX_BYTES } from '@driver/contracts';
import { createApp } from './bootstrap.js';

/**
 * The plain-HTTP routes next to tRPC, over the wire: they depend on how the HTTP framework hands over
 * the raw body and the query string (Express 5 under NestJS 11), so a framework upgrade that changes
 * either shows up here.
 */
describe('HTTP surface (webhook, uploads)', () => {
  let app: NestExpressApplication;
  let base: string;
  const saved = { secret: process.env['WHATSAPP_APP_SECRET'], token: process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] };

  beforeAll(async () => {
    process.env['WHATSAPP_APP_SECRET'] = 'test-secret';
    process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] = 'verify-me';
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of [['WHATSAPP_APP_SECRET', saved.secret], ['WHATSAPP_WEBHOOK_VERIFY_TOKEN', saved.token]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const sign = (body: string) => `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;
  const post = (body: string, signature?: string) =>
    fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) }, body });

  it('webhook: the signature is checked over the exact bytes sent, not the re-serialised JSON', async () => {
    const body = '{ "object" : "whatsapp_business_account",  "entry": [], "note": "عربي" }';
    expect((await post(body, sign(body))).status).toBe(200);
    // Same JSON, different bytes: a signature over the original must not pass.
    expect((await post(body.replace(/ {2}/g, ' '), sign(body))).status).toBe(401);
    expect((await post(body, 'sha256=deadbeef')).status).toBe(401);
    expect((await post(body)).status).toBe(401);
  });

  it('webhook: the GET handshake reads the dotted hub.* query keys', async () => {
    const ok = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=4242`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('4242');
    expect((await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242`)).status).toBe(403);
  });

  it('uploads: a body over the photo limit is refused with 413, a bad ticket with 400', async () => {
    const big = await fetch(`${base}/uploads/u1?exp=1&sig=bad`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(PHOTO_MAX_BYTES + 1) });
    expect(big.status).toBe(413);
    const bad = await fetch(`${base}/uploads/u1?exp=1&sig=bad`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: new Uint8Array(16) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('upload_invalid');
    expect((await fetch(`${base}/files/u1?exp=1&sig=bad`)).status).toBe(404);
  });
});
