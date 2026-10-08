# Observability: request log and metrics

Plan §7.4 (W6, CRIT1-03). This page covers what the API records about each request, where to see it,
and the queries the alerts are built on.

## Request log

Every HTTP request on `/trpc` writes **one JSON line** when the answer finishes (or, for a live
stream, when it closes). This is on by default in production (`REQUEST_LOG=on`).

```json
{"time":"…","level":"info","context":"Request","msg":"request","requestId":"6b1…","method":"GET",
 "procedures":["orders.get","catalog.home"],"batch":2,"status":207,"ms":143,"personId":"9f0…",
 "failed":[{"procedure":"orders.get","code":"NOT_FOUND"}],"service":"driver-api"}
```

- `requestId` is the same id the caller gets back in `x-request-id`. Every other log line of the
  call carries it too, so one id finds the whole story.
- `personId` is the signed-in person's random id. Names and phones live only in the vault and are
  never logged.
- Inputs are never logged.
- `failed` lists each procedure that did not succeed, with its tRPC code and, when there is one, the
  Driver error code (`driverCode`, e.g. `offer_taken`, `rate_limited`).
- `stream: true` marks a live stream. Its `ms` is how long it stayed open.

Search it on Fly:

```bash
fly logs --config deploy/fly/api.toml | grep '"context":"Request"' | grep '"status":5'
fly logs --config deploy/fly/api.toml | grep '"requestId":"<id from the phone or Sentry>"'
```

Fly keeps only a short history. Before launch, ship the logs to a store with search and retention
(Fly log shipper → Better Stack or Axiom). That is part of the alerts step.

## Metrics

Each machine serves Prometheus text at `:9091/metrics`. The port is private and never public
(`METRICS_PORT`, `[metrics]` in `deploy/fly/api.toml`). Fly scrapes it into its managed Prometheus;
open **Fly dashboard → driver-api → Metrics**, or Grafana at <https://fly-metrics.net>.

| Metric | What |
|---|---|
| `driver_procedure_calls_total{procedure,type,code,role}` | finished calls per procedure and result (`OK`, `BAD_REQUEST`, `INTERNAL_SERVER_ERROR`…) |
| `driver_procedure_duration_seconds{procedure,type,role}` | time to settle a query or mutation (histogram; streams are not timed) |
| `driver_http_requests_total{status,role}` | HTTP answers on `/trpc` by class (`2xx`, `4xx`, `5xx`) |
| `driver_heap_used_bytes`, `driver_rss_bytes` | memory (the web heap cap is 1,536 MB) |
| `driver_event_loop_delay_p99_seconds` | how long work waits for the CPU; above 0.1 s phones feel it |

Labels are procedure names and codes only, never ids, inputs or phone numbers. `role` is `web`,
`worker` or `all`.

### Queries behind the alerts (plan §7.4)

```promql
# 5xx rate (alert: > 2 % for 5 min)
sum(rate(driver_http_requests_total{status="5xx"}[5m])) / sum(rate(driver_http_requests_total[5m]))

# p95 of orders.place (alert: > 2 s for 10 min)
histogram_quantile(0.95, sum by (le) (rate(driver_procedure_duration_seconds_bucket{procedure="orders.place"}[10m])))

# orders.place success (alert: < 95 % for 10 min; refusals such as a closed kitchen count as answered)
sum(rate(driver_procedure_calls_total{procedure="orders.place",code!="INTERNAL_SERVER_ERROR"}[10m]))
  / sum(rate(driver_procedure_calls_total{procedure="orders.place"}[10m]))

# slowest procedures right now
topk(10, histogram_quantile(0.95, sum by (le, procedure) (rate(driver_procedure_duration_seconds_bucket[5m]))))
```

Health: `health.live` (Fly's check) and `health.ready` (every dependency, for the uptime monitor).
See `hosting.md` → "Logs and errors" and `runbook.md`.
