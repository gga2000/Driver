import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './bootstrap.js';
import { AppLogger } from './shared/logging.js';
import { Metrics } from './shared/metrics.js';
import { proceduresOf } from './shared/request-log.js';

/** The request log and RED metrics over the wire (CRIT1-03, plan 7.4). */
describe('request log + metrics', () => {
  let app: NestExpressApplication;
  let base: string;
  const lines: Array<Record<string, unknown>> = [];
  const metrics = new Metrics({ role: 'test' });
  const previous = process.env['REQUEST_LOG'];

  beforeAll(async () => {
    process.env['REQUEST_LOG'] = 'on';
    const logger = new AppLogger('json', undefined, ['error', 'warn', 'log'], (l) => void lines.push(JSON.parse(l) as Record<string, unknown>));
    app = await createApp({ logger, metrics });
    await app.listen(0);
    const address = app.getHttpServer().address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/trpc`;
  });

  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env['REQUEST_LOG'];
    else process.env['REQUEST_LOG'] = previous;
  });

  const requestLines = () => lines.filter((l) => l['context'] === 'Request');

  it('writes one line per request with id, procedures, status and time, and no inputs', async () => {
    lines.length = 0;
    const res = await fetch(`${base}/health.ping`, { headers: { 'x-request-id': 'log-test-1' } });
    expect(res.headers.get('x-request-id')).toBe('log-test-1');
    await new Promise((r) => setTimeout(r, 20));
    const line = requestLines().find((l) => l['requestId'] === 'log-test-1');
    expect(line).toMatchObject({ level: 'info', method: 'GET', procedures: ['health.ping'], batch: 1, status: 200 });
    expect(typeof line?.['ms']).toBe('number');
    expect(line).not.toHaveProperty('failed');
  });

  it('names the failed procedure and its code inside a batch, and never logs the input', async () => {
    lines.length = 0;
    const input = encodeURIComponent(JSON.stringify({ 0: { json: null }, 1: { json: { phone: '07701234567' } } }));
    await fetch(`${base}/health.ping,identity.me?batch=1&input=${input}`, { headers: { 'x-request-id': 'log-test-2' } });
    await new Promise((r) => setTimeout(r, 20));
    const line = requestLines().find((l) => l['requestId'] === 'log-test-2');
    expect(line).toMatchObject({ procedures: ['health.ping', 'identity.me'], batch: 2 });
    expect(line?.['failed']).toEqual([expect.objectContaining({ procedure: 'identity.me', code: 'UNAUTHORIZED' })]);
    expect(JSON.stringify(lines)).not.toContain('07701234567');
  });

  it('counts calls and times them per procedure in the Prometheus text', async () => {
    const text = metrics.render();
    expect(text).toMatch(/driver_procedure_calls_total\{code="OK",procedure="health\.ping",role="test",type="query"\} \d+/);
    expect(text).toMatch(/driver_procedure_calls_total\{code="UNAUTHORIZED",procedure="identity\.me",role="test",type="query"\} 1/);
    expect(text).toMatch(/driver_procedure_duration_seconds_bucket\{procedure="health\.ping",role="test",type="query",le="\+Inf"\} \d+/);
    expect(text).toMatch(/driver_http_requests_total\{role="test",status="2xx"\} \d+/);
    expect(text).toContain('driver_event_loop_delay_p99_seconds{role="test"}');
  });

  it('reads the procedures of a batch path', () => {
    expect(proceduresOf('/orders.get,catalog.home')).toEqual(['orders.get', 'catalog.home']);
    expect(proceduresOf('/')).toEqual([]);
  });
});
