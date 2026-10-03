// Drives the exported web build of the customer app through sign-in and screenshots each screen.
//
// 1. Build packages and export the app for web with the demo API URL and the OTP dev strip on:
//      pnpm build
//      cd apps/customer && EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3200/trpc \
//        EXPO_PUBLIC_DEV_TOOLS=1 npx expo export --platform web --output-dir dist-web
// 2. Start the in-memory demo API:  PORT=3200 node apps/customer/scripts/demo-api.mjs &
// 3. Run:  PLAYWRIGHT_MODULE=/path/to/node_modules/playwright CHROMIUM_PATH=/path/to/chrome \
//            node apps/customer/scripts/web-shots.mjs <out-dir>
//
// Writes app-welcome, app-phone, app-otp, app-setup, app-home (+ app-home-full), app-orders and
// app-profile PNGs at 390×844 (@2x). Exits non-zero on console errors or a missing screen.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(process.env.DIST_DIR ?? join(here, '../dist-web'));
const outDir = resolve(process.argv[2] ?? join(here, '../web-shots'));
const apiBase = (process.env.DEMO_API ?? 'http://127.0.0.1:3200').replace(/\/$/, '');
const phone = process.env.DEMO_PHONE ?? '0770 123 4567';
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) throw new Error(`No web export at ${dist}; run expo export first`);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ' });
const errors = [];
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error' && !/findDOMNode|DevTools|props\.pointerEvents|shadow\*|WebSocket connection/.test(text)) errors.push(text);
});
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
page.on('response', (r) => {
  if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.request().method()} ${r.url()}`);
});

const byTestId = (id) => page.locator(`[data-testid="${id}"]`).first();
const settle = async (ms = 700) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
};
// SHOTS=rajaa (comma list of name prefixes) writes only matching screenshots; the flow still runs.
const only = process.env.SHOTS ? process.env.SHOTS.split(',').map((s) => s.trim()).filter(Boolean) : null;
const shot = async (name) => {
  if (only && !only.some((p) => name.startsWith(p))) return;
  await settle();
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
};
/** Grow the viewport to the RN scroll content (the ScrollView owns scrolling on web). */
const fullShot = async (name) => {
  const h = await page.evaluate(() => {
    let max = document.documentElement.scrollHeight;
    for (const el of document.querySelectorAll('div')) {
      const s = getComputedStyle(el);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') max = Math.max(max, el.scrollHeight + 160);
    }
    return max;
  });
  await page.setViewportSize({ width: 390, height: Math.min(h, 4000) });
  await shot(name);
  await page.setViewportSize({ width: 390, height: 844 });
};

const demoPost = async (path) => {
  const r = await fetch(`${apiBase}${path}`, { method: 'POST' });
  if (!r.ok) errors.push(`${path}: ${r.status} ${await r.text()}`);
};

async function rajaaShots(personId) {
  await page.goto(`${origin}/rajaa`, { waitUntil: 'networkidle' });
  await byTestId('rajaa-board').waitFor({ timeout: 15_000 });
  const firstCar = page.locator('[data-testid="garage-mp_garage_nahdha"] [data-testid^="departure-"]').first();
  await firstCar.waitFor({ timeout: 15_000 });
  await shot('rajaa-board');
  await fullShot('rajaa-board-full');

  // Seat booking: declare نساء, tap the back-middle seat between two men → explained, not sold.
  await firstCar.click();
  await byTestId('rajaa-book').waitFor({ timeout: 15_000 });
  await byTestId('chip-nisa').click();
  await page.waitForTimeout(1200); // board refetch with travellingAs
  await page.locator('[data-testid="rajaa-book"] [data-testid="seat-back_middle"]').click();
  await byTestId('rajaa-blocked-note').waitFor({ timeout: 10_000 });
  await byTestId('rajaa-blocked-note').scrollIntoViewIfNeeded();
  await shot('rajaa-seat-blocked');
  await fullShot('rajaa-seat-sheet');

  // As رجال the same seat is open: hold it.
  await byTestId('chip-rijal').click();
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="rajaa-book"] [data-testid="seat-back_middle"]').click();
  await byTestId('rajaa-quote').waitFor({ timeout: 10_000 });
  await byTestId('rajaa-hold').click();
  await byTestId('rajaa-hold-ring').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await shot('rajaa-hold');
  await fullShot('rajaa-hold-full');

  // Cash reservation → boarding pass (boarding is open on this car: live position shows).
  await byTestId('rajaa-confirm').click();
  await byTestId('rajaa-ticket').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shot('rajaa-pass');
  await fullShot('rajaa-pass-full');

  // أريد أرجع: post for the coming hour → "N people waiting with you" → a driver announces → claimed.
  await page.goto(`${origin}/rajaa/demand?corridor=aziziyah_baghdad&direction=to_aziziyah`, { waitUntil: 'networkidle' });
  await byTestId('rajaa-demand').waitFor({ timeout: 15_000 });
  await byTestId('chip-rijal').click();
  await shot('rajaa-demand');
  await byTestId('rajaa-demand-submit').click();
  await byTestId('rajaa-demand-posted').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shot('rajaa-demand-posted');
  if (personId) {
    await demoPost(`/demo/rajaa/claim?personId=${encodeURIComponent(personId)}`);
    await byTestId('rajaa-demand-claimed').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await shot('rajaa-demand-claimed');
  }

  // Request board: post → offers arrive → pick one → deposit rules → matched.
  await page.goto(`${origin}/rajaa/request`, { waitUntil: 'networkidle' });
  await byTestId('rajaa-request-form').waitFor({ timeout: 15_000 });
  await page.locator('[data-testid="rajaa-req-from"]').fill('العزيزية، حي الزهراء');
  await page.locator('[data-testid="rajaa-req-to"]').fill('النجف');
  await shot('rajaa-request-form');
  await byTestId('rajaa-request-submit').click();
  await page.locator('[data-testid^="request-"]').first().waitFor({ timeout: 15_000 });
  if (personId) {
    await demoPost(`/demo/rajaa/offers?personId=${encodeURIComponent(personId)}`);
    await demoPost(`/demo/rajaa/topup?personId=${encodeURIComponent(personId)}&amount=25000`);
    const offer = page.locator('[data-testid^="offer-"]').first();
    await offer.waitFor({ timeout: 20_000 });
    await offer.click();
    await byTestId('rajaa-deposit').waitFor({ timeout: 10_000 });
    await shot('rajaa-request');
    await byTestId('rajaa-deposit-confirm').click();
    await byTestId('rajaa-deposit').waitFor({ state: 'detached', timeout: 15_000 });
    await page.waitForTimeout(1000);
    await shot('rajaa-request-matched');
  }

  // Home: the الرجعة card now reads the live board (and the booked trip).
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await byTestId('home-rajaa-summary').waitFor({ timeout: 15_000 });
  await shot('rajaa-home');
}

try {
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await byTestId('welcome-start').waitFor({ timeout: 20_000 });
  await shot('app-welcome');

  await byTestId('welcome-start').click();
  const input = page.locator('[data-testid="phone-input"]');
  await input.waitFor();
  await input.fill(phone);
  await shot('app-phone');

  await byTestId('phone-submit').click();
  await byTestId('otp-dev-strip').waitFor({ timeout: 15_000 });
  await shot('app-otp');

  const code = (await byTestId('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
  if (!code) throw new Error('dev code not shown');
  await page.locator('[data-testid="otp-input"]').fill(code);

  // New account → setup (name, then first place); a returning one goes straight home.
  const landed = await Promise.race([
    byTestId('setup-name').waitFor({ timeout: 15_000 }).then(() => 'setup'),
    byTestId('home').waitFor({ timeout: 15_000 }).then(() => 'home'),
  ]);
  if (landed === 'setup') {
    await page.locator('[data-testid="setup-name"]').fill('علي');
    await byTestId('setup-next').click();
    await byTestId('chip-street_30').click();
    await shot('app-setup');
    await byTestId('setup-save').click();
  }
  await byTestId('home').waitFor({ timeout: 15_000 });

  // Seed an in-progress order for this person through the demo hook, then reload home.
  const personId = await page.evaluate(() => JSON.parse(localStorage.getItem('driver.customer.session') ?? '{}').personId ?? null);
  if (personId) {
    const r = await fetch(`${apiBase}/demo/active-order?personId=${encodeURIComponent(personId)}`, { method: 'POST' });
    if (!r.ok) errors.push(`seed active order: ${r.status} ${await r.text()}`);
    await page.reload({ waitUntil: 'networkidle' });
    await byTestId('home').waitFor();
  }
  await byTestId('home-active-order').waitFor({ timeout: 15_000 }).catch(() => errors.push('active order pill not shown'));
  await byTestId('restaurant-fx-khalid').waitFor({ timeout: 15_000 });
  await shot('app-home');
  await fullShot('app-home-full');

  await byTestId('tab-orders').click();
  await byTestId('orders').waitFor();
  await shot('app-orders');

  await byTestId('tab-account').click();
  await byTestId('account').waitFor();
  await shot('app-profile');

  // ── الرجعة: board → seat booking (blocked seat) → hold → boarding pass → demand → request board ──
  // Needs the demo API's الرجعة seed (scripts/demo-api.mjs). Writes rajaa-*.png.
  if (!only || only.some((p) => p.startsWith('rajaa'))) await rajaaShots(personId);
} catch (err) {
  errors.push(err.stack ?? String(err));
  await page.screenshot({ path: join(outDir, 'app-failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error('Errors:\n' + errors.map((e) => JSON.stringify(e).slice(0, 2000)).join('\n'));
  process.exitCode = 1;
}
