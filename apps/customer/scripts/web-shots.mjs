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
// SHOTS=track adds the live order screen (track-*.png: preparing, on the way collapsed/expanded,
// unreachable, late, signal lost, reassigning, arrival, rating, points), seeded via POST /demo/track.
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
  // ERR_TUNNEL_CONNECTION_FAILED: map tiles (OSM) are blocked in the sandbox; the map draws without them.
  if (m.type() === 'error' && !/findDOMNode|DevTools|props\.pointerEvents|shadow\*|WebSocket connection|ERR_TUNNEL_CONNECTION_FAILED/.test(text)) errors.push(text);
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
/** ONLY=app or ONLY=food limits which screenshots are written (sign-in always runs). */
const only = process.env.ONLY ?? null;
const shot = async (name) => {
  if (only && !name.startsWith(`${only}-`)) return;
// SHOTS=rajaa (comma list of name prefixes) writes only matching screenshots; the flow still runs.
const only = process.env.SHOTS ? process.env.SHOTS.split(',').map((s) => s.trim()).filter(Boolean) : null;
const shot = async (name) => {
  if (only && !only.some((p) => name.startsWith(p))) return;
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
  if (only && !name.startsWith(`${only}-`)) return;
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
  const seed = await (await fetch(`${apiBase}/demo/seed`)).json();
  const khalid = seed.find((r) => r.key === 'khalid').orgId;
  await byTestId(`restaurant-${khalid}`).waitFor({ timeout: 15_000 });
  await shot('app-home');
  await fullShot('app-home-full');

  await byTestId('tab-orders').click();
  await byTestId('orders').waitFor();
  await shot('app-orders');

  await byTestId('tab-account').click();
  await byTestId('account').waitFor();
  await shot('app-profile');

  // ── Food ordering (M3): restaurant → item sheet (modifiers + لمن؟) → cart for two → checkout →
  //    waiting for the kitchen → accepted (/order/[id]); then a second order the kitchen rejects →
  //    suggestions → cart carried over to another kitchen.
  if (!only || only === 'food') await foodFlow(khalid);
  // Live order screen (/order/[id]) — `SHOTS=track` (or `all`). Each scenario seeds a real order
  // through POST /demo/track; the demo courier reports a position every 2 s along an Aziziyah path.
  if (/track|all/.test(process.env.SHOTS ?? '') && personId) {
    const seed = async (scenario) => {
      const r = await fetch(`${apiBase}/demo/track?personId=${encodeURIComponent(personId)}&scenario=${scenario}`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok) throw new Error(`seed ${scenario}: ${body.error}`);
      return body.orderId;
    };
    const openOrder = async (orderId, query = '') => {
      await page.goto(`${origin}/order/${orderId}${query}`, { waitUntil: 'networkidle' });
      await byTestId('sheet-header').waitFor({ timeout: 15_000 });
      await byTestId('status-line').waitFor({ timeout: 15_000 });
    };
    // Map tiles are blocked here; MapLibre (or the SVG fallback) draws the zones. Let the courier glide.
    const live = (ms = 2600) => page.waitForTimeout(ms);

    // Orders tab rows open the live screen.
    const prepId = await seed('preparing');
    await page.goto(`${origin}/orders`, { waitUntil: 'networkidle' });
    await byTestId(`order-${prepId}`).click();
    await byTestId('order-live').waitFor({ timeout: 15_000 });
    await byTestId('courier-marker').waitFor({ timeout: 15_000 });
    await live();
    await shot('track-preparing');

    const wayId = await seed('on_the_way');
    await openOrder(wayId);
    await live();
    await shot('track-on-the-way');
    await live(4200);
    await shot('track-on-the-way-moved');
    await openOrder(wayId, '?sheet=2');
    await live(1500);
    await shot('track-on-the-way-expanded');
    await page.locator('[data-testid="sheet-body"]').evaluate((el) => el.scrollBy(0, 640));
    await shot('track-on-the-way-expanded-details');
    await page.locator('[data-testid="sheet-body"]').evaluate((el) => el.scrollBy(0, 2000));
    await shot('track-on-the-way-expanded-actions');

    await openOrder(await seed('unreachable'));
    await byTestId('unreachable-panel').waitFor({ timeout: 10_000 });
    await live(1500);
    await shot('track-unreachable');

    await openOrder(await seed('late'));
    await byTestId('running-late').waitFor({ timeout: 10_000 }).catch(() => errors.push('running-late banner not shown'));
    await live();
    await shot('track-late');

    await openOrder(await seed('signal_lost'));
    await byTestId('signal-lost').waitFor({ timeout: 10_000 }).catch(() => errors.push('signal-lost banner not shown'));
    await shot('track-signal-lost');

    await openOrder(await seed('reassigning'));
    await byTestId('reassigning').waitFor({ timeout: 10_000 }).catch(() => errors.push('reassigning banner not shown'));
    await shot('track-reassigning');

    await openOrder(await seed('arrived'));
    await byTestId('arrival').waitFor({ timeout: 10_000 });
    await live(1200);
    await shot('track-arrival');
    await byTestId('arrival-rate').click();
    await byTestId('stars-delivery').waitFor();
    await shot('track-rating');
    await byTestId('stars-delivery-5').click();
    await byTestId('stars-food').waitFor();
    await settle(400);
    await shot('track-rating-food');
    await byTestId('stars-food-4').click();
    await byTestId('points-earned').waitFor({ timeout: 10_000 });
    await live(2400);
    await shot('track-rating-points');
  }
  // ── الرجعة: board → seat booking (blocked seat) → hold → boarding pass → demand → request board ──
  // Needs the demo API's الرجعة seed (scripts/demo-api.mjs). Writes rajaa-*.png.
  if (!only || only.some((p) => p.startsWith('rajaa'))) await rajaaShots(personId);
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

async function foodFlow(khalid) {
  const item = (key) => `${khalid}_${key}`;
  await byTestId('tab-index').click();
  await byTestId('home').waitFor();
  await byTestId(`restaurant-${khalid}`).click();
  await byTestId('restaurant-facts').waitFor({ timeout: 15_000 });
  await byTestId(`dish-${item('kebab_wrap')}`).waitFor({ timeout: 15_000 });
  await shot('food-restaurant');
  await fullShot('food-restaurant-full');

  // One-tap add (no required choice): a Pepsi for me.
  await byTestId(`dish-add-${item('pepsi')}`).click();
  await byTestId('cart-bar').waitFor();

  // Tikka wrap for سارة: bread (required), cheese, a new person with a phone, a note.
  await byTestId(`dish-${item('tikka_wrap')}`).click();
  await byTestId('item-sheet').waitFor();
  await byTestId(`mod-${item('tikka_wrap')}_mg_1_m_2`).click();
  await byTestId(`mod-${item('tikka_wrap')}_mg_2_m_4`).click();
  await page.getByText('ضيف شخص', { exact: true }).click();
  await page.locator('[data-testid="item-person-name"]').fill('سارة');
  await page.locator('[data-testid="item-person-phone"]').fill('07701234567');
  await byTestId('item-person-save').click();
  await page.locator('[data-testid="item-note"]').fill('بدون بصل، زيادة طرشي');
  await page.evaluate(() => {
    // Scroll the sheet body so the chips, quantity and "لمن؟" are all in view.
    const sheet = document.querySelector('[data-testid="item-sheet"]');
    for (const el of sheet?.querySelectorAll('div') ?? []) {
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) el.scrollTop = 150;
    }
  });
  await page.waitForTimeout(3800); // let the last "added" toast go
  await shot('food-item-sheet');
  await byTestId('item-add').click();
  await byTestId('item-sheet').waitFor({ state: 'detached' });

  // Kebab plate for two (a variant), for me.
  await byTestId(`dish-${item('kebab_plate')}`).click();
  await byTestId('item-sheet').waitFor();
  await byTestId(`variant-${item('kebab_plate')}_mg_1_m_2`).click();
  await page.waitForTimeout(3800); // let the last "added" toast go
  await shot('food-item-variant');
  await byTestId('item-add').click();
  await byTestId('item-sheet').waitFor({ state: 'detached' });

  await byTestId('cart-bar').click();
  await byTestId('cart-price-total').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(3800); // let the last "added" toast go
  await shot('food-cart');
  await fullShot('food-cart-full');

  await byTestId('cart-checkout').click();
  await byTestId('checkout-price-total').waitFor({ timeout: 15_000 });
  await shot('food-checkout');
  await fullShot('food-checkout-full');

  await byTestId('checkout-place').click();
  await byTestId('kitchen-title').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await shot('food-waiting');
  const orderId = new URL(page.url()).pathname.split('/').pop();
  const accept = await fetch(`${apiBase}/demo/kitchen?orderId=${orderId}&action=accept`, { method: 'POST' });
  if (!accept.ok) errors.push(`kitchen accept: ${accept.status} ${await accept.text()}`);
  await page.waitForURL(/\/order\//, { timeout: 15_000 }).catch(() => errors.push('accepted order did not open /order/[id]'));

  // Second order → the kitchen says no → move the cart to a similar open kitchen.
  await page.goto(`${origin}/restaurant/${khalid}`, { waitUntil: 'networkidle' });
  await byTestId(`dish-add-${item('pepsi')}`).waitFor({ timeout: 15_000 });
  await byTestId(`dish-add-${item('pepsi')}`).click();
  await byTestId(`dish-${item('kebab_kilo')}`).click();
  await byTestId('item-sheet').waitFor();
  await byTestId('item-add').click();
  await byTestId('item-sheet').waitFor({ state: 'detached' });
  await byTestId('cart-bar').click();
  await byTestId('cart-checkout').click();
  await byTestId('checkout-price-total').waitFor({ timeout: 15_000 });
  await byTestId('checkout-place').click();
  await byTestId('kitchen-title').waitFor({ timeout: 15_000 });
  const second = new URL(page.url()).pathname.split('/').pop();
  const reject = await fetch(`${apiBase}/demo/kitchen?orderId=${second}&action=reject`, { method: 'POST' });
  if (!reject.ok) errors.push(`kitchen reject: ${reject.status} ${await reject.text()}`);
  await byTestId('kitchen-rejected').waitFor({ timeout: 15_000 });
  await page.locator('[data-testid^="suggest-move-"]').first().waitFor({ timeout: 15_000 });
  await shot('food-rejected');
  await page.locator('[data-testid^="suggest-move-"]').first().click();
  await page.locator('[data-testid="cart"]:visible').waitFor({ timeout: 15_000 });
  await shot('food-carried');
}

if (errors.length) {
  console.error('Errors:\n' + errors.map((e) => JSON.stringify(e).slice(0, 2000)).join('\n'));
  process.exitCode = 1;
}
