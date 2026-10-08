import { EventEmitter } from 'node:events';
import { request as httpRequest, type ClientRequest } from 'node:http';
import type { Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DriverError } from '@driver/contracts';
import { toTrpcError } from '@driver/contracts/router';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { createApp } from './bootstrap.js';
import { busyRefusal, createBusyCap, maxInflightFromEnv } from './shared/busy-cap.js';

/** A request as the cap sees it, and its answer (an emitter for `finish` / `close`). */
function fakeCall(path = '/config.city', accept = 'application/json') {
  const res = Object.assign(new EventEmitter(), { headersSent: false, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; } });
  return { req: { path, headers: { accept } } as unknown as Request, res };
}

/** Runs one call through the cap; `procedure` stands in for the tRPC gate at the first procedure step. */
function through(cap: ReturnType<typeof createBusyCap>, call: ReturnType<typeof fakeCall>, procedure = 'config.city', bodyArrives = true): DriverError | null | 'never' {
  let seen: DriverError | null | 'never' = 'never';
  cap(call.req, call.res as unknown as Response, () => {
    if (bodyArrives) seen = busyRefusal(procedure);
  });
  return seen;
}

describe('busy cap: who is counted', () => {
  it('reads its setting: default 50, "off" or 0 turns it off, nonsense refuses to boot', () => {
    expect(maxInflightFromEnv(undefined)).toBe(50);
    expect(maxInflightFromEnv(' 80 ')).toBe(80);
    expect(maxInflightFromEnv('off')).toBe(0);
    expect(maxInflightFromEnv('0')).toBe(0);
    expect(() => maxInflightFromEnv('lots')).toThrow(/MAX_INFLIGHT_REQUESTS/);
  });

  it('refuses past the cap with server_busy (503, Retry-After 1) and frees the slot when the answer goes out', () => {
    const cap = createBusyCap(1);
    const a = fakeCall();
    expect(through(cap, a)).toBeNull();
    expect(cap.inflight()).toBe(1);
    const b = fakeCall();
    const refused = through(cap, b);
    expect(refused).toBeInstanceOf(DriverError);
    expect((refused as DriverError).code).toBe('server_busy');
    expect((refused as DriverError).envelope).toMatchObject({ retryAfterSec: 1 });
    expect(getHTTPStatusCodeFromError(toTrpcError(refused))).toBe(503);
    expect(b.res.headers['Retry-After']).toBe('1');
    // Every call of a refused batch gets the same answer; a refused request was never counted.
    expect(busyRefusal('config.city')).toBeNull();
    expect(cap.inflight()).toBe(1);
    a.res.emit('finish');
    a.res.emit('close');
    expect(cap.inflight()).toBe(0);
    expect(through(cap, fakeCall())).toBeNull();
  });

  it('a stalled body never holds a slot: it is counted only when its first procedure starts', () => {
    const cap = createBusyCap(1);
    for (let i = 0; i < 20; i++) expect(through(cap, fakeCall('/identity.refresh'), 'identity.refresh', false)).toBe('never');
    expect(cap.inflight()).toBe(0);
    expect(through(cap, fakeCall())).toBeNull();
  });

  it('a caller who hangs up frees the slot, and one gone before its call starts is never counted', () => {
    const cap = createBusyCap(1);
    const a = fakeCall();
    through(cap, a);
    a.res.emit('close');
    expect(cap.inflight()).toBe(0);
    const gone = fakeCall();
    cap(gone.req, gone.res as unknown as Response, () => {
      gone.res.emit('close');
      expect(busyRefusal('config.city')).toBeNull();
    });
    expect(cap.inflight()).toBe(0);
  });

  it('health and live streams are never counted nor refused; a batch counts once', () => {
    const cap = createBusyCap(1);
    expect(through(cap, fakeCall())).toBeNull();
    expect(through(cap, fakeCall('/health.live'), 'health.live')).toBeNull();
    expect(through(cap, fakeCall('/live.order'), 'live.order')).toBe(null);
    expect(through(cap, fakeCall('/x', 'text/event-stream'), 'live.chat')).toBe(null);
    expect(cap.inflight()).toBe(1);
    const batch = createBusyCap(1);
    const call = fakeCall('/config.city,catalog.home');
    batch(call.req, call.res as unknown as Response, () => {
      expect(busyRefusal('config.city')).toBeNull();
      expect(busyRefusal('catalog.home')).toBeNull();
    });
    expect(batch.inflight()).toBe(1);
  });
});

/** Over the wire, with the cap at 1: stalled uploads do not lock anyone out. */
describe('busy cap over the wire', () => {
  let app: NestExpressApplication;
  let port = 0;
  const previous = process.env['MAX_INFLIGHT_REQUESTS'];

  beforeAll(async () => {
    process.env['MAX_INFLIGHT_REQUESTS'] = '1';
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    port = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env['MAX_INFLIGHT_REQUESTS'];
    else process.env['MAX_INFLIGHT_REQUESTS'] = previous;
  });

  const quote = encodeURIComponent(JSON.stringify({ json: { cityId: 'aziziyah' } }));
  const city = () => fetch(`http://127.0.0.1:${port}/trpc/config.city?input=${quote}`);

  /** A POST whose body never finishes. */
  function stall(): ClientRequest {
    const req = httpRequest({ agent: false, host: '127.0.0.1', port, path: '/trpc/identity.refresh', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '64' } });
    req.on('error', () => undefined);
    req.write('{"json":');
    return req;
  }

  it('serves everyone while several callers stall their bodies, and still serves health', async () => {
    const stalled = [stall(), stall(), stall()];
    await new Promise((r) => setTimeout(r, 150));
    const first = await city();
    expect(first.status).toBe(200);
    expect((await city()).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/trpc/health.ping`)).status).toBe(200);
    for (const s of stalled) s.destroy();
  });
});
