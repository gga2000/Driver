#!/usr/bin/env node
// Opens a deployed web app in a real browser and fails if it is broken (docs/deploy/vercel.md, "Live check"):
//
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
//     node scripts/deploy/web-smoke.mjs <customer|merchant> <url> --api-url https://…/trpc
//
// - the page loads with no uncaught script error and draws something (not a blank screen);
// - the API answers a request made from the page, so CORS lets this origin in;
// - customer: the home-screen manifest and its icons are served.
const argv = process.argv.slice(2);
const [app, rawUrl] = argv;
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const apiUrl = (flag('--api-url') ?? process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
if (!['customer', 'merchant'].includes(app) || !rawUrl || !apiUrl) {
  console.error(
    'usage: node scripts/deploy/web-smoke.mjs <customer|merchant> <url> --api-url <api>/trpc',
  );
  process.exit(2);
}
const base = rawUrl.startsWith('http')
  ? rawUrl.replace(/\/$/, '')
  : `https://${rawUrl.replace(/\/$/, '')}`;

const problems = [];
const ok = (msg) => console.log(`✔ ${msg}`);
const fail = (msg) => {
  problems.push(msg);
  console.log(`✘ ${msg}`);
};

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ar-IQ' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));

const res = await page.goto(base, { waitUntil: 'load', timeout: 60_000 });
if (res?.ok()) ok(`${base} → ${res.status()}`);
else fail(`${base} answered ${res?.status() ?? 'nothing'}`);
await page.waitForTimeout(6_000);

const text = (
  await page
    .locator('body')
    .innerText()
    .catch(() => '')
).trim();
if (text.includes('درايفر')) ok('the app drew its screen');
else fail(`blank or wrong screen (text: ${JSON.stringify(text.slice(0, 80))})`);
if (errors.length) fail(`script errors: ${errors.slice(0, 3).join(' | ')}`);
else ok('no script errors');

// A cross-origin call from the page: a CORS refusal throws, any HTTP answer below 500 means the API is up.
const api = await page.evaluate(async (url) => {
  try {
    const r = await fetch(`${url}/system.season`);
    return { status: r.status };
  } catch (e) {
    return { error: String(e) };
  }
}, apiUrl);
if (api.error) fail(`API call from the page refused (CORS or down): ${api.error}`);
else if (api.status >= 500) fail(`API answered ${api.status}`);
else ok(`API reachable from this origin (${api.status})`);

if (app === 'customer') {
  const manifest = await page.request.get(`${base}/manifest.webmanifest`);
  if (!manifest.ok()) fail(`manifest.webmanifest → ${manifest.status()}`);
  else {
    const icons = (await manifest.json()).icons ?? [];
    for (const { src } of icons) {
      const r = await page.request.get(new URL(src, base).href);
      if (!r.ok()) fail(`${src} → ${r.status()}`);
    }
    ok(`manifest and ${icons.length} icons served`);
  }
}

await browser.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s) on ${base}`);
  process.exit(1);
}
console.log(`\n${app} web app at ${base} looks healthy`);
