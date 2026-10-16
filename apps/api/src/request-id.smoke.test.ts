import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './bootstrap.js';
import { PrismaService } from './shared/db/prisma.service.js';
import { AppLogger } from './shared/logging.js';

/**
 * Request-id attribution over the wire (W0): the id a caller sends in `x-request-id` is echoed back and
 * stamped on every log line the call produces — across awaits, and on the tRPC layer's 5xx line — so
 * the real-database e2e job can pin each failure on the flow that caused it.
 */
describe('x-request-id → log lines', () => {
  let app: NestExpressApplication;
  let base: string;
  const lines: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    const logger = new AppLogger(
      'json',
      undefined,
      ['error', 'warn', 'log'],
      (l) => void lines.push(JSON.parse(l) as Record<string, unknown>),
    );
    app = await createApp({ logger });
    // health.ping's db probe fails after an async hop, logging on the way: a stand-in for a failing query.
    vi.spyOn(app.get(PrismaService), 'status').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      new Logger('Probe').warn('db probe failed');
      throw new Error('boom');
    });
    await app.listen(0);
    const address = app.getHttpServer().address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('carries the caller id on the warn and on the INTERNAL_SERVER_ERROR line, and echoes it back', async () => {
    const res = await fetch(`${base}/trpc/health.ping`, {
      headers: { 'x-request-id': 'e2e-test-abc123' },
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('x-request-id')).toBe('e2e-test-abc123');
    const probe = lines.find((l) => l['msg'] === 'db probe failed');
    const fatal = lines.find(
      (l) => l['level'] === 'error' && String(l['msg']).startsWith('health.ping:'),
    );
    expect(probe?.['requestId']).toBe('e2e-test-abc123');
    expect(fatal?.['requestId']).toBe('e2e-test-abc123');
  });

  it('makes one up when none (or a malformed one) is sent, and never leaks it outside the request', async () => {
    lines.length = 0;
    const res = await fetch(`${base}/trpc/health.ping`, {
      headers: { 'x-request-id': 'bad id\twith spaces' },
    });
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines.find((l) => l['level'] === 'error')?.['requestId']).toBe(id);
    new Logger('Outside').log('after the request');
    expect(lines.at(-1)).not.toHaveProperty('requestId');
  });
});
