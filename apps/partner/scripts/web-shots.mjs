// Drives the exported web build of the Partner app and screenshots each screen (390×844 @2x, RTL).
//
// 1. Export the app for web against the demo API, with the OTP dev strip on:
//      cd apps/partner && EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3301/trpc \
//        EXPO_PUBLIC_DEV_TOOLS=1 npx expo export --platform web --output-dir dist-web
// 2. Start the in-memory demo API:  node apps/partner/scripts/demo-api.mjs &   (port 3301)
// 3. Run:  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
//            node apps/partner/scripts/web-shots.mjs <out-dir>
//
// This file is the harness only. Shot lists live in scripts/shots/*.mjs (file-name order), each:
//
//   export const name = 'core';                       // group; files are written as <name>-<shot>.png
//   export default async function run(s) { const p = await s.signIn('07701110001'); await p.shot('home'); }
//
// SHOTS=core,earnings (comma list of module names, default all) runs only those modules.
// DIST_DIR and DEMO_API override the export folder and the demo API origin.
// Exits non-zero on console errors or a missing screen.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(process.env.DIST_DIR ?? join(here, '../dist-web'));
const outDir = resolve(process.argv[2] ?? join(here, '../web-shots'));
const apiBase = (process.env.DEMO_API ?? 'http://127.0.0.1:3301').replace(/\/$/, '');
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) throw new Error(`No web export at ${dist}; run expo export first`);

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const file = existsSync(path) && !path.endsWith('/') && extname(path) ? path : join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const errors = [];
const written = [];
/** The page most recently opened: screenshotted as <group>-FAILED.png when a module throws. */
let lastPage = null;

/** Error noise from the sandbox, not from the app. */
const IGNORED = /findDOMNode|DevTools|props\.pointerEvents|shadow\*|WebSocket connection|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_REFUSED.*tile|Failed to load resource: net::ERR_TUNNEL/;

async function demoPost(path) {
  const r = await fetch(`${apiBase}${path}`, { method: 'POST' });
  const body = await r.text();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${body}`);
  return JSON.parse(body);
}

/** A fresh browser context (own localStorage = own session) with screenshot helpers. */
async function openPage(group) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ' });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.test(m.text())) errors.push(`[${group}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${group}] ${e.stack ?? e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('tile')) console.log(`[http ${r.status()}] ${r.request().method()} ${r.url()}`);
  });
  const p = {
    group,
    page,
    context,
    byTestId: (id) => page.locator(`[data-testid="${id}"]`).first(),
    async settle(ms = 700) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(ms);
    },
    async wait(id, timeout = 15_000) {
      await p.byTestId(id).waitFor({ timeout });
    },
    async goto(path) {
      await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });
    },
    async shot(name, { full = false, settle = 700 } = {}) {
      await p.settle(settle);
      if (full) {
        const h = await page.evaluate(() => {
          let max = document.documentElement.scrollHeight;
          for (const el of document.querySelectorAll('div')) {
            const s = getComputedStyle(el);
            if (s.overflowY === 'auto' || s.overflowY === 'scroll') max = Math.max(max, el.scrollHeight + 160);
          }
          return max;
        });
        await page.setViewportSize({ width: 390, height: Math.min(Math.max(h, 844), 2400) });
        await p.settle(300);
      }
      const file = join(outDir, `${group}-${name}.png`);
      await page.screenshot({ path: file });
      if (full) await page.setViewportSize({ width: 390, height: 844 });
      written.push(file);
      console.log(file);
    },
    async close() {
      await context.close();
    },
  };
  lastPage = p;
  return p;
}

/** Signs a persona in through the real flow (welcome → phone → OTP dev code) and lands on home or the gate. */
async function signIn(group, phone) {
  const p = await openPage(group);
  await p.goto('/');
  await p.wait('welcome-start', 30_000);
  await p.byTestId('welcome-start').click();
  await p.page.locator('[data-testid="phone-input"]').fill(phone);
  await p.byTestId('phone-submit').click();
  await p.wait('otp-dev-strip');
  const code = (await p.byTestId('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
  if (!code) throw new Error('dev code not shown');
  await p.page.locator('[data-testid="otp-input"]').fill(code);
  await Promise.race([p.wait('home', 20_000), p.wait('not-partner', 20_000)]);
  return p;
}

const files = readdirSync(join(here, 'shots'))
  .filter((f) => f.endsWith('.mjs'))
  .sort();
const modules = [];
for (const f of files) {
  const mod = await import(pathToFileURL(join(here, 'shots', f)).href);
  if (!mod.name || typeof mod.default !== 'function') throw new Error(`scripts/shots/${f} must export \`name\` and a default run(s)`);
  modules.push(mod);
}
const wanted = (process.env.SHOTS ?? 'all').split(',').map((s) => s.trim()).filter(Boolean);
const known = modules.map((m) => m.name);
for (const w of wanted) if (w !== 'all' && !known.includes(w)) throw new Error(`Unknown SHOTS module "${w}" (have: ${known.join(', ')})`);

try {
  for (const mod of modules) {
    if (!wanted.includes('all') && !wanted.includes(mod.name)) continue;
    console.log(`── ${mod.name}`);
    await mod.default({
      origin,
      apiBase,
      outDir,
      demoPost,
      openPage: () => openPage(mod.name),
      signIn: (phone) => signIn(mod.name, phone),
    });
  }
} catch (err) {
  errors.push(String(err?.stack ?? err));
  if (lastPage) await lastPage.page.screenshot({ path: join(outDir, `${lastPage.group}-FAILED.png`) }).catch(() => undefined);
} finally {
  await browser.close();
  server.close();
}

console.log(`${written.length} screenshots in ${outDir}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s):\n${errors.join('\n')}`);
  process.exit(1);
}
