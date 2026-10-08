// Shared pieces of the speed budget checks (scripts/perf): serve a web export like an installed app,
// run an app's in-memory demo API, sign in, and compare measurements with scripts/perf/budgets.json.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
};

/** Serves a web export with every unknown path falling back to index.html (expo-router's single page). */
export async function serveDist(dist) {
  const server = createServer((req, res) => {
    const p = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    const file = existsSync(p) && !p.endsWith('/') && extname(p) ? p : join(dist, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/** Starts `apps/<app>/scripts/demo-api.mjs` on `port` and waits until it answers. */
export async function startDemoApi(root, app, port) {
  const child = spawn(process.execPath, [join(root, 'apps', app, 'scripts', 'demo-api.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let err = '';
  child.stderr.on('data', (c) => (err = (err + c).slice(-4000)));
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`${app} demo API exited: ${err}`);
    const ok = await fetch(`http://127.0.0.1:${port}/demo/seed`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return { base: `http://127.0.0.1:${port}`, stop: () => child.kill('SIGTERM') };
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGTERM');
  throw new Error(`${app} demo API did not start on :${port}: ${err}`);
}

/** Loads Playwright from PLAYWRIGHT_MODULE, else the Console's copy (the only app that depends on it). */
export async function loadChromium(root) {
  let mod = process.env.PLAYWRIGHT_MODULE;
  if (!mod) {
    const { createRequire } = await import('node:module');
    const fromConsole = createRequire(join(root, 'apps', 'console', 'package.json'));
    mod = createRequire(fromConsole.resolve('@playwright/test')).resolve('playwright');
  }
  const { chromium } = await import(mod);
  return chromium;
}

/** Visible element by test id (screens keep hidden copies mounted behind the stack). */
export const byTestId = (page, id) => page.locator(`[data-testid="${id}"]:visible`).first();

/**
 * Before any app code runs: count React commits (through the devtools hook, which production React
 * also calls) and the animation frames the app asks for. An idle screen should ask for neither.
 */
export function installCounters(page) {
  return page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__perf = { commits: 0, frames: 0 };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      w.__perf.frames++;
      return raf(cb);
    };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => {},
      onScheduleFiberRoot: () => {},
      onCommitFiberRoot: () => {
        w.__perf.commits++;
      },
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
    };
  });
}

/**
 * Compares measured values with the budgets. A budget is `{ max, target?, why? }`: over `max` fails;
 * `target` is where the number should get to once the linked idea is built (printed, never fails).
 * Returns rows for the report and whether everything is within budget.
 */
export function judge(budgets, measured) {
  const rows = [];
  for (const [key, b] of Object.entries(budgets)) {
    if (key.startsWith('_')) continue;
    const value = measured[key];
    if (value === undefined) {
      rows.push({
        key,
        value: null,
        max: b.max,
        target: b.target ?? null,
        ok: false,
        note: 'not measured',
      });
      continue;
    }
    rows.push({
      key,
      value,
      max: b.max,
      target: b.target ?? null,
      ok: value <= b.max,
      note: b.why ?? '',
    });
  }
  for (const key of Object.keys(measured))
    if (!(key in budgets))
      rows.push({
        key,
        value: measured[key],
        max: null,
        target: null,
        ok: true,
        note: 'no budget (report only)',
      });
  return { rows, ok: rows.every((r) => r.ok) };
}

/** A markdown table for the job summary and the log. */
export function report(title, { rows, ok }, unit = {}) {
  const fmt = (k, v) => (v === null ? '—' : `${v}${unit[k] ?? ''}`);
  const lines = [
    `### ${title}: ${ok ? 'within budget' : 'OVER BUDGET'}`,
    '',
    '| Measure | Now | Budget | Target | |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows)
    lines.push(
      `| ${r.key} | ${fmt(r.key, r.value)} | ${fmt(r.key, r.max)} | ${fmt(r.key, r.target)} | ${r.ok ? 'ok' : '**over**'} ${r.note} |`,
    );
  return lines.join('\n') + '\n';
}
