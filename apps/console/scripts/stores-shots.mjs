// Screenshots of Console › المطاعم (restaurant setup by our team) against the demo API.
//
//   CONSOLE_URL=http://127.0.0.1:3396 API_URL=http://127.0.0.1:3395 SHOTS_DIR=/tmp/shots \
//   PLAYWRIGHT_MODULE=…/playwright/index.mjs CHROMIUM_PATH=…/chrome node apps/console/scripts/stores-shots.mjs
//
// Signs in as علي (0770 000 0001), approves the demo's new shop (فلافل أبو علي) when it is still
// waiting, then captures the list, the 7-step visit, the menu with «الصق المنيو» and the photo
// library, the hours, an open shop's switches and the history, at 1600×1000 and a phone width.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CONSOLE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3396';
const API = process.env.API_URL ?? 'http://127.0.0.1:3395';
const DIR = process.env.SHOTS_DIR ?? './shots';
const SETTLE = Number(process.env.SHOT_SETTLE_MS ?? 2000);
mkdirSync(DIR, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ar-IQ', timezoneId: 'Asia/Baghdad' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource|tile\.openstreetmap/.test(m.text())) errors.push(m.text().slice(0, 200));
});

async function shot(name, { full = false } = {}) {
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.screenshot({ path: join(DIR, `${name}.png`), fullPage: full });
  console.log(`  ▣ ${name}`);
}
async function go(path) {
  await page.goto(`${CONSOLE}${path}`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(SETTLE);
}

await go('/login');
await page.locator('input').first().fill('07700000001');
await page.getByRole('button').first().click();
await page.waitForTimeout(1200);
const fill = page.getByRole('button', { name: /عبّيه/ });
if (await fill.count()) await fill.click();
else {
  const res = await fetch(`${API}/trpc/identity.devLastOtp?input=${encodeURIComponent(JSON.stringify({ json: { phone: '07700000001' } }))}`);
  const code = (await res.json()).result?.data?.json?.code;
  await page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]').last().fill(code ?? '');
}
await page.getByRole('button', { name: /^ادخل$/ }).click();
await page.waitForTimeout(1500);
// The «شغّل صوت الإنذار» prompt would cover the bottom of every shot: turn the sound on once.
await page.getByRole('button', { name: 'شغّل صوت الإنذار' }).click({ timeout: 5000 }).catch(() => undefined);

// The demo's new shop waits in approvals: approve it so a shop in setup shows.
await go('/approvals');
await page.getByRole('button', { name: /فلافل أبو علي/ }).first().click().catch(() => undefined);
await page.waitForTimeout(800);
await page.getByRole('button', { name: /^وافق|موافقة|اقبل/ }).first().click().catch(() => undefined);
await page.waitForTimeout(800);
await page.locator('dialog button').filter({ hasText: /وافق|أكّد|اقبل/ }).first().click().catch(() => undefined);
await page.waitForTimeout(1200);

await go('/stores');
await shot('01-list');
const setupRow = page.getByTestId('store-row').filter({ hasText: 'يتجهّز' }).first();
const hasSetup = (await setupRow.count()) > 0;
if (hasSetup) {
  await setupRow.click();
  await page.waitForTimeout(SETTLE);
  await shot('02-visit');
  await shot('02-visit-full', { full: true });
  await page.getByRole('tab', { name: 'المنيو' }).click();
  await page.waitForTimeout(SETTLE);
  await page.getByRole('button', { name: 'الصق المنيو' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('#paste-menu').fill('فلافل:\nلفة فلافل 1000\nصمونة فلافل 750\nصحن فلافل 3\nمقبلات:\nحمص 2,000\nعمبة إضافية 250\nاسأل عن عرض اليوم');
  await page.waitForTimeout(400);
  await shot('03-paste');
  await page.locator('dialog[open] button').filter({ hasText: /زيد الأكلات/ }).click();
  await page.waitForTimeout(SETTLE);
  await shot('04-menu');
  await page.getByTestId('dish-photo').first().click();
  await page.waitForTimeout(1500);
  await shot('05-library');
  await page.locator('dialog[open] ul button').first().click();
  await page.waitForTimeout(SETTLE);
  await shot('06-menu-after-photo');
  await page.getByRole('tab', { name: 'الدوام' }).click();
  await page.waitForTimeout(SETTLE);
  await page.getByRole('button', { name: '16:00–01:00' }).click().catch(() => undefined);
  await shot('07-hours');
  await page.getByRole('tab', { name: 'المحل' }).click();
  await page.waitForTimeout(SETTLE);
  await shot('08-visit-after');
}
// An open shop: its switches and history.
const liveRow = page.getByTestId('store-row').filter({ hasText: 'مفتوح' }).first();
await liveRow.click();
await page.waitForTimeout(SETTLE);
await shot('09-live-shop');
await page.getByRole('tab', { name: 'المنيو' }).click();
await page.waitForTimeout(SETTLE);
const price = page.getByTestId('dish-row').first().locator('input').nth(1);
await price.fill('9,500');
await price.press('Enter');
await page.waitForTimeout(SETTLE);
await shot('10-live-menu');
await page.getByRole('tab', { name: 'السجل' }).click();
await page.waitForTimeout(SETTLE);
await shot('11-history');

// Phone width.
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('tab', { name: 'المنيو' }).click();
await page.waitForTimeout(SETTLE);
await shot('12-phone-menu');
await page.getByRole('tab', { name: 'المحل' }).click();
await page.waitForTimeout(SETTLE);
await shot('13-phone-shop', { full: true });

console.log(hasSetup ? '' : '  (no shop in setup in this demo)');
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
await browser.close();
