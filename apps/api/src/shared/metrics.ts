import { createServer, type Server } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';

/** Latency buckets in seconds: phone-visible speeds, from instant to the 5 s request statement limit and past it. */
export const LATENCY_BUCKETS_S = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10] as const;

type Labels = Readonly<Record<string, string>>;

function key(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]!.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    .join(',');
}

class Counter {
  readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(labels: Labels, by = 1): void {
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.values) lines.push(`${this.name}{${k}} ${v}`);
    return lines.join('\n');
  }
}

class Histogram {
  private readonly series = new Map<string, { counts: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: readonly number[],
  ) {}
  observe(labels: Labels, value: number): void {
    const k = key(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    for (let i = 0; i < this.buckets.length; i++) if (value <= this.buckets[i]!) s.counts[i]!++;
    s.sum += value;
    s.count++;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, s] of this.series) {
      const sep = k ? `${k},` : '';
      this.buckets.forEach((b, i) => lines.push(`${this.name}_bucket{${sep}le="${b}"} ${s.counts[i]}`));
      lines.push(`${this.name}_bucket{${sep}le="+Inf"} ${s.count}`);
      lines.push(`${this.name}_sum{${k}} ${s.sum}`);
      lines.push(`${this.name}_count{${k}} ${s.count}`);
    }
    return lines.join('\n');
  }
}

/**
 * The API's RED metrics (rate, errors, duration per procedure) in the Prometheus text format, plus a
 * few process gauges. In memory, per machine: Fly scrapes each machine's `/metrics` on the private
 * metrics port (`[metrics]` in deploy/fly/api.toml) into its managed Prometheus, where the
 * dashboards and alerts read them (docs/deploy/observability.md). Label values are procedure
 * names and codes only: never inputs, ids or phone numbers.
 */
export class Metrics {
  readonly calls = new Counter('driver_procedure_calls_total', 'Finished tRPC procedure calls by procedure, type and result code.');
  readonly duration = new Histogram('driver_procedure_duration_seconds', 'Time to settle a tRPC query or mutation, in seconds.', LATENCY_BUCKETS_S);
  readonly http = new Counter('driver_http_requests_total', 'HTTP answers on /trpc by status class (2xx, 4xx, 5xx).');
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  private readonly gauges: Array<() => string> = [];

  constructor(private readonly labels: Labels = {}) {
    this.loop.enable();
  }

  /** Adds a gauge read at scrape time (`value` returns null to skip it). */
  gauge(name: string, help: string, value: () => number | null): void {
    this.gauges.push(() => {
      const v = value();
      return v === null ? '' : `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${this.suffix()} ${v}`;
    });
  }

  procedure(path: string, type: string, code: string, ms: number): void {
    this.calls.inc({ ...this.labels, procedure: path, type, code });
    // A subscription's duration is how long the stream stayed open, not how fast it answered.
    if (type !== 'subscription') this.duration.observe({ ...this.labels, procedure: path, type }, ms / 1000);
  }

  httpStatus(status: number): void {
    this.http.inc({ ...this.labels, status: `${Math.floor(status / 100)}xx` });
  }

  render(): string {
    const mem = process.memoryUsage();
    const process_ = [
      `# HELP driver_heap_used_bytes V8 heap in use.\n# TYPE driver_heap_used_bytes gauge\ndriver_heap_used_bytes${this.suffix()} ${mem.heapUsed}`,
      `# HELP driver_rss_bytes Resident memory of the process.\n# TYPE driver_rss_bytes gauge\ndriver_rss_bytes${this.suffix()} ${mem.rss}`,
      `# HELP driver_event_loop_delay_p99_seconds Event loop delay, 99th percentile since the last scrape.\n# TYPE driver_event_loop_delay_p99_seconds gauge\ndriver_event_loop_delay_p99_seconds${this.suffix()} ${this.loop.percentile(99) / 1e9}`,
    ];
    this.loop.reset();
    return [this.calls.render(), this.duration.render(), this.http.render(), ...process_, ...this.gauges.map((g) => g()).filter(Boolean)].join('\n') + '\n';
  }

  private suffix(): string {
    const k = key(this.labels);
    return k ? `{${k}}` : '';
  }

  /**
   * Serves `render()` at GET /metrics on its own port (never the public one). No host: Node listens on
   * `::` (IPv4 too), which Fly's scraper needs, as it reaches machines over their private IPv6.
   */
  listen(port: number, host?: string): Server {
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(this.render());
      } else {
        res.writeHead(404).end();
      }
    });
    if (host) server.listen(port, host);
    else server.listen(port);
    server.unref();
    return server;
  }
}

/** `METRICS_PORT` (production sets 9091, matching `[metrics]` in deploy/fly/api.toml); unset = no metrics server. */
export function metricsPortFromEnv(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env['METRICS_PORT']?.trim();
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`METRICS_PORT must be a port number (got "${raw}")`);
  return port;
}
