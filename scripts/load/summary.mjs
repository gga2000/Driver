// Load test: k6's --summary-export as a short Markdown table for the run page (and the results doc).
//
//   node scripts/load/summary.mjs summary.json 1x >> "$GITHUB_STEP_SUMMARY"
//
// Reads metrics only; k6's setup data (kitchen hours) is never printed.
import { existsSync, readFileSync } from 'node:fs';

const [file, profile = '?'] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.log(`### Load test (${profile})\n\nNo k6 summary: the run stopped before k6 finished (see the job log).`);
  process.exit(0);
}
const { metrics } = JSON.parse(readFileSync(file, 'utf8'));

const ms = (v) => (v === undefined ? '–' : `${Math.round(v)} ms`);
const pct = (v) => (v === undefined ? '–' : `${(v * 100).toFixed(2)} %`);
const num = (v) => (v === undefined ? '–' : String(Math.round(v)));

/** k6 marks a threshold `true` when it was crossed. */
function verdict(m) {
  const t = m?.thresholds;
  if (!t) return '';
  return Object.values(t).some(Boolean) ? 'missed' : 'pass';
}

const rows = [
  ['Home screen opens (p95)', ms(metrics.home_open?.['p(95)']), '< 800 ms', verdict(metrics.home_open)],
  ['Menu (p95)', ms(metrics['http_req_duration{flow:menu}']?.['p(95)']), '< 600 ms', verdict(metrics['http_req_duration{flow:menu}'])],
  ['Place order (p95)', ms(metrics['http_req_duration{flow:place}']?.['p(95)']), '< 1 s', verdict(metrics['http_req_duration{flow:place}'])],
  ['Errors', pct(metrics.bad_responses?.value), '< 0.1 %', verdict(metrics.bad_responses)],
  ['Tracking stream connects (p95)', ms(metrics.sse_connect?.['p(95)']), '< 1 s at 2×', verdict(metrics.sse_connect)],
  ['Tracking streams refused', num(metrics.sse_open_failed?.count), '0', verdict(metrics.sse_open_failed)],
];
if (metrics.shed_ms) {
  rows.push(['Refused under overload (503), p95', ms(metrics.shed_ms['p(95)']), '< 100 ms at 3×', verdict(metrics.shed_ms)]);
  rows.push(['503 without Retry-After', num(metrics.shed_without_retry_after?.count ?? 0), '0 at 3×', verdict(metrics.shed_without_retry_after)]);
}

const out = [
  `### Load test (${profile})`,
  '',
  `${num(metrics.http_reqs?.count)} requests (${(metrics.http_reqs?.rate ?? 0).toFixed(1)}/s), ${num(metrics.orders_placed?.count)} orders placed, ${num(metrics.offers_accepted?.count ?? 0)} jobs taken by couriers, ${num(metrics.deliveries_completed?.count ?? 0)} delivered, ${(metrics.gps_fixes?.rate ?? 0).toFixed(1)} GPS fixes/s.`,
  '',
  '| What | Measured | Pass | |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.join(' | ')} |`),
];
console.log(out.join('\n'));
