#!/usr/bin/env node
// Driver Studio — run every app locally with live reload, on demo data, and see them side by side.
//
//   pnpm studio                     everything: customer, partner, merchant, console
//   pnpm studio customer merchant   only some apps
//   pnpm studio --no-build          skip the package/API build (faster restarts)
//
// No database, Docker or accounts needed: each app talks to its own demo API (the real API running in
// memory with realistic Aziziyah seed data). Edit any screen and the browser reloads by itself.
// Open http://localhost:4000 for the studio page (all apps in phone/tablet frames). Ctrl+C stops all.
//
// Logs: .studio/logs/<service>.log (the terminal only shows when things are ready or break).
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const wanted = args.filter((a) => !a.startsWith('--'));
const ALL = ['customer', 'partner', 'merchant', 'console'];
const apps = wanted.length ? wanted : ALL;
for (const a of apps) if (!ALL.includes(a)) fail(`Unknown app "${a}". Choose from: ${ALL.join(', ')}`);

const STUDIO_PORT = Number(process.env.STUDIO_PORT ?? 4000);
const logsDir = join(root, '.studio', 'logs');
mkdirSync(logsDir, { recursive: true });

/** Every process the studio runs. `ready` is the port that answers when it is up. */
const SERVICES = {
  customer: [
    { name: 'customer-api', cwd: 'apps/customer', cmd: 'node', args: ['scripts/demo-api.mjs'], env: { PORT: '3200' }, port: 3200, readyLine: /DEMO_API ready/ },
    { name: 'customer-web', cwd: 'apps/customer', expo: true, port: 8081, env: { EXPO_PUBLIC_API_URL: 'http://localhost:3200/trpc' } },
  ],
  partner: [
    { name: 'partner-api', cwd: 'apps/partner', cmd: 'node', args: ['scripts/demo-api.mjs'], env: { PORT: '3301' }, port: 3301, readyLine: /DEMO_API ready/ },
    { name: 'partner-web', cwd: 'apps/partner', expo: true, port: 8082, env: { EXPO_PUBLIC_API_URL: 'http://localhost:3301/trpc' } },
  ],
  merchant: [
    { name: 'merchant-api', cwd: 'apps/merchant', cmd: 'node', args: ['scripts/demo-api.mjs'], env: { PORT: '3302' }, port: 3302, readyLine: /DEMO_API ready/ },
    { name: 'merchant-web', cwd: 'apps/merchant', expo: true, port: 8083, env: { EXPO_PUBLIC_API_URL: 'http://localhost:3302/trpc' } },
  ],
  console: [
    { name: 'console-api', cwd: 'apps/console', cmd: 'node', args: ['scripts/demo-api.mjs'], env: { PORT: '3395' }, port: 3395 },
    { name: 'console-web', cwd: 'apps/console', cmd: 'pnpm', args: ['exec', 'next', 'dev', '--port', '3100'], env: { NEXT_PUBLIC_API_URL: 'http://localhost:3395/trpc' }, port: 3100 },
  ],
};

const color = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m' };
const say = (msg) => console.log(msg);
function fail(msg) {
  console.error(`${color.red}✖ ${msg}${color.reset}`);
  process.exit(1);
}

// ───────────────────────── checks ─────────────────────────
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) fail(`Node ${process.versions.node} is too old: install Node 22 (see docs/dev/mac-setup.md).`);

function portFree(port) {
  return new Promise((res) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => (s.destroy(), res(false)));
    s.once('error', () => res(true));
  });
}

const services = apps.flatMap((a) => SERVICES[a]);
for (const s of [...services.map((s) => s.port), STUDIO_PORT]) {
  if (!(await portFree(s))) fail(`Port ${s} is already in use (an old studio still running?). Close it, or restart the computer, then try again.`);
}

// ───────────────────────── build ─────────────────────────
if (!flags.has('--no-build')) {
  say(`${color.cyan}▸ Building shared packages and the API (fast when nothing changed)…${color.reset}`);
  const b = spawnSync('pnpm', ['turbo', 'run', 'build', "--filter=./packages/*", '--filter=@driver/api', '--output-logs=errors-only'], { cwd: root, stdio: 'inherit' });
  if (b.status !== 0) fail('Build failed — see the errors above.');
}

// ───────────────────────── run ─────────────────────────
const children = [];
const state = new Map(services.map((s) => [s.name, 'starting']));

function start(svc) {
  const log = createWriteStream(join(logsDir, `${svc.name}.log`), { flags: 'w' });
  const env = { ...process.env, ...svc.env, FORCE_COLOR: '0' };
  let cmd = svc.cmd;
  let cmdArgs = svc.args;
  if (svc.expo) {
    // Live-reload web dev server. EXPO_OFFLINE skips network version checks; BROWSER=none keeps
    // Expo from opening tabs (the studio page shows everything).
    Object.assign(env, { EXPO_PUBLIC_DEV_TOOLS: '1', EXPO_OFFLINE: '1', BROWSER: 'none', EXPO_NO_TELEMETRY: '1' });
    cmd = 'pnpm';
    cmdArgs = ['exec', 'expo', 'start', '--web', '--port', String(svc.port), '--max-workers', '2'];
  }
  const child = spawn(cmd, cmdArgs, { cwd: join(root, svc.cwd), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const onData = (buf) => {
    log.write(buf);
    const text = buf.toString();
    if (svc.readyLine && svc.readyLine.test(text)) mark(svc, 'ready');
    if (/\b(Error|ERROR|SyntaxError|TypeError)\b/.test(text) && !/ExperimentalWarning|findDOMNode|DevSms|\[Nest\].*LOG/.test(text)) {
      const line = text.split('\n').find((l) => /Error/.test(l)) ?? text;
      say(`${color.red}✖ ${svc.name}: ${line.trim().slice(0, 300)}${color.reset}  ${color.dim}(full log: .studio/logs/${svc.name}.log)${color.reset}`);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    if (shuttingDown) return;
    mark(svc, 'stopped');
    say(`${color.red}✖ ${svc.name} stopped (exit ${code}). Last lines are in .studio/logs/${svc.name}.log${color.reset}`);
  });
  // Ports answer before (or without) a ready line: poll.
  const poll = setInterval(async () => {
    if (state.get(svc.name) !== 'starting') return clearInterval(poll);
    if (!(await portFree(svc.port))) {
      if (!svc.readyLine) mark(svc, 'ready');
    }
  }, 1000);
}

function mark(svc, s) {
  if (state.get(svc.name) === s) return;
  state.set(svc.name, s);
  if (s === 'ready') say(`${color.green}✓ ${svc.name} ready${color.reset} ${color.dim}http://localhost:${svc.port}${color.reset}`);
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  say(`\n${color.cyan}▸ Stopping everything…${color.reset}`);
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGTERM'); // the whole process group (pnpm → expo → metro)
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

say(`${color.cyan}▸ Starting ${apps.join(', ')}…${color.reset} ${color.dim}(first start takes 1–2 minutes)${color.reset}`);
// APIs first, then the web servers (each needs ~1 GB while bundling; staggering keeps laptops calm).
for (const s of services.filter((s) => s.name.endsWith('-api'))) start(s);
for (const s of services.filter((s) => !s.name.endsWith('-api'))) {
  await new Promise((r) => setTimeout(r, 1500));
  start(s);
}

// ───────────────────────── studio page ─────────────────────────
const page = readFileSync(join(root, 'scripts/dev/studio.html'), 'utf8');
createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ apps, services: Object.fromEntries(state) }));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(page);
}).listen(STUDIO_PORT, () => {
  say('');
  say(`${color.bold}  Driver Studio → http://localhost:${STUDIO_PORT}${color.reset}`);
  say(`${color.dim}  Customer http://localhost:8081 · Partner http://localhost:8082 · Merchant http://localhost:8083 · Console http://localhost:3100${color.reset}`);
  say(`${color.dim}  Ctrl+C to stop everything.${color.reset}\n`);
});

