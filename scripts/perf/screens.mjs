#!/usr/bin/env node
/**
 * Screens budget (speed audit g3 + h4): opens the customer app's main screens and the restaurant board
 * in Chromium, like an installed app (files local, API = the in-memory demo API), and measures:
 *   - open_kb       data the screen downloads to open (and while it settles: 5 s, home 25 s) (uncompressed JSON; the server squeezes it later)
 *   - idle_commits  React redraws per minute while nobody touches the screen
 *   - idle_fps      animation frames the app asks for per second while idle
 *   - idle_kb       data per minute while idle (polling, live updates)
 * Idle screens should be still: a redraw every second or a loop at 60 frames is battery for nothing.
 * Counting redraws and frames (not CPU %) keeps the check steady on shared CI machines.
 *
 *   pnpm build
 *   (cd apps/customer && EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3200/trpc EXPO_PUBLIC_DEV_TOOLS=1 npx expo export --platform web --clear --output-dir dist-web)
 *   (cd apps/merchant && EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:3302/trpc EXPO_PUBLIC_DEV_TOOLS=1 npx expo export --platform web --clear --output-dir dist-web)
 *   node scripts/perf/screens.mjs          # IDLE_SECS=30 by default
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  byTestId,
  installCounters,
  judge,
  loadChromium,
  report,
  serveDist,
  startDemoApi,
} from './lib.mjs';

const root = resolve(import.meta.dirname, '../..');
const budgets = JSON.parse(readFileSync(join(import.meta.dirname, 'budgets.json'), 'utf8')).screens;
const IDLE_SECS = Number(process.env.IDLE_SECS ?? 30);
const SETTLE_MS = 5_000;
/** Home plays its moving touches for 20 s after it opens or comes back (h1), then rests: count after that. */
const HOME_SETTLE_MS = 25_000;
/** The home tab's label (nav.home); the tab bar has no test ids. */
const HOME_TAB = JSON.parse(
  readFileSync(join(root, 'packages', 'i18n', 'src', 'locales', 'ar-IQ.json'), 'utf8'),
)['nav.home'];
const chromium = await loadChromium(root);
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const measured = {};
const cleanup = [];

/** A page that counts redraws, frames and API bytes. */
async function newPage(apiBase, viewport) {
  const page = await browser.newPage({ viewport, locale: 'ar-IQ' });
  await page.route(/tile|openfreemap|maptiler|\.pbf/, (r) => r.abort());
  await installCounters(page);
  const net = { bytes: 0 };
  page.on('response', async (r) => {
    if (!r.url().startsWith(apiBase) || r.url().includes('/demo/')) return;
    const len = Number(r.headers()['content-length'] ?? NaN);
    if (Number.isFinite(len)) net.bytes += len;
    else
      net.bytes += await r.body().then(
        (b) => b.length,
        () => 0,
      );
  });
  return { page, net };
}

/** Opens a screen, lets it settle, then watches it untouched for IDLE_SECS. */
async function measure(name, { page, net }, open, settleMs = SETTLE_MS) {
  net.bytes = 0;
  await open();
  await page.waitForTimeout(settleMs);
  measured[`${name}.open_kb`] = Math.round(net.bytes / 1024);
  const before = await page.evaluate(() => ({ ...window.__perf }));
  net.bytes = 0;
  await page.waitForTimeout(IDLE_SECS * 1000);
  const after = await page.evaluate(() => ({ ...window.__perf }));
  measured[`${name}.idle_commits`] = Math.round(
    ((after.commits - before.commits) * 60) / IDLE_SECS,
  );
  measured[`${name}.idle_fps`] = Math.round((after.frames - before.frames) / IDLE_SECS);
  measured[`${name}.idle_kb`] = Math.round((net.bytes / 1024) * (60 / IDLE_SECS));
  console.log(
    name,
    JSON.stringify(
      Object.fromEntries(Object.entries(measured).filter(([k]) => k.startsWith(`${name}.`))),
    ),
  );
}

async function signIn(page, by, phone, start, landed) {
  await by(start).click({ timeout: 30_000 });
  await page.locator('[data-testid="phone-input"]').fill(phone);
  await by('phone-submit').click();
  await by('otp-dev-strip').waitFor({ timeout: 20_000 });
  await page
    .locator('[data-testid="otp-input"]')
    .fill((await by('otp-dev-strip').innerText()).match(/\d{6}/)[0]);
  return landed();
}

try {
  // ── customer app ──
  {
    const api = await startDemoApi(root, 'customer', 3200);
    cleanup.push(api.stop);
    const dist = await serveDist(
      process.env.CUSTOMER_DIST ?? join(root, 'apps', 'customer', 'dist-web'),
    );
    cleanup.push(dist.close);
    const ctx = await newPage(api.base, { width: 390, height: 844 });
    const { page } = ctx;
    const by = (id) => byTestId(page, id);
    await page.goto(dist.origin + '/', { waitUntil: 'load' });
    await signIn(
      page,
      by,
      '0770 999 7001',
      'welcome-signin',
      async () => {
        const at = await Promise.race([
          by('setup-name')
            .waitFor({ timeout: 20_000 })
            .then(() => 'setup'),
          by('home')
            .waitFor({ timeout: 20_000 })
            .then(() => 'home'),
        ]);
        if (at === 'setup') {
          await page.locator('[data-testid="setup-name"]').fill('علي');
          await by('setup-next').click();
          await by('chip-street_30').click();
          await by('setup-save').click();
          if (
            await by('welcome-home')
              .waitFor({ timeout: 8_000 })
              .then(
                () => true,
                () => false,
              )
          )
            await by('welcome-home').click();
        }
        await by('home').waitFor({ timeout: 20_000 });
      },
      HOME_SETTLE_MS,
    );
    const personId = await page.evaluate(
      () => JSON.parse(localStorage.getItem('driver.customer.session') ?? '{}').personId ?? null,
    );
    const seed = await (await fetch(`${api.base}/demo/seed`)).json();
    const khalid = seed.find((r) => r.key === 'khalid').orgId;
    const go = async (path, waitId) => {
      await page.goto(dist.origin + path, { waitUntil: 'load' });
      await by(waitId).waitFor({ timeout: 20_000 });
    };
    await measure('home', ctx, () => go('/', 'home'), HOME_SETTLE_MS);
    await measure('food', ctx, () => go('/food', 'food-home'));
    await measure('menu', ctx, () => go(`/restaurant/${khalid}`, `dish-${khalid}_kebab_wrap`));
    await measure('orders', ctx, async () => {
      await page.goto(dist.origin + '/orders', { waitUntil: 'load' });
      await page.waitForTimeout(1_500);
    });
    const { orderId } = await (
      await fetch(
        `${api.base}/demo/track?personId=${encodeURIComponent(personId)}&scenario=on_the_way`,
        { method: 'POST' },
      )
    ).json();
    await measure('live_order', ctx, () => go(`/order/${orderId}`, 'status-line'));
    // Back on home after «طلباتي» was opened while an order is live: the orders tab stays mounted out of
    // sight and must not keep animating there (its live status pill pulsed forever, found 2026-10-08).
    await measure(
      'home_over_orders',
      ctx,
      async () => {
        await page.goto(dist.origin + '/orders', { waitUntil: 'load' });
        await by(`order-${orderId}`).waitFor({ timeout: 20_000 });
        await page.getByText(HOME_TAB, { exact: true }).last().click();
        await by('home').waitFor({ timeout: 20_000 });
      },
      HOME_SETTLE_MS,
    );
    await page.close();
  }
  // ── restaurant board (tablet) ──
  {
    const api = await startDemoApi(root, 'merchant', 3302);
    cleanup.push(api.stop);
    const dist = await serveDist(
      process.env.MERCHANT_DIST ?? join(root, 'apps', 'merchant', 'dist-web'),
    );
    cleanup.push(dist.close);
    const ctx = await newPage(api.base, { width: 1280, height: 800 });
    const { page } = ctx;
    const by = (id) => byTestId(page, id);
    await page.goto(`${dist.origin}/welcome`, { waitUntil: 'load' });
    await signIn(page, by, '0770 123 4567', 'welcome-start', () =>
      by('board').waitFor({ timeout: 20_000 }),
    );
    await page.waitForTimeout(1_500);
    if (
      await by('shift-start')
        .isVisible()
        .catch(() => false)
    )
      await by('shift-start').click();
    await measure('board', ctx, async () => {
      await fetch(`${api.base}/demo/board/fresh`, { method: 'POST' });
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="card-number-"]').length >= 3,
        null,
        { timeout: 30_000 },
      );
    });
    await page.close();
  }
} finally {
  await browser.close();
  for (const stop of cleanup) stop();
}

const unit = Object.fromEntries(
  Object.keys(measured).map((k) => [
    k,
    k.endsWith('_kb') ? ' KB' : k.endsWith('_fps') ? '/s' : '/min',
  ]),
);
const result = judge(budgets, measured);
const md = report('Screens: data and idle redraws', result, unit);
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(measured, null, 1));
if (!result.ok) {
  console.error(
    'Over the screens budget. Lower the work, or raise the number in scripts/perf/budgets.json in the same PR and say why.',
  );
  process.exit(1);
}
