// Screenshots of Console › حجز بالتلفون (/phone) against the demo API (scripts/demo-api.mjs).
//
//   CONSOLE_URL=http://127.0.0.1:3396 API_URL=http://127.0.0.1:3395 SHOTS_DIR=/tmp/shots \
//   PLAYWRIGHT_MODULE=…/playwright/index.mjs CHROMIUM_PATH=…/chrome node apps/console/scripts/phone-shots.mjs
//
// Signs in as علي (0770 000 0001), then: the page as it opens (empty with `DEMO_PHONE=0` on the demo
// API), the form filled with the server's quote, the booking made and taken by a demo driver
// (POST /demo/phone-accept) in today's list, the cancel dialog, and the page at tablet width.
// PHONE_SHOTS=list only shoots the list as the demo seeded it (`DEMO_PHONE` on).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CONSOLE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3396';
const API = process.env.API_URL ?? 'http://127.0.0.1:3395';
const DIR = process.env.SHOTS_DIR ?? './shots';
const ONLY_LIST = process.env.PHONE_SHOTS === 'list';
mkdirSync(DIR, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ar-IQ', timezoneId: 'Asia/Baghdad' });
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

// Sign in through the OTP form (the dev OTP button fills the code).
await page.goto(`${CONSOLE}/login`, { waitUntil: 'networkidle' });
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

await page.goto(`${CONSOLE}/phone`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

if (ONLY_LIST) {
  await shot('phone-list-seeded', { full: true });
} else {
  await shot('phone-01-empty');

  // A caller reads out his number and name; staff pick منين/لوين from the landmarks.
  await page.locator('#pb-phone').fill('0771 234 5678');
  await page.waitForTimeout(1200);
  await page.locator('#pb-name').fill('أبو حسين');
  const pick = async (index, query, name) => {
    const box = page.getByRole('combobox').nth(index);
    await box.click();
    await box.fill(query);
    await page.waitForTimeout(400);
    await page.getByRole('option', { name }).first().dispatchEvent('mousedown');
    await page.waitForTimeout(300);
  };
  await pick(0, 'الجامع', /باب الجامع الكبير/);
  await pick(0, 'حديقة', /حديقة الشاشة/);
  await page.waitForTimeout(1500);
  await page.getByRole('radio', { name: /تكتك/ }).click();
  await page.locator('#pb-note').fill('واگف يم الباب الجانبي، لابس دشداشة بيضة');
  await page.waitForTimeout(500);
  await shot('phone-02-quote', { full: true });

  await page.getByRole('button', { name: /^احجز$/ }).click();
  await page.waitForTimeout(1200);
  await shot('phone-03-booked-searching');

  // A demo taxi driver takes it at once (before a simulator driver does).
  const accepted = await fetch(`${API}/demo/phone-accept`, { method: 'POST' }).then((r) => r.json());
  console.log('  demo driver took', accepted.orderId ?? accepted.error);
  await page.waitForTimeout(11_000);
  await shot('phone-04-driver-coming');

  await page.getByRole('button', { name: /^ألغي$/ }).first().click();
  await page.waitForTimeout(1500);
  await shot('phone-05-cancel-dialog');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 834, height: 1112 });
  await page.waitForTimeout(800);
  await shot('phone-06-tablet', { full: true });
}

await browser.close();
if (errors.length) {
  console.log(`\nBrowser errors (${errors.length}):`);
  for (const e of errors.slice(0, 30)) console.log(`  ${e}`);
}
console.log(`API ${API} · shots in ${DIR}`);
