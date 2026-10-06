// Screenshots of the launch-week control room against the demo API (scripts/demo-api.mjs).
//
//   CONSOLE_URL=http://127.0.0.1:3396 API_URL=http://127.0.0.1:3395 SHOTS_DIR=/tmp/shots \
//   PLAYWRIGHT_MODULE=…/playwright/index.mjs CHROMIUM_PATH=…/chrome node apps/console/scripts/shots.mjs
//
// Signs in as علي (0770 000 0001) through the real /login page, then captures each page at 1440×900
// (and a full-page twin) into SHOTS_DIR: controls, the switch dialog, approvals, support queue and
// case, finance, wall.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CONSOLE = process.env.CONSOLE_URL ?? 'http://127.0.0.1:3396';
const API = process.env.API_URL ?? 'http://127.0.0.1:3395';
const DIR = process.env.SHOTS_DIR ?? './shots';
const SETTLE = Number(process.env.SHOT_SETTLE_MS ?? 2500);
mkdirSync(DIR, { recursive: true });

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'ar-IQ', timezoneId: 'Asia/Baghdad' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource|tile\.openstreetmap/.test(m.text())) errors.push(m.text().slice(0, 200));
});

async function shot(name, { full = true } = {}) {
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.screenshot({ path: join(DIR, `${name}.png`) });
  if (full) await page.screenshot({ path: join(DIR, `${name}-full.png`), fullPage: true });
  console.log(`  ▣ ${name}`);
}
async function go(path) {
  await page.goto(`${CONSOLE}${path}`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.waitForTimeout(SETTLE);
}

// Sign in through the OTP form (dev OTP button fills the code).
await go('/login');
await page.locator('input').first().fill('07700000001');
await page.getByRole('button').first().click();
await page.waitForTimeout(1200);
const fill = page.getByRole('button', { name: /عبّيه/ });
if (await fill.count()) await fill.click();
else {
  // A production build hides the dev code: read it from the demo API (fake SMS) and type it in.
  const res = await fetch(`${API}/trpc/identity.devLastOtp?input=${encodeURIComponent(JSON.stringify({ json: { phone: '07700000001' } }))}`);
  const code = (await res.json()).result?.data?.json?.code;
  await page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]').last().fill(code ?? '');
}
await page.getByRole('button', { name: /^ادخل$/ }).click(); // console.login_enter
await page.waitForTimeout(1500);

await go('/controls');
await shot('01-controls');
await page.getByRole('button', { name: /^تكسي/ }).first().click().catch(() => undefined);
await page.waitForTimeout(500);
await page.locator('dialog input').first().fill('عاصفة ترابية والرؤية قليلة').catch(() => undefined);
await shot('02-controls-switch-dialog', { full: false });
await page.keyboard.press('Escape');

await go('/approvals');
await shot('03-approvals');
await page.getByRole('button', { name: /إجازة السوق/ }).first().click().catch(() => undefined);
await page.waitForTimeout(800);
await shot('04-approvals-licence');
await page.getByRole('button', { name: /فلافل أبو علي/ }).first().click().catch(() => undefined);
await page.waitForTimeout(800);
await shot('05-approvals-onboarding');

await go('/support');
await shot('06-support');
const dispute = page.getByRole('link', { name: /تأخّر|ناقص/ }).first();
const first = (await dispute.count()) ? dispute : page.locator('a[href^="/support/"]').first();
const href = await first.getAttribute('href').catch(() => null);
if (href) {
  await go(href);
  await shot('07-support-case');
}

await go('/finance');
await shot('08-finance');
await go('/wall');
await shot('09-wall');

await browser.close();
if (errors.length) {
  console.log(`\nBrowser errors (${errors.length}):`);
  for (const e of errors.slice(0, 30)) console.log(`  ${e}`);
}
console.log(`API ${API} · shots in ${DIR}`);
