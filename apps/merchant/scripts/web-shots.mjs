// Drives the exported web build of the Merchant app and screenshots it at tablet and phone sizes.
//
// 1. Build packages + the API (`pnpm build`), then export the app for web against the demo API:
//      cd apps/merchant && EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3302/trpc \
//        EXPO_PUBLIC_DEV_TOOLS=1 npx expo export --platform web --output-dir dist-web
// 2. Start the in-memory demo API:  PORT=3302 node apps/merchant/scripts/demo-api.mjs &
// 3. Run:  PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome \
//            node apps/merchant/scripts/web-shots.mjs <out-dir>
//
// Shot lists live in `scripts/shots/*.mjs` (wave 2 adds files, this one stays put). Each
// default-exports `{ name, viewports?: ['tablet', 'phone'], async run(h) }` and writes
// `<viewport>-<name>-<shot>.png` through `h.shot('<shot>')`. Filters:
//   SHOTS=board,menu        only these shot files (default: all)
//   VIEWPORTS=tablet        only these sizes (tablet 1280×800, phone 390×844, ipad 1024×768; default tablet,phone)
// Each viewport runs in a fresh browser context (empty storage). `h` is documented in makeHelpers().
// Exits non-zero on console errors or a missing screen.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(process.env.DIST_DIR ?? join(here, '../dist-web'));
const outDir = resolve(process.argv[2] ?? join(here, '../web-shots'));
const apiBase = (process.env.DEMO_API ?? 'http://127.0.0.1:3302').replace(/\/$/, '');
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) throw new Error(`No web export at ${dist}; run expo export first`);

export const VIEWPORTS = {
  tablet: { width: 1280, height: 800, deviceScaleFactor: 1.5 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2 },
  // MER-13: the most common iPad in landscape; only lists that name it run here.
  ipad: { width: 1024, height: 768, deviceScaleFactor: 2 },
};

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const file = existsSync(path) && !path.endsWith('/') && extname(path) ? path : join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const shotDir = join(here, 'shots');
const wantedFiles = (process.env.SHOTS ?? 'all').split(',').map((s) => s.trim()).filter(Boolean);
const files = readdirSync(shotDir).filter((f) => f.endsWith('.mjs')).sort();
const lists = [];
for (const f of files) {
  const mod = (await import(pathToFileURL(join(shotDir, f)).href)).default;
  if (wantedFiles.includes('all') || wantedFiles.includes(mod.name)) lists.push(mod);
}
for (const w of wantedFiles) if (w !== 'all' && !lists.some((l) => l.name === w)) throw new Error(`Unknown SHOTS "${w}" (have ${files.join(', ')})`);
const viewports = (process.env.VIEWPORTS ?? 'tablet,phone').split(',').map((s) => s.trim()).filter((v) => v in VIEWPORTS);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const errors = [];

/**
 * `h` for shot files:
 *   page, viewport ('tablet' | 'phone'), origin, apiBase
 *   byTestId(id)                    first element with that testID
 *   settle(ms)                      fonts ready + a pause for animations
 *   shot(name, { element, full })   writes <viewport>-<list>-<name>.png (element: a locator to crop)
 *   demoPost(path)                  POST to the demo API (errors fail the run)
 *   signIn(phone, { keepGate, lesson })  fresh storage, welcome → phone → OTP (dev code) → wherever the guard lands;
 *                                   on the board it skips the first-sign-in lesson (unless lesson) and taps
 *                                   "ابدأ الشغل" (unless keepGate, to shoot the gate)
 *   startShift()                    taps "ابدأ الشغل" if the gate is up (after a reload)
 *   goto(path)                      client-side route change (keeps the session)
 */
function makeHelpers(page, viewport, list) {
  const byTestId = (id) => page.locator(`[data-testid="${id}"]`).first();
  const settle = async (ms = 700) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(ms);
  };
  const shot = async (name, opts = {}) => {
    await settle(opts.wait ?? 700);
    const file = join(outDir, `${viewport}-${list}-${name}.png`);
    if (opts.element) await opts.element.screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: !!opts.full });
    console.log(file);
  };
  const demoPost = async (path) => {
    const r = await fetch(`${apiBase}${path}`, { method: 'POST' });
    if (!r.ok) errors.push(`${path}: ${r.status} ${await r.text()}`);
    return r.ok ? r.json() : null;
  };
  /** "ابدأ الشغل": the start-of-shift gate over the board (after sign-in and every reload). */
  const startShift = async () => {
    const gate = byTestId('shift-start');
    if (await gate.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
      await gate.click();
      await byTestId('shift-gate').waitFor({ state: 'detached', timeout: 5000 });
    }
  };
  /**
   * «تعلّم بدقيقة» shows the first time a person signs in on a device. Shots that aren't about it mark it
   * seen for the signed-in person and reload (no shift was started, so the plain gate comes back).
   */
  const skipLesson = async () => {
    if (!(await byTestId('learn-cards').waitFor({ timeout: 3000 }).then(() => true, () => false))) return;
    await page.evaluate(() => {
      const personId = JSON.parse(localStorage.getItem('driver.merchant.session') ?? '{}').personId || 'device';
      localStorage.setItem('driver.merchant.learned', JSON.stringify([personId]));
    });
    await page.reload({ waitUntil: 'load' });
    await byTestId('board').waitFor({ timeout: 20_000 });
  };
  const signIn = async (phone, { keepGate = false, lesson = false } = {}) => {
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${origin}/welcome`, { waitUntil: 'load' });
    await byTestId('welcome-start').waitFor({ timeout: 20_000 });
    await byTestId('welcome-start').click();
    await page.locator('[data-testid="phone-input"]').fill(phone);
    await byTestId('phone-submit').click();
    await byTestId('otp-dev-strip').waitFor({ timeout: 15_000 });
    const code = (await byTestId('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
    if (!code) throw new Error('dev code not shown');
    await page.locator('[data-testid="otp-input"]').fill(code);
    await Promise.race(['board', 'stores', 'not-activated', 'setup'].map((id) => byTestId(id).waitFor({ timeout: 20_000 })));
    const onBoard = await byTestId('board').isVisible().catch(() => false);
    if (onBoard && !lesson) await skipLesson();
    if (onBoard && !keepGate && !lesson) await startShift();
  };
  const goto = async (path) => {
    await page.evaluate((p) => {
      window.history.pushState({}, '', p);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await settle(400);
  };
  return { page, viewport, origin, apiBase, byTestId, settle, shot, demoPost, signIn, startShift, goto };
}

try {
  for (const viewport of viewports) {
    const vp = VIEWPORTS[viewport];
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, locale: 'ar-IQ' });
    const page = await context.newPage();
    page.on('console', (m) => {
      const text = m.text();
      if (m.type() === 'error' && !/findDOMNode|DevTools|props\.pointerEvents|shadow\*|WebSocket connection|ERR_TUNNEL_CONNECTION_FAILED|ERR_INTERNET_DISCONNECTED|AudioContext|status of 412/.test(text)) errors.push(`[${viewport}] ${text}`);
    });
    // The street map's Arabic shaping plugin comes from unpkg, which a sandbox without internet can't reach.
    page.on('pageerror', (e) => {
      if (!/mapbox-gl-rtl-text/.test(e.message)) errors.push(`[${viewport}] ${e.stack ?? e.message}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.request().method()} ${r.url()}`);
    });
    for (const list of lists) {
      if (list.viewports && !list.viewports.includes(viewport)) continue;
      await list.run(makeHelpers(page, viewport, list.name));
    }
    await context.close();
  }
} catch (err) {
  errors.push(String(err?.stack ?? err));
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error(`\n${errors.length} error(s):\n${errors.join('\n')}`);
  process.exit(1);
}
