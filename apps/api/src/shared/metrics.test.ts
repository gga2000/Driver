import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Metrics, metricsPortFromEnv } from './metrics.js';

describe('Metrics', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it('keeps cumulative latency buckets per procedure, without the time of a stream', () => {
    const m = new Metrics();
    m.procedure('orders.place', 'mutation', 'OK', 40);
    m.procedure('orders.place', 'mutation', 'OK', 300);
    m.procedure('orders.place', 'mutation', 'CONFLICT', 3_000);
    m.procedure('live.order', 'subscription', 'OK', 0);
    const text = m.render();
    expect(text).toContain('driver_procedure_duration_seconds_bucket{procedure="orders.place",type="mutation",le="0.05"} 1');
    expect(text).toContain('driver_procedure_duration_seconds_bucket{procedure="orders.place",type="mutation",le="0.5"} 2');
    expect(text).toContain('driver_procedure_duration_seconds_bucket{procedure="orders.place",type="mutation",le="+Inf"} 3');
    expect(text).toContain('driver_procedure_duration_seconds_count{procedure="orders.place",type="mutation"} 3');
    expect(text).toContain('driver_procedure_calls_total{code="CONFLICT",procedure="orders.place",type="mutation"} 1');
    expect(text).toContain('driver_procedure_calls_total{code="OK",procedure="live.order",type="subscription"} 1');
    expect(text).not.toContain('procedure="live.order",type="subscription",le=');
  });

  it('serves the text on its own port', async () => {
    const m = new Metrics({ role: 'web' });
    m.httpStatus(503);
    server = m.listen(0, '127.0.0.1');
    await new Promise((r) => server!.once('listening', r));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('driver_http_requests_total{role="web",status="5xx"} 1');
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
  });

  it('reads METRICS_PORT', () => {
    expect(metricsPortFromEnv({})).toBeNull();
    expect(metricsPortFromEnv({ METRICS_PORT: '9091' })).toBe(9091);
    expect(() => metricsPortFromEnv({ METRICS_PORT: 'x' })).toThrow(/METRICS_PORT/);
  });
});
