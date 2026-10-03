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
// app-profile PNGs at 390×844 (@2x), then the M3 account set (seeded by POST /demo/account):
// acct-profile, acct-place-editor, acct-wallet, acct-household (+ -full). SHOTS_PREFIX=acct keeps
// only those. Exits non-zero on console errors or a missing screen.
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
/** SHOTS_PREFIX=acct writes only acct-* files (other prefixes are still driven, not saved). */
const shotsPrefix = process.env.SHOTS_PREFIX ?? '';
const shot = async (name) => {
  if (shotsPrefix && !name.startsWith(shotsPrefix)) return;
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

  // ── M3 account: seed places / points / household for this person, then profile, place editor,
  //    wallet and household approvals (acct-*).
  if (personId) {
    const r = await fetch(`${apiBase}/demo/account?personId=${encodeURIComponent(personId)}`, { method: 'POST' });
    if (!r.ok) errors.push(`seed account: ${r.status} ${await r.text()}`);
    await page.reload({ waitUntil: 'networkidle' });
  }
  await byTestId('tab-account').click();
  await byTestId('account').waitFor();
  await page.locator('[data-testid^="place-sp_"]').first().waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await shot('acct-profile');
  await fullShot('acct-profile-full');

  await page.locator('[data-testid^="place-sp_"]').first().click();
  await byTestId('place-edit').waitFor({ timeout: 15_000 });
  await byTestId('place-map').waitFor();
  await shot('acct-place-editor');
  await fullShot('acct-place-editor-full');
  await page.goBack();

  await byTestId('tab-wallet').click();
  await byTestId('wallet-points').waitFor({ timeout: 15_000 });
  await byTestId('wallet-lines').waitFor({ timeout: 15_000 });
  await shot('acct-wallet');
  await fullShot('acct-wallet-full');

  await page.goto(`${origin}/household`, { waitUntil: 'networkidle' });
  await byTestId('household').waitFor({ timeout: 15_000 });
  await shot('acct-household');
  await fullShot('acct-household-full');
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
