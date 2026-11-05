// The new home's screenshot set (docs/specs/2026-11-01-home-redesign.md §11 step 5): every state of §7
// the demo can reach, in the light (sage) and dark (emerald night) themes, at 360, 390 and 430 wide.
//
// 1. Build packages, then export the web app with the new home switched on:
//      cd apps/customer && EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3200/trpc \
//        EXPO_PUBLIC_DEV_TOOLS=1 EXPO_PUBLIC_NEW_HOME=1 npx expo export --platform web --output-dir dist-new-home
// 2. Start a fresh demo API:  PORT=3200 node apps/customer/scripts/demo-api.mjs &
// 3. Run:  node apps/customer/scripts/home-shots.mjs <out-dir>
//      DIST_DIR=…  the export (default ../dist-new-home)     PLAYWRIGHT_MODULE=…  where playwright lives
//      WIDTHS=390  only some widths                          STATES=idle,on_the_way  only some states
//
// Files: <state>-<light|dark>-<width>.png, full page. States run in this order on one fresh account,
// because an order placed for one state stays: first visit, idle (the usual), night, Friday, loading,
// offline, arrived and cancelled (each still on the card for ten minutes), then the running orders
// (sent, kitchen, on the way, late with the new time) and a taxi still looking. The newest order is the
// one on the card. The map tiles need the network; without them the card keeps its land colour.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(process.env.DIST_DIR ?? join(here, '../dist-new-home'));
const outDir = resolve(process.argv[2] ?? join(here, '../home-shots'));
const apiBase = (process.env.DEMO_API ?? 'http://127.0.0.1:3200').replace(/\/$/, '');
const widths = (process.env.WIDTHS ?? '360,390,430').split(',').map(Number);
const only = process.env.STATES ? new Set(process.env.STATES.split(',')) : null;
const THEMES = ['light', 'dark'];
mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  const file = existsSync(path) && extname(path) ? path : join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-IQ' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/findDOMNode|DevTools|pointerEvents|shadow|WebSocket|ERR_TUNNEL|ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/.test(m.text())) errors.push(m.text());
});
const by = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).first();
const settle = async (ms = 1200) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
};
const demo = async (path) => {
  const r = await fetch(`${apiBase}${path}`, { method: 'POST' });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
};

/** Signs a new number in (any number works in the demo), names it and saves a place; lands on home. */
async function signIn() {
  await page.goto(`${origin}/`, { waitUntil: 'load' });
  await by('welcome-signin').waitFor({ timeout: 30_000 });
  await by('welcome-signin').click();
  await page.locator('[data-testid="phone-input"]').fill(`0770 ${String(Date.now()).slice(-7, -4)} ${String(Date.now()).slice(-4)}`);
  await by('phone-submit').click();
  await by('otp-dev-strip').waitFor({ timeout: 15_000 });
  const code = (await by('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
  await page.locator('[data-testid="otp-input"]').fill(code);
  const landed = await Promise.race([by('setup-name').waitFor({ timeout: 15_000 }).then(() => 'setup'), by('home').waitFor({ timeout: 15_000 }).then(() => 'home')]);
  if (landed === 'setup') {
    await page.locator('[data-testid="setup-name"]').fill('حسن');
    const box = await by('place-map').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 8 });
    await page.mouse.up();
    await settle(800);
    await by('setup-save').click();
    for (let i = 0; i < 10 && (await by('welcome-home').count()); i++) {
      await by('welcome-home').click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
  await by('home').waitFor({ timeout: 15_000 });
  return page.evaluate(() => JSON.parse(localStorage.getItem('driver.customer.session') ?? '{}').personId ?? null);
}

/** The page's full height, counting scrolling views inside it. */
const fullHeight = () =>
  page.evaluate(() => {
    let max = document.documentElement.scrollHeight;
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') max = Math.max(max, el.scrollHeight + 100);
    }
    return max;
  });

/**
 * One state in every theme and width. `query` adds to the home's URL (`now=` for the dev clock);
 * `before` runs after the load and before the picture (offline); `early` shoots before the data lands.
 */
async function shoot(state, { query = '', wait = 'home', before, early = false } = {}) {
  if (only && !only.has(state)) return;
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    for (const w of widths) {
      const h = w <= 360 ? 740 : w >= 430 ? 932 : 844;
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${origin}/${query}`, { waitUntil: 'load' });
      if (early) {
        await page.waitForTimeout(900);
      } else {
        await by(wait).waitFor({ timeout: 20_000 }).catch(() => errors.push(`${state} ${theme} ${w}: ${wait} not shown`));
        if (before) await before();
        await settle();
        await page.setViewportSize({ width: w, height: Math.min(Math.max(h, await fullHeight()), 4000) });
        await settle(700);
      }
      await page.screenshot({ path: join(outDir, `${state}-${theme}-${w}.png`) });
      if (before) await context.setOffline(false);
    }
  }
  console.log(state);
}

try {
  const personId = await signIn();
  await shoot('first');
  await demo(`/demo/usuals?personId=${encodeURIComponent(personId)}`);
  await shoot('idle');
  await shoot('night', { query: '?now=23:30' });
  // A Friday lunch (the usual's Friday words, Friday dishes).
  const friday = new Date();
  friday.setUTCDate(friday.getUTCDate() + ((5 - friday.getUTCDay() + 7) % 7));
  await shoot('friday', { query: `?now=${friday.toISOString().slice(0, 10)}T13:00:00%2B03:00` });
  // Loading: every read held back, so the card shapes show.
  await page.route('**/trpc/**', async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue().catch(() => {});
  });
  await shoot('loading', { early: true });
  await page.unroute('**/trpc/**');
  await shoot('offline', {
    before: async () => {
      await context.setOffline(true);
      await page.evaluate("window.dispatchEvent(new Event('offline'))");
      await page.waitForTimeout(1500);
    },
  });
  for (const scenario of ['arrived', 'cancelled', 'placed', 'kitchen', 'on_the_way', 'late_apology', 'ride']) {
    if (only && !only.has(scenario)) continue;
    await demo(`/demo/track?personId=${encodeURIComponent(personId)}&scenario=${scenario}`);
    await shoot(scenario, { wait: 'home-order' });
  }
} catch (e) {
  errors.push(String(e?.stack ?? e));
  await page.screenshot({ path: join(outDir, 'error.png') }).catch(() => {});
} finally {
  console.log('ERRORS', JSON.stringify(errors.slice(0, 20), null, 1));
  await browser.close();
  server.close();
  if (errors.length) process.exitCode = 1;
}
