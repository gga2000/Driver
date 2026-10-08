import type { AddressInfo } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';
import compression from 'compression';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compressionOptions } from './bootstrap.js';

/** Raw HTTP (no automatic decoding): the status, headers and the first body chunk as sent. */
function get(port: number, path: string, headers: Record<string, string>): Promise<{ encoding?: string; first: Buffer; total: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port, path, headers }, (res) => {
      let first: Buffer | undefined;
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        first ??= chunk;
        total += chunk.length;
        // A live stream never ends: answer as soon as the first event is in.
        if (path === '/live') {
          req.destroy();
          resolve({ encoding: res.headers['content-encoding'], first, total });
        }
      });
      res.on('end', () => resolve({ encoding: res.headers['content-encoding'], first: first ?? Buffer.alloc(0), total }));
    });
    req.on('error', (err) => (path === '/live' ? undefined : reject(err)));
    req.end();
  });
}

describe('response compression', () => {
  let server: Server;
  let port = 0;
  const json = JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ id: `ord_${i}`, state: 'on_the_way', name: 'مطعم خالد' })) });

  beforeAll(async () => {
    const app = express();
    app.use(compression(compressionOptions));
    app.get('/json', (_req, res) => void res.type('application/json').send(json));
    app.get('/tiny', (_req, res) => void res.type('application/json').send('{"ok":true}'));
    app.get('/live', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write('event: ping\ndata: {}\n\n'); // never ended, like a tRPC subscription
    });
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise((r) => server.close(r)));

  it('brotli for callers that accept it, gzip otherwise, several times smaller', async () => {
    const br = await get(port, '/json', { 'accept-encoding': 'gzip, deflate, br' });
    const gz = await get(port, '/json', { 'accept-encoding': 'gzip' });
    const raw = await get(port, '/json', {});
    expect(br.encoding).toBe('br');
    expect(gz.encoding).toBe('gzip');
    expect(raw.encoding).toBeUndefined();
    expect(raw.total).toBe(Buffer.byteLength(json));
    expect(br.total * 5).toBeLessThan(raw.total);
    expect(gz.total * 5).toBeLessThan(raw.total);
  });

  it('leaves tiny answers alone (not worth the CPU)', async () => {
    expect((await get(port, '/tiny', { 'accept-encoding': 'gzip, br' })).encoding).toBeUndefined();
  });

  it('never compresses a live stream, so each event arrives at once', async () => {
    const live = await get(port, '/live', { 'accept-encoding': 'gzip, br', accept: 'text/event-stream' });
    expect(live.encoding).toBeUndefined();
    expect(live.first.toString()).toBe('event: ping\ndata: {}\n\n');
  });
});
