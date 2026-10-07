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
// Screenshots are 390×844 (@2x; WIDTH=360 → 360×740 for small phones), in groups (file-name prefixes), each driven by its own demo seed:
//   app-*    welcome (+ -seat, -tuktuk: the map of home), phone, otp, setup, welcome-home (once after setup), home (+ -full), soon sheet, orders, profile
//   acct-*   profile, place editor, wallet, household (+ -full)          POST /demo/account
//   food-*   restaurant, item sheet, cart for two, checkout, waiting, rejection → carried cart
//   track-*  live order screen: preparing, on the way (collapsed/expanded), unreachable, late (promise bar),
//            late credit (+ receipt line),
//            signal lost, reassigning, arrival, rating, points           POST /demo/track
//   rajaa-*  board, blocked seat, hold, pass, demand, request board, home POST /demo/rajaa/*
//   deals-*  مطعم خالد with its deal badges, the cart with line savings, checkout's deal line
//                                                                         POST /demo/deals
//   topup-*  wallet button, amount, code + QR, the ops agent's lookup and confirmation (Partner app
//            web export in PARTNER_DIST_DIR, built against the same demo API), the customer's receipt
//                                                                         POST /demo/ops-agent
//   chat-*   order screen chat/call/share, courier + kitchen + support threads, quick reply, masked call,
//            closed thread, ride share sheet, public share page (live + ended)  POST /demo/chat
//   ride-*   taxi/tuktuk booking: home bar, where to, search, choose (fare, door), edge zone, pin,
//            searching, cancel preview, matched, at pickup, on the trip, arrival, rating
//                                                                         POST /demo/ride
//   family-* joy w4/w6: «بيتنا» (this month per member, a request over the month's budget, the family
//            table), a member's limits, «شهرك» this month and last, the month-start card on the 2nd
//            (`?now=`), the wallet and account rows                 POST /demo/account + /demo/family
//   gift-*   J7b: checkout «عزيمة» card, the kitchen's gift heads-up, «عزّم صديقك», a friend's /i/<code>
//            as a guest, the sticker pack, the share card sheet (food and الرجعة) and the rendered cards
//                                                                         POST /demo/account, /demo/invite, /demo/history, /demo/rajaa/arrived
//   season-* J6 on a frozen 13:00 Baghdad clock: home Ramadan card (pick, then the countdown), the
//            timetable in notifications, checkout's «على الفطور» slot, the Eid card
//                                                                         POST /demo/season
//   live-*   joy J5b: the kitchen strip (accepted, cooking, ready), the food driver reveal, the kashi ETA
//            box (on the way, the range option, late), delivered with the courier, the compliment chips
//            (picked, sent) before the tip card            POST /demo/track (kitchen, on_the_way, late; rated=1)
//            and the ride reveal (a taxi accepted while the screen is open)    POST /demo/ride
//   trips-*  joy J7d on a fresh account: the ride tab (a regular trip asking, «خليه سايقك المفضل؟»),
//            «رحلاتي الثابتة», a day to confirm (ride, الرجعة) and confirmed, the editor (ride, الرجعة),
//            «سواقي المفضلين», the booked ride (+ home card), booking for later with a favourite, the
//            الرجعة board's «سايقك», the kept pass's heart, «عشاك يوصل وياك» on home, the list and
//            checkout, and on the الرجعة pass, the notification switch     POST /demo/ride-habits, /demo/dinner
//   habits-* joy J7a: pots strip + usual on home, a followed pot, Thursday 20:00 «باچر الجمعة» and its
//            booking sheet, the restaurant pot banner + story, the item follow row, the switch  POST /demo/usuals
//   basket-* the V2 basket (`basket_v2` switch, on in dev builds): a cart for two (all, سارة's tab), the
//            kitchen card waiting, slow (after 45 s; start the demo API with DEMO_KITCHEN_MS=0) and accepted
// SHOTS=food,track (comma list of groups, or `all`; default all) runs only those flows and writes
// only their files; sign-in always runs. ONLY=<group> and SHOTS_PREFIX=<group> are older aliases.
// Exits non-zero on console errors or a missing screen.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = resolve(process.env.DIST_DIR ?? join(here, '../dist-web'));
const outDir = resolve(process.argv[2] ?? join(here, '../web-shots'));
const apiBase = (process.env.DEMO_API ?? 'http://127.0.0.1:3200').replace(/\/$/, '');
const phone = process.env.DEMO_PHONE ?? '0770 123 4567';
/** Viewport: 390×844 by default; WIDTH=360 gives the small-phone run (360×740). */
const W = Number(process.env.WIDTH ?? 390);
const H = W <= 360 ? 740 : 844;
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(dist, 'index.html'))) throw new Error(`No web export at ${dist}; run expo export first`);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
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
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'ar-IQ' });
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

// Page loads wait for 'load' and then for the screen's own element, never 'networkidle': the live
// order / chat screens keep an SSE stream open and the map keeps fetching tiles, so the network is
// never idle there.
const LOADED = { waitUntil: 'load' };
const byTestId = (id) => page.locator(`[data-testid="${id}"]`).first();
const settle = async (ms = 700) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
};
const GROUPS = ['app', 'acct', 'food', 'track', 'rajaa', 'deals', 'topup', 'chat', 'ride', 'season', 'family', 'habits', 'gift', 'live', 'trips', 'basket'];
const selected = (process.env.SHOTS ?? process.env.ONLY ?? process.env.SHOTS_PREFIX ?? 'all')
  .split(',')
  .map((s) => s.trim().replace(/-$/, ''))
  .filter(Boolean);
const groups = new Set(selected.includes('all') ? GROUPS : selected);
for (const g of groups) if (!GROUPS.includes(g)) throw new Error(`Unknown SHOTS group "${g}" (expected ${GROUPS.join(', ')} or all)`);
/** Whether a flow runs / a file is written: by its group, the name's first segment. */
const wants = (group) => groups.has(group);
const wanted = (name) => wants(name.split('-')[0]);
const shot = async (name) => {
  if (!wanted(name)) return;
  await settle();
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
};
/** Grow the viewport to the RN scroll content (the ScrollView owns scrolling on web). */
const fullShot = async (name) => {
  if (!wanted(name)) return;
  const h = await page.evaluate(() => {
    let max = document.documentElement.scrollHeight;
    for (const el of document.querySelectorAll('div')) {
      const s = getComputedStyle(el);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') max = Math.max(max, el.scrollHeight + 160);
    }
    return max;
  });
  await page.setViewportSize({ width: W, height: Math.min(h, 4000) });
  await shot(name);
  await page.setViewportSize({ width: W, height: H });
};
const demoPost = async (path) => {
  const r = await fetch(`${apiBase}${path}`, { method: 'POST' });
  if (!r.ok) {
    errors.push(`${path}: ${r.status} ${await r.text()}`);
    return null;
  }
  return r.json().catch(() => null);
};

try {
  await page.goto(`${origin}/`, LOADED);
  await byTestId('welcome-start').waitFor({ timeout: 20_000 });
  // The map of home (d-6): the live proof from catalog.today, then a spot picked by hand (the loop rests on it).
  await byTestId('welcome-proof').waitFor({ timeout: 10_000 }).catch(() => errors.push('welcome live proof not shown'));
  await shot('app-welcome');
  if (wants('app') && (await byTestId('welcome-spot-seat').count()) > 0) {
    await byTestId('welcome-spot-seat').click();
    await settle(500);
    await shot('app-welcome-seat');
    await byTestId('welcome-spot-tuktuk').click();
    await settle(500);
    await shot('app-welcome-tuktuk');
  }

  // "يلا نبدي" browses as a guest (C-18); the shots sign in through "عندك حساب؟".
  await byTestId('welcome-signin').click();
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
    // The welcome-home moment (joy h7) plays once after setup: shot, then tapped away.
    if (await byTestId('welcome-home').waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)) {
      await settle(1600);
      await shot('app-welcome-home');
      await byTestId('welcome-home').click();
      await byTestId('welcome-home').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => errors.push('welcome-home did not close'));
    }
  }
  await byTestId('home').waitFor({ timeout: 15_000 });

  // Seed an in-progress order for this person through the demo hook, then reload home.
  const personId = await page.evaluate(() => JSON.parse(localStorage.getItem('driver.customer.session') ?? '{}').personId ?? null);
  if (personId) {
    const r = await fetch(`${apiBase}/demo/active-order?personId=${encodeURIComponent(personId)}`, { method: 'POST' });
    if (!r.ok) errors.push(`seed active order: ${r.status} ${await r.text()}`);
    await page.reload(LOADED);
    await byTestId('home').waitFor();
  }
  await byTestId('home-active-order').waitFor({ timeout: 15_000 }).catch(() => errors.push('active order pill not shown'));
  const seed = await (await fetch(`${apiBase}/demo/seed`)).json();
  const khalid = seed.find((r) => r.key === 'khalid').orgId;
  await byTestId(`restaurant-${khalid}`).waitFor({ timeout: 15_000 });
  await shot('app-home');
  await fullShot('app-home-full');
  // A coming-soon tile opens its sheet (the shared ModalSheet), closed with its ✕.
  if (wants('app')) {
    await byTestId('service-grocery').click();
    await byTestId('soon-sheet-grocery').waitFor();
    await settle(600);
    await shot('app-soon-sheet');
    await page.locator('[data-testid="soon-sheet-grocery-close"], [data-testid="soon-close"]').first().click();
    await byTestId('soon-sheet-grocery').waitFor({ state: 'detached' });
  }

  await byTestId('tab-orders').click();
  await byTestId('orders').waitFor();
  await shot('app-orders');

  await byTestId('tab-account').click();
  await byTestId('account').waitFor();
  await shot('app-profile');

  // Each flow starts from its own navigation, so any subset (SHOTS=…) runs in this order.
  if (wants('acct')) await acctShots(personId);
  if (wants('food')) await foodFlow(khalid);
  if (wants('track')) await trackShots(personId);
  if (wants('rajaa')) await rajaaShots(personId);
  if (wants('deals')) await dealsShots(khalid);
  if (wants('topup')) await topupShots();
  if (wants('chat')) await chatShots(personId);
  if (wants('ride')) await rideShots();
  if (wants('season')) await seasonShots(khalid);
  if (wants('family')) await familyShots(personId);
  if (wants('habits')) await habitsShots();
  if (wants('gift')) await giftShots(khalid, personId);
  if (wants('live')) await liveShots(personId);
  if (wants('trips')) await tripsShots(khalid);
  if (wants('basket')) await basketShots(khalid);
} catch (err) {
  errors.push(err.stack ?? String(err));
  await page.screenshot({ path: join(outDir, 'app-failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.close();
}

/**
 * Joy J7d ride habits, as a fresh account (no order running): POST /demo/ride-habits gives two
 * finished taxi rides and a الرجعة (two favourites), two regular trips asking now and a ride booked for
 * the work trip's next day; POST /demo/dinner puts a taxi home on the road, then a seat to Aziziyah.
 */
async function tripsShots(khalid) {
  await page.goto(`${origin}/`, LOADED);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${origin}/phone`, LOADED);
  await page.locator('[data-testid="phone-input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-testid="phone-input"]').fill(process.env.TRIPS_PHONE ?? '0770 456 8899');
  await byTestId('phone-submit').click();
  await byTestId('otp-dev-strip').waitFor({ timeout: 15_000 });
  const code = (await byTestId('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
  if (!code) throw new Error('dev code not shown');
  await page.locator('[data-testid="otp-input"]').fill(code);
  const landed = await Promise.race([byTestId('setup-name').waitFor({ timeout: 15_000 }).then(() => 'setup'), byTestId('home').waitFor({ timeout: 15_000 }).then(() => 'home')]);
  if (landed === 'setup') {
    await page.locator('[data-testid="setup-name"]').fill('أبو زهراء');
    await byTestId('setup-next').click();
    await byTestId('chip-street_30').click();
    await byTestId('setup-save').click();
    if (await byTestId('welcome-home').waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)) {
      await byTestId('welcome-home').click();
      await byTestId('welcome-home').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
    }
  }
  await byTestId('home').waitFor({ timeout: 15_000 });
  const personId = await page.evaluate(() => JSON.parse(localStorage.getItem('driver.customer.session') ?? '{}').personId ?? null);
  if (!personId) throw new Error('no person after sign-in');
  const seed = await demoPost(`/demo/ride-habits?personId=${encodeURIComponent(personId)}`);
  if (!seed) return;

  // Home: the ride booked for the work trip's next day has its own card.
  await page.goto(`${origin}/`, LOADED);
  await byTestId('home-booked-ride').waitFor({ timeout: 15_000 }).catch(() => errors.push('booked ride card not shown'));
  await shot('trips-home');

  // The ride tab: the regular trip asking now, the last good driver, «رحلاتي الثابتة».
  await page.goto(`${origin}/ride`, LOADED);
  await byTestId(`regular-due-${seed.regularRideId}`).waitFor({ timeout: 15_000 }).catch(() => errors.push('regular due card not shown'));
  await byTestId('recent-driver').waitFor({ timeout: 15_000 }).catch(() => errors.push('recent driver card not shown'));
  await shot('trips-ride-tab');
  await fullShot('trips-ride-tab-full');

  await page.goto(`${origin}/regular`, LOADED);
  await byTestId(`regular-trip-${seed.regularRideId}`).waitFor({ timeout: 15_000 });
  await shot('trips-regular');
  await fullShot('trips-regular-full');

  await page.goto(`${origin}/regular/${seed.regularRideId}?date=${seed.rideDate}`, LOADED);
  await byTestId('occurrence-fare-amount').waitFor({ timeout: 15_000 });
  await shot('trips-occurrence-ride');

  await page.goto(`${origin}/regular/${seed.regularRajaaId}?date=${seed.rajaaDate}`, LOADED);
  await byTestId('occurrence-head').waitFor({ timeout: 15_000 });
  await settle(1200);
  await shot('trips-occurrence-rajaa');
  await fullShot('trips-occurrence-rajaa-full');

  // «أكدها» on the ride day: booked, with the search time.
  await page.goto(`${origin}/regular/${seed.regularRideId}?date=${seed.rideDate}`, LOADED);
  await byTestId('occurrence-confirm').waitFor({ timeout: 15_000 });
  await byTestId('occurrence-confirm').click();
  await byTestId('occurrence-booked').waitFor({ timeout: 15_000 }).catch(() => errors.push('occurrence not booked'));
  await shot('trips-occurrence-booked');

  // The editor: the work ride, then a new الرجعة.
  await page.goto(`${origin}/regular`, LOADED);
  await byTestId(`regular-edit-${seed.regularRideId}`).click();
  await byTestId('regular-save').waitFor({ timeout: 15_000 });
  await shot('trips-edit-ride');
  await page.locator('[data-testid="regular-save"]:visible').first().scrollIntoViewIfNeeded();
  await shot('trips-edit-ride-bottom');
  await page.goto(`${origin}/regular`, LOADED);
  await byTestId('regular-add-rajaa').click();
  await byTestId('regular-save').waitFor({ timeout: 15_000 });
  await settle(800);
  await shot('trips-edit-rajaa');
  await page.locator('[data-testid="regular-save"]:visible').first().scrollIntoViewIfNeeded();
  await shot('trips-edit-rajaa-bottom');

  await page.goto(`${origin}/drivers`, LOADED);
  await page.locator('[data-testid^="driver-fav_"]').first().waitFor({ timeout: 15_000 }).catch(() => errors.push('favourites not shown'));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete)).catch(() => {});
  await shot('trips-drivers');

  await page.goto(`${origin}/ride/booked/${seed.bookedOrderId}`, LOADED);
  await byTestId('booked-card').waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete)).catch(() => {});
  await shot('trips-booked');
  await fullShot('trips-booked-full');

  // Booking a ride for later with the favourite: home → work, «لوكت ثاني», حسين.
  await page.goto(`${origin}/ride`, LOADED);
  // The where-to screen may open on «من» or on «إلى»: الدائرة, then البيت if it was the pickup.
  await page.locator('[data-testid^="ride-saved-"]', { hasText: 'الدائرة' }).first().click();
  await settle(600);
  if (!(await byTestId('ride-choose').isVisible().catch(() => false))) await page.locator('[data-testid^="ride-saved-"]', { hasText: 'البيت' }).first().click();
  await byTestId('ride-choose').waitFor({ timeout: 15_000 }).catch(async () => {
    errors.push('choose screen not shown');
    await page.screenshot({ path: join(outDir, 'trips-debug-choose.png') });
  });
  await page.getByText('لوكت ثاني', { exact: true }).click();
  await byTestId('ride-fav').waitFor({ timeout: 10_000 }).catch(() => errors.push('favourite chips not shown'));
  await page.getByText('حسين', { exact: true }).click().catch(() => errors.push('favourite chip not found'));
  await byTestId('ride-when').scrollIntoViewIfNeeded();
  await settle(900);
  await shot('trips-choose-later');

  // The الرجعة board: «سايقك» on جاسم's car to Kut, and the regular trip asking.
  await page.goto(`${origin}/rajaa?corridor=aziziyah_kut&direction=from_aziziyah`, LOADED);
  await page.locator('[data-testid^="departure-fav-"]').first().waitFor({ timeout: 15_000 }).catch(() => errors.push('favourite badge on the board not shown'));
  await shot('trips-rajaa-board');
  await page.locator('[data-testid^="departure-fav-"]').first().scrollIntoViewIfNeeded().catch(() => {});
  await settle(500);
  await shot('trips-rajaa-board-fav');

  // The kept pass of the rated الرجعة: the heart, already on.
  await page.goto(`${origin}/rajaa/pass/${seed.rajaaBookingId}`, LOADED);
  await byTestId('favourite-toggle').waitFor({ timeout: 15_000 }).catch(() => errors.push('favourite toggle on the pass not shown'));
  await byTestId('favourite-toggle').scrollIntoViewIfNeeded().catch(() => {});
  await shot('trips-pass-favourite');

  // «عشاك يوصل وياك»: a taxi home on the road → home card → the kitchens → checkout's «وياك».
  const homeRide = await demoPost(`/demo/dinner?personId=${encodeURIComponent(personId)}`);
  await page.goto(`${origin}/`, LOADED);
  await byTestId('home-dinner').waitFor({ timeout: 20_000 }).catch(() => errors.push('dinner card on home not shown'));
  await shot('trips-dinner-home');
  await byTestId('home-dinner-go').click();
  await byTestId('dinner-banner').waitFor({ timeout: 15_000 }).catch(() => errors.push('dinner banner not shown'));
  await shot('trips-dinner-list');
  // Screens stay mounted under the new one on web: the visible copy of each element.
  const visible = (id) => page.locator(`[data-testid="${id}"]:visible`).first();
  await visible(`restaurant-row-${khalid}`).click();
  await visible(`dish-add-${khalid}_pepsi`).waitFor({ timeout: 15_000 });
  await visible(`dish-add-${khalid}_pepsi`).click();
  if (await visible('item-sheet').isVisible().catch(() => false)) {
    await visible('item-add').click();
    await byTestId('item-sheet').waitFor({ state: 'detached' });
  }
  await visible('cart-bar').click();
  await visible('cart-checkout').click();
  await byTestId('checkout-price-total').waitFor({ timeout: 15_000 });
  await byTestId('checkout-dinner-note').waitFor({ timeout: 15_000 }).catch(() => errors.push('dinner note at checkout not shown'));
  await byTestId('checkout-row-when').scrollIntoViewIfNeeded().catch(() => {});
  await settle(900);
  await shot('trips-dinner-checkout');

  // The taxi gets home first (one trip on at a time offers dinner), then a seat back from Kut.
  if (homeRide?.orderId) await demoPost(`/demo/ride/advance?orderId=${homeRide.orderId}`);
  const seat = await demoPost(`/demo/dinner?personId=${encodeURIComponent(personId)}&kind=rajaa`);
  if (seat?.bookingId) {
    await page.goto(`${origin}/rajaa/pass/${seat.bookingId}`, LOADED);
    await byTestId('rajaa-dinner').waitFor({ timeout: 20_000 }).catch(() => errors.push('dinner card on the pass not shown'));
    await byTestId('rajaa-dinner').scrollIntoViewIfNeeded().catch(() => {});
    await settle(700);
    await shot('trips-dinner-pass');
  }

  await page.goto(`${origin}/profile/notifications`, LOADED);
  await byTestId('pref-regularTrips').waitFor({ timeout: 15_000 });
  await byTestId('pref-regularTrips').scrollIntoViewIfNeeded();
  await shot('trips-notify');
}

/**
 * Joy J7a food habits, as a person with no order running (a fresh account, so the usual and Friday
 * cards are not under a live order): the «العزيزية اليوم» pots strip and «طلبك المعتاد؟» on home, a
 * followed pot, Thursday 20:00 «باچر الجمعة» and its booking sheet, the restaurant page with the pot
 * banner and «مطاعمنا», the item sheet's follow row, and the «قدر اليوم» switch.     POST /demo/usuals
 */
async function habitsShots() {
  await page.goto(`${origin}/`, LOADED);
  await page.evaluate(() => localStorage.clear());
  // Signed out (a guest lands on home): straight to the phone screen.
  await page.goto(`${origin}/phone`, LOADED);
  await page.locator('[data-testid="phone-input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-testid="phone-input"]').fill(process.env.HABITS_PHONE ?? '0770 456 7788');
  await byTestId('phone-submit').click();
  await byTestId('otp-dev-strip').waitFor({ timeout: 15_000 });
  const code = (await byTestId('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
  if (!code) throw new Error('dev code not shown');
  await page.locator('[data-testid="otp-input"]').fill(code);
  const landed = await Promise.race([byTestId('setup-name').waitFor({ timeout: 15_000 }).then(() => 'setup'), byTestId('home').waitFor({ timeout: 15_000 }).then(() => 'home')]);
  if (landed === 'setup') {
    await page.locator('[data-testid="setup-name"]').fill('أم علي');
    await byTestId('setup-next').click();
    await byTestId('chip-street_30').click();
    await byTestId('setup-save').click();
    if (await byTestId('welcome-home').waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)) {
      await byTestId('welcome-home').click();
      await byTestId('welcome-home').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
    }
  }
  await byTestId('home').waitFor({ timeout: 15_000 });
  const personId = await page.evaluate(() => JSON.parse(localStorage.getItem('driver.customer.session') ?? '{}').personId ?? null);
  if (!personId) throw new Error('no person after sign-in');
  await demoPost(`/demo/usuals?personId=${encodeURIComponent(personId)}`);
  await page.reload(LOADED);
  await byTestId('home-pots').waitFor({ timeout: 15_000 }).catch(() => errors.push('pots strip not shown'));
  await byTestId('home-usual').waitFor({ timeout: 15_000 }).catch(() => errors.push('usual card not shown'));
  await shot('habits-home');
  await fullShot('habits-home-full');
  await byTestId('home-pot-follow-0').click();
  await settle(900);
  await byTestId('home-pots').scrollIntoViewIfNeeded();
  await shot('habits-pot-followed');

  // Thursday 20:00 in Baghdad (the next one): «باچر الجمعة» for the Friday lunch usual.
  const local = new Date(Date.now() + 3 * 3_600_000);
  const ahead = (4 - local.getUTCDay() + 7) % 7;
  const thursday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + ahead, 20, 0) - 3 * 3_600_000);
  await page.clock.setFixedTime(thursday);
  await page.goto(`${origin}/`, LOADED);
  await byTestId('home-friday').waitFor({ timeout: 15_000 }).catch(() => errors.push('Friday card not shown'));
  await shot('habits-friday');
  await byTestId('home-friday-book').click();
  await byTestId('reorder-sheet').waitFor({ timeout: 15_000 });
  await byTestId('reorder-total').waitFor({ timeout: 15_000 });
  await settle(1500);
  await shot('habits-friday-sheet');
  await byTestId('reorder-close').click();

  const seed = await (await fetch(`${apiBase}/demo/seed`)).json();
  const kareem = seed.find((r) => r.key === 'haj_kareem').orgId;
  await page.goto(`${origin}/restaurant/${kareem}`, LOADED);
  await byTestId('restaurant-pot').waitFor({ timeout: 15_000 }).catch(() => errors.push('pot banner not shown'));
  await byTestId('restaurant-story').waitFor({ timeout: 5_000 }).catch(() => errors.push('story not shown'));
  await shot('habits-restaurant');
  await fullShot('habits-restaurant-full');
  await byTestId('restaurant-pot-open').click();
  await byTestId('item-follow').waitFor({ timeout: 10_000 }).catch(() => errors.push('item follow row not shown'));
  await shot('habits-item-follow');

  await page.goto(`${origin}/profile/notifications`, LOADED);
  await byTestId('pref-dishPots').waitFor({ timeout: 15_000 }).catch(() => errors.push('dish pots switch not shown'));
  await shot('habits-notifications');
}

/**
 * Joy w4/w6: the household with budgets and a month of history, then «بيتنا», a member's limits,
 * «شهرك» (this month, then last), the month-start card (the app's clock on the 2nd) and the rows.
 */
async function familyShots(personId) {
  if (!personId) return;
  await demoPost(`/demo/account?personId=${encodeURIComponent(personId)}`);
  await demoPost(`/demo/family?personId=${encodeURIComponent(personId)}`);
  await page.goto(`${origin}/household`, LOADED);
  await byTestId('household-month').waitFor({ timeout: 15_000 });
  await shot('family-hub');
  await fullShot('family-hub-full');
  // The page scrolls inside its own view on web: bring each part up for its own shot.
  for (const [id, name] of [
    ['household-month', 'family-hub-month'],
    ['household-table', 'family-hub-table'],
    ['household-trusted', 'family-hub-trusted'],
  ]) {
    await byTestId(id).scrollIntoViewIfNeeded();
    await shot(name);
  }

  await page.locator('[data-testid^="member-"]').nth(1).click();
  await byTestId('member-limits').waitFor({ timeout: 15_000 });
  await shot('family-member');
  await byTestId('limit-month').scrollIntoViewIfNeeded();
  await shot('family-member-month');
  await fullShot('family-member-full');

  await page.goto(`${origin}/month`, LOADED);
  await byTestId('month-hero').waitFor({ timeout: 15_000 });
  await shot('family-month');
  await fullShot('family-month-full');
  await byTestId('month-private').scrollIntoViewIfNeeded();
  await shot('family-month-end');
  await byTestId('month-prev').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="month-hero"]') !== null && !document.querySelector('[data-testid="month-loading"]'));
  await settle(900);
  await fullShot('family-month-last-full');

  // The month-start card: the app's clock on the 2nd of this month (dev builds only, `?now=`).
  const second = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 8) + '02T12:00:00+03:00';
  await page.goto(`${origin}/wallet?now=${encodeURIComponent(second)}`, LOADED);
  await byTestId('wallet-month-card').waitFor({ timeout: 15_000 }).catch(() => errors.push('month-start card not shown'));
  await shot('family-wallet-card');
  await page.goto(`${origin}/account`, LOADED);
  await byTestId('account-month').waitFor({ timeout: 15_000 });
  await shot('family-account');
}

/** M3 account: seed places / points / household, then profile, place editor, wallet, household. */
async function acctShots(personId) {
  if (personId) {
    await demoPost(`/demo/account?personId=${encodeURIComponent(personId)}`);
    await page.goto(`${origin}/`, LOADED);
    await byTestId('home').waitFor({ timeout: 15_000 });
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

  await page.goto(`${origin}/household`, LOADED);
  await byTestId('household').waitFor({ timeout: 15_000 });
  await shot('acct-household');
  await fullShot('acct-household-full');
}

/**
 * Food ordering (M3): restaurant → item sheet (modifiers + لمن؟) → cart for two → checkout →
 * waiting for the kitchen → accepted (/order/[id]); then a second order the kitchen rejects →
 * suggestions → cart carried over to another kitchen.
 */
async function foodFlow(khalid) {
  const item = (key) => `${khalid}_${key}`;
  await page.goto(`${origin}/`, LOADED);
  await byTestId('home').waitFor({ timeout: 15_000 });
  await byTestId(`restaurant-${khalid}`).click();
  await byTestId('restaurant-facts').waitFor({ timeout: 15_000 });
  await byTestId(`dish-${item('kebab_wrap')}`).waitFor({ timeout: 15_000 });
  await shot('food-restaurant');
  await fullShot('food-restaurant-full');

  // One-tap add (no required choice): a Pepsi for me.
  await byTestId(`dish-add-${item('pepsi')}`).click();
  await page.locator('[data-testid="cart-bar"]:visible').waitFor();

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

  await page.locator('[data-testid="cart-bar"]:visible').click();
  await page.locator('[data-testid="cart-price-total"], [data-testid="basket-total"]').first().waitFor({ timeout: 15_000 });
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
  await page.goto(`${origin}/restaurant/${khalid}`, LOADED);
  await byTestId(`dish-add-${item('pepsi')}`).waitFor({ timeout: 15_000 });
  await byTestId(`dish-add-${item('pepsi')}`).click();
  await byTestId(`dish-${item('kebab_kilo')}`).click();
  await byTestId('item-sheet').waitFor();
  await byTestId('item-add').click();
  await byTestId('item-sheet').waitFor({ state: 'detached' });
  await page.locator('[data-testid="cart-bar"]:visible').click();
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

/**
 * Live order screen (/order/[id]). Each scenario seeds a real order through POST /demo/track; the
 * demo courier reports a position every 2 s along an Aziziyah path.
 */
async function trackShots(personId) {
  if (!personId) throw new Error('track shots need a signed-in person');
  const seed = async (scenario, query = '') => {
    const r = await fetch(`${apiBase}/demo/track?personId=${encodeURIComponent(personId)}&scenario=${scenario}${query}`, { method: 'POST' });
    const body = await r.json();
    if (!r.ok) throw new Error(`seed ${scenario}: ${body.error}`);
    return body.orderId;
  };
  const openOrder = async (orderId, query = '') => {
    await page.goto(`${origin}/order/${orderId}${query}`, LOADED);
    await byTestId('sheet-header').waitFor({ timeout: 15_000 });
    await byTestId('status-line').waitFor({ timeout: 15_000 });
  };
  // Map tiles are blocked here; MapLibre (or the SVG fallback) draws the zones. Let the courier glide.
  const live = (ms = 2600) => page.waitForTimeout(ms);

  // Orders tab rows open the live screen.
  const prepId = await seed('preparing');
  await page.goto(`${origin}/orders`, LOADED);
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

  // Running late, 12 minutes past the promise: the honest-delay bar is part-way to the threshold (d-5).
  await openOrder(await seed('late', '&pastPromiseMin=12'));
  await byTestId('running-late').waitFor({ timeout: 10_000 }).catch(() => errors.push('running-late banner not shown'));
  await byTestId('late-promise-until').waitFor({ timeout: 10_000 }).catch(() => errors.push('late promise bar not shown'));
  await live();
  await shot('track-late');

  // Past the threshold: the server posts the credit, the toast says so once, the receipt shows the line.
  const creditId = await seed('late_credit');
  await openOrder(creditId);
  // The notification pre-prompt (first live order) would cover the toast: "بعدين", then open it again.
  if (await byTestId('push-preprompt').isVisible().catch(() => false)) {
    await byTestId('push-preprompt-later').click();
    await openOrder(creditId);
  }
  await byTestId('late-promise-credited').waitFor({ timeout: 10_000 }).catch(() => errors.push('late credit not shown on the banner'));
  await page.waitForTimeout(900);
  await shot('track-late-credit');
  await openOrder(creditId, '?sheet=2');
  if (await byTestId('push-preprompt').isVisible().catch(() => false)) await byTestId('push-preprompt-later').click();
  await byTestId('track-price-late-credit').waitFor({ timeout: 10_000 }).catch(() => errors.push('late credit line not on the receipt'));
  await page.locator('[data-testid="track-price-late-credit"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(6500); // let the toast go
  await shot('track-late-credit-receipt');

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
  // Rate the courier: a low score asks what went wrong (optional chips).
  await byTestId('stars-delivery-2').click();
  await byTestId('courier-reasons').waitFor();
  await byTestId('chip-late').click();
  await settle(400);
  await shot('track-rating-courier-low');
  // A good score moves straight on to the food (the kind words come after, as compliments).
  await byTestId('stars-delivery-5').click();
  await byTestId('stars-food').waitFor();
  await settle(400);
  await shot('track-rating-food');
  await byTestId('stars-food-4').click();
  await byTestId('points-earned').waitFor({ timeout: 10_000 });
  await live(2400);
  await shot('track-rating-points');
}

/** الرجعة: board → seat booking (blocked seat) → hold → boarding pass → demand → request board → home. */
async function rajaaShots(personId) {
  await page.goto(`${origin}/rajaa`, LOADED);
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
  await page.goto(`${origin}/rajaa/demand?corridor=aziziyah_baghdad&direction=to_aziziyah`, LOADED);
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
  await page.goto(`${origin}/rajaa/request`, LOADED);
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
  await page.goto(`${origin}/`, LOADED);
  await byTestId('home-rajaa-summary').waitFor({ timeout: 15_000 });
  await shot('rajaa-home');
}

/**
 * Merchant deals at checkout: two live deals on مطعم خالد (20 % off the menu, free delivery over 15,000).
 * The restaurant shows both badges; the cart and checkout show the one the server applied.
 */
async function dealsShots(khalid) {
  const item = (key) => `${khalid}_${key}`;
  await demoPost('/demo/deals');
  await page.goto(`${origin}/restaurant/${khalid}`, LOADED);
  await byTestId('restaurant-deals').waitFor({ timeout: 15_000 });
  await byTestId(`dish-${item('kebab_wrap')}`).waitFor({ timeout: 15_000 });
  await shot('deals-restaurant');

  for (const key of ['khalid_mix', 'liver_plate', 'lentil_soup']) {
    await byTestId(`dish-add-${item(key)}`).click();
    // A dish with a required choice opens its sheet: take the default and add.
    if (await byTestId('item-sheet').isVisible().catch(() => false)) {
      await byTestId('item-add').click();
      await byTestId('item-sheet').waitFor({ state: 'detached' });
    }
    await page.waitForTimeout(300);
  }
  await page.locator('[data-testid="cart-bar"]:visible').click();
  await page.locator('[data-testid="cart-price-total"], [data-testid="basket-total"]').first().waitFor({ timeout: 15_000 });
  await byTestId('cart-deal-saving').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(3800); // let the last "added" toast go
  await shot('deals-cart');
  await fullShot('deals-cart-full');

  await byTestId('cart-checkout').click();
  await byTestId('checkout-price-total').waitFor({ timeout: 15_000 });
  await page.evaluate(() => {
    // Scroll to the price breakdown so the deal line is in view.
    for (const el of document.querySelectorAll('div')) {
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight;
    }
  });
  await shot('deals-checkout');
  await fullShot('deals-checkout-full');
}

/**
 * Wallet top-up with cash: شحن المحفظة → amount → code + QR; then the ops agent (Partner app, Ops
 * mode, its own browser context) keys the code in and confirms; the customer's screen becomes the receipt.
 */
async function topupShots() {
  await page.goto(`${origin}/wallet`, LOADED);
  await byTestId('wallet-topup').waitFor({ timeout: 15_000 });
  await shot('topup-wallet');
  await byTestId('wallet-topup').click();
  await byTestId('topup-pick').waitFor({ timeout: 15_000 });
  await shot('topup-amount');
  await byTestId('topup-get-code').click();
  await byTestId('topup-code').waitFor({ timeout: 15_000 });
  await byTestId('topup-qr').waitFor();
  await shot('topup-code');
  await fullShot('topup-code-full');
  const code = (await byTestId('topup-code-digits').innerText()).replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) throw new Error(`top-up code not shown (${code})`);

  const partnerDist = process.env.PARTNER_DIST_DIR ? resolve(process.env.PARTNER_DIST_DIR) : null;
  if (!partnerDist || !existsSync(join(partnerDist, 'index.html'))) {
    errors.push('topup: set PARTNER_DIST_DIR to a Partner web export built against this demo API');
    return;
  }
  const agent = await demoPost('/demo/ops-agent');
  const pServer = createServer((req, res) => {
    const path = join(partnerDist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    const file = existsSync(path) && !path.endsWith('/') && extname(path) ? path : join(partnerDist, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => pServer.listen(0, '127.0.0.1', r));
  const pOrigin = `http://127.0.0.1:${pServer.address().port}`;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'ar-IQ' });
  const ops = await ctx.newPage();
  ops.on('pageerror', (e) => errors.push(`[ops] ${e.stack ?? e.message}`));
  ops.on('console', (m) => {
    if (m.type() === 'error' && !/findDOMNode|DevTools|props\.pointerEvents|shadow\*|WebSocket connection|ERR_TUNNEL_CONNECTION_FAILED/.test(m.text())) errors.push(`[ops] ${m.text()}`);
  });
  const opsId = (id) => ops.locator(`[data-testid="${id}"]`).first();
  const opsShot = async (name) => {
    await ops.evaluate(() => document.fonts.ready);
    await ops.waitForTimeout(700);
    const file = join(outDir, `${name}.png`);
    await ops.screenshot({ path: file });
    console.log(file);
  };
  try {
    await ops.goto(`${pOrigin}/`, LOADED);
    await opsId('welcome-start').waitFor({ timeout: 30_000 });
    await opsId('welcome-start').click();
    await ops.locator('[data-testid="phone-input"]').fill(agent.phone);
    await opsId('phone-submit').click();
    await opsId('otp-dev-strip').waitFor({ timeout: 15_000 });
    const otp = (await opsId('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
    await ops.locator('[data-testid="otp-input"]').fill(otp ?? '');
    await opsId('home').waitFor({ timeout: 20_000 }).catch(() => undefined);
    await ops.goto(`${pOrigin}/ops`, LOADED);
    await opsId('ops-go-topup').waitFor({ timeout: 15_000 });
    await opsShot('topup-ops-home');
    await opsId('ops-go-topup').click();
    await opsId('ops-code-pad').waitFor({ timeout: 15_000 });
    for (const d of code) await opsId(`ops-pad-${d}`).click();
    await opsId('ops-topup-found').waitFor({ timeout: 15_000 });
    await opsShot('topup-ops-confirm');
    await opsId('ops-topup-confirm').click();
    await opsId('ops-topup-done').waitFor({ timeout: 15_000 });
    await opsShot('topup-ops-done');
  } finally {
    await ctx.close();
    pServer.close();
  }

  await byTestId('topup-done').waitFor({ timeout: 20_000 });
  await shot('topup-done');
  await byTestId('topup-back').click();
  await byTestId('wallet-lines').waitFor({ timeout: 15_000 });
  await shot('topup-wallet-after');
}

/** Chat, masked call and share-trip: POST /demo/chat seeds each conversation through the real API. */
async function chatShots(personId) {
  if (!personId) return;
  const seed = async (scenario) => {
    const r = await fetch(`${apiBase}/demo/chat?personId=${encodeURIComponent(personId)}&scenario=${scenario}`, { method: 'POST' });
    if (!r.ok) throw new Error(`/demo/chat ${scenario}: ${r.status} ${await r.text()}`);
    return r.json();
  };

  // The order screen: chat (unread badge), masked call, share; quick replies under the card.
  const c = await seed('courier');
  await page.goto(`${origin}/order/${c.orderId}?sheet=1`, LOADED);
  await byTestId('courier-card').waitFor({ timeout: 20_000 });
  await byTestId('chat-courier').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(5500); // the threads poll brings the unread badge
  // The first order screen asks about notifications (our pre-prompt, a modal): shoot it, then "بعدين".
  if (await byTestId('push-preprompt').isVisible().catch(() => false)) {
    await shot('chat-push-preprompt');
    await byTestId('push-preprompt-later').click();
    await page.waitForTimeout(600);
  }
  await shot('chat-order-buttons');

  // The courier thread: bubbles, quick replies, the masked number, a location pin, receipts.
  await byTestId('chat-courier').click();
  await byTestId('chat-screen').waitFor({ timeout: 15_000 });
  await byTestId('chat-msg-6').waitFor({ timeout: 15_000 });
  await shot('chat-courier-thread');

  await page.locator('[data-testid="chat-input"]').fill('شكراً، أني نازل هسة');
  await shot('chat-courier-typing');
  await byTestId('chat-send').click();
  await byTestId('chat-msg-7').waitFor({ timeout: 15_000 });
  await byTestId('qr-customer_wait_minute').click();
  await byTestId('chat-msg-8').waitFor({ timeout: 15_000 });
  await shot('chat-courier-sent');

  await byTestId('chat-call').click();
  await page.waitForTimeout(600);
  await shot('chat-call');

  // The kitchen thread.
  const m = await seed('merchant');
  await page.goto(`${origin}/chat/${m.orderId}?kind=customer_merchant`, LOADED);
  await byTestId('chat-msg-4').waitFor({ timeout: 15_000 });
  await shot('chat-merchant-thread');

  // «احجي ويا الدعم»: the row on the order screen (unread from the desk), then the support chat.
  const sup = await seed('support');
  await page.goto(`${origin}/order/${sup.orderId}?sheet=2`, LOADED);
  await byTestId('action-chat-support').waitFor({ timeout: 20_000 });
  await byTestId('action-chat-support').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  await shot('chat-support-row');
  await byTestId('action-chat-support').click();
  await byTestId('chat-screen').waitFor({ timeout: 15_000 });
  await byTestId('chat-msg-3').waitFor({ timeout: 15_000 });
  await shot('chat-support-thread');
  // A fresh order: the empty support chat with its quick replies.
  const fresh = await seed('support_empty');
  await page.goto(`${origin}/chat/${fresh.orderId}?kind=customer_support`, LOADED);
  await byTestId('chat-support-empty').waitFor({ timeout: 15_000 });
  await shot('chat-support-empty');

  // Delivered, then 31 minutes later: read-only.
  await demoPost(`/demo/track/advance?orderId=${c.orderId}`);
  await demoPost(`/demo/track/advance?orderId=${c.orderId}`);
  await demoPost('/demo/chat/clock?minutes=31');
  await page.goto(`${origin}/chat/${c.orderId}?kind=customer_courier`, LOADED);
  await byTestId('chat-closed').waitFor({ timeout: 15_000 });
  await shot('chat-closed');
  await demoPost('/demo/chat/clock?minutes=0');

  // A ride: share sheet, then the public page in a signed-out browser, then revoked.
  const r = await seed('ride');
  await page.goto(`${origin}/order/${r.orderId}?sheet=1`, LOADED);
  await byTestId('share-trip').waitFor({ timeout: 20_000 });
  await shot('chat-ride-order');
  await byTestId('share-trip').click();
  await byTestId('share-panel').waitFor({ timeout: 15_000 });
  await shot('chat-ride-share-sheet');

  const guest = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'ar-IQ' });
  guest.on('pageerror', (e) => errors.push(`guest: ${e.stack ?? e.message}`));
  await guest.goto(`${origin}${r.path}`, { waitUntil: 'load', timeout: 30_000 });
  await guest.locator('[data-testid="share-page"]').waitFor({ timeout: 20_000 });
  await guest.locator('[data-testid="share-driver"]').waitFor({ timeout: 15_000 });
  await guest.waitForTimeout(6000);
  if (wanted('chat-share-page')) {
    await guest.evaluate(() => document.fonts.ready);
    await guest.screenshot({ path: join(outDir, 'chat-share-page.png') });
    console.log(join(outDir, 'chat-share-page.png'));
  }

  console.log('share page shot; revoking');
  await byTestId('share-revoke').click({ timeout: 15_000 });
  await byTestId('share-panel').waitFor({ state: 'detached', timeout: 15_000 });
  await guest.reload({ waitUntil: 'load', timeout: 30_000 });
  await guest.locator('[data-testid="share-ended"]').waitFor({ timeout: 15_000 });
  await guest.waitForTimeout(700);
  await guest.screenshot({ path: join(outDir, 'chat-share-ended.png') });
  console.log(join(outDir, 'chat-share-ended.png'));
  await guest.close();
}

/**
 * Seasons (J6): a Ramadan period from today, on a browser clock frozen at 13:00 Baghdad so the
 * countdown and the iftar slot show whatever the real hour. Home asks for the timetable, then counts
 * down; notifications show the pick; checkout offers «على الفطور»; then the Eid card. Ends with no season.
 */
async function seasonShots(khalid) {
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  await page.clock.setFixedTime(new Date(`${today}T13:00:00+03:00`));
  await page.evaluate(() => localStorage.removeItem('driver.customer.ramadan_timetable'));
  await demoPost('/demo/season?kind=ramadan');
  await page.goto(`${origin}/`, LOADED);
  await byTestId('home-season-pick').waitFor({ timeout: 15_000 });
  await shot('season-home-pick');
  await byTestId('chip-sunni').click();
  await byTestId('home-season-iftar').waitFor({ timeout: 10_000 });
  await shot('season-home-ramadan');

  await page.goto(`${origin}/profile/notifications`, LOADED);
  await byTestId('pref-ramadan-timetable').waitFor({ timeout: 15_000 });
  await byTestId('pref-ramadan-timetable').scrollIntoViewIfNeeded();
  await shot('season-timetable');

  await page.goto(`${origin}/restaurant/${khalid}`, LOADED);
  await byTestId(`dish-add-${khalid}_pepsi`).waitFor({ timeout: 15_000 });
  await byTestId(`dish-add-${khalid}_pepsi`).click();
  if (await byTestId('item-sheet').isVisible().catch(() => false)) {
    await byTestId('item-add').click();
    await byTestId('item-sheet').waitFor({ state: 'detached' });
  }
  await page.locator('[data-testid="cart-bar"]:visible').click();
  await byTestId('cart-checkout').click();
  await byTestId('checkout-price-total').waitFor({ timeout: 15_000 });
  await byTestId('chip-later').click();
  const iftarChip = page.getByText(/على الفطور/).first();
  await iftarChip.waitFor({ timeout: 10_000 });
  await iftarChip.click();
  await byTestId('checkout-iftar-note').waitFor({ timeout: 10_000 });
  await byTestId('checkout-iftar-note').scrollIntoViewIfNeeded();
  await page.waitForTimeout(3800); // let the "added" toast go
  await shot('season-checkout-iftar');

  await demoPost('/demo/season?kind=eid');
  await page.goto(`${origin}/`, LOADED);
  await byTestId('home-season').waitFor({ timeout: 15_000 });
  await shot('season-home-eid');
  await demoPost('/demo/season?kind=off');
}

/**
 * City taxi / tuktuk (customer spec §5): home's "وين رايح؟" → search → choose ride (quotes, fare
 * breakdown, door pickup) → an edge zone (tuktuk off) → a pin on the map → request a tuktuk →
 * searching (radar, free cancel) → the demo driver accepts → at pickup → on the trip → arrival →
 * rating. The demo API plays the drivers (POST /demo/ride; offers held until /demo/ride/accept).
 */
async function rideShots() {
  await demoPost('/demo/ride?acceptMs=0');
  await page.goto(`${origin}/`, LOADED);
  await byTestId('service-taxi').waitFor({ timeout: 15_000 });
  await byTestId('service-taxi').scrollIntoViewIfNeeded();
  await shot('ride-home');

  await byTestId('service-taxi').click();
  await byTestId('ride-where').waitFor({ timeout: 15_000 });
  await page.locator('[data-testid^="ride-spot-landmark:"]').first().waitFor({ timeout: 15_000 });
  await settle(600);
  await shot('ride-where');
  await fullShot('ride-where-full');

  await page.locator('[data-testid="ride-dropoff-input"]').fill('الشاشه');
  await page.locator('[data-testid="ride-results"]').waitFor();
  await shot('ride-search');
  await page.locator('[data-testid^="ride-spot-landmark:"]').first().click();
  await byTestId('ride-choose').waitFor({ timeout: 15_000 });
  await byTestId('ride-price-taxi').waitFor({ timeout: 15_000 });
  await byTestId('ride-price-tuktuk').waitFor({ timeout: 15_000 });
  await settle(900);
  await shot('ride-choose');
  await fullShot('ride-choose-full');

  await byTestId('ride-details-taxi').click();
  await byTestId('ride-fare-panel').waitFor();
  await settle(500);
  await shot('ride-fare');
  await byTestId('ride-fare-close').click();
  await byTestId('ride-fare-panel').waitFor({ state: 'detached' });

  await page.getByText('تعال للباب', { exact: false }).first().click();
  await page.waitForTimeout(600);
  await byTestId('ride-pickup-hint').scrollIntoViewIfNeeded();
  await shot('ride-door');
  await page.getByText('أطلع للشارع', { exact: true }).first().click();

  // An edge zone: the tuktuk is off, with the reason and "try anyway".
  await byTestId('ride-edit-route').click();
  await byTestId('ride-where').waitFor({ timeout: 15_000 });
  await byTestId('ride-dropoff').click();
  await byTestId('ride-zone-mashrou_owaid').scrollIntoViewIfNeeded();
  await byTestId('ride-zone-mashrou_owaid').click();
  await byTestId('ride-tuktuk-edge').waitFor({ timeout: 15_000 });
  await byTestId('ride-price-taxi').waitFor({ timeout: 15_000 });
  await settle(900);
  await shot('ride-edge');

  // A fresh tuktuk booking from home's shortcut, the destination as a pin on the map: drag the map
  // ~800 m north-west, the zone under the pin resolves (server side).
  await page.goto(`${origin}/`, LOADED);
  await byTestId('service-tuktuk').click();
  await byTestId('ride-where').waitFor({ timeout: 15_000 });
  await byTestId('ride-on-map').first().click();
  await byTestId('ride-pin').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  const box = await byTestId('ride-pin-map').boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) await page.mouse.move(x + i * 12, y + i * 22, { steps: 2 });
    await page.mouse.up();
  }
  await page.waitForFunction(() => !document.querySelector('[data-testid="ride-pin-confirm"]')?.getAttribute('aria-disabled')?.includes('true'), null, { timeout: 15_000 }).catch(() => undefined);
  await settle(900);
  await shot('ride-pin');
  await byTestId('ride-pin-confirm').click();
  await byTestId('ride-choose').waitFor({ timeout: 15_000 });
  await byTestId('ride-price-tuktuk').waitFor({ timeout: 15_000 });

  // Request a tuktuk with a note for the driver.
  await byTestId('ride-vehicle-tuktuk').click();
  await page.locator('[data-testid="ride-note"]').fill('يم الصيدلية، الباب الأخضر');
  await settle(600);
  await shot('ride-choose-tuktuk');
  await byTestId('ride-request').click();
  await page.waitForURL(/\/order\//, { timeout: 15_000 });
  const orderId = new URL(page.url()).pathname.split('/').pop();
  await byTestId('ride-search-counter').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(4200);
  await shot('ride-searching');
  await byTestId('ride-cancel-searching').waitFor({ state: 'attached', timeout: 5_000 }).catch(() => undefined);
  await page.goto(`${origin}/order/${orderId}?sheet=1`, LOADED);
  await byTestId('ride-cancel-searching').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shot('ride-searching-expanded');
  await byTestId('ride-cancel-searching').click();
  await byTestId('cancel-panel').waitFor();
  await settle(900);
  await shot('ride-cancel');
  await page.getByText('لا، خليه').first().click().catch(async () => page.keyboard.press('Escape'));

  // The nearest tuktuk accepts and drives over.
  const ok = await demoPost(`/demo/ride/accept?orderId=${orderId}`);
  if (!ok) return;
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('courier-marker').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(4500);
  await shot('ride-matched');
  await page.goto(`${origin}/order/${orderId}?sheet=1`, LOADED);
  await byTestId('courier-card').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await shot('ride-matched-expanded');

  await demoPost(`/demo/ride/advance?orderId=${orderId}`);
  await page.goto(`${origin}/order/${orderId}?sheet=1`, LOADED);
  await byTestId('ride-wait-note').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shot('ride-at-pickup');

  await demoPost(`/demo/ride/advance?orderId=${orderId}`);
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('courier-marker').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(5000);
  await shot('ride-on-trip');
  await page.goto(`${origin}/order/${orderId}?sheet=2`, LOADED);
  await byTestId('sheet-body').waitFor({ timeout: 15_000 });
  await page.locator('[data-testid="sheet-body"]').evaluate((el) => el.scrollBy(0, 2000));
  await page.waitForTimeout(1200);
  await shot('ride-on-trip-actions');

  // Leave the order screen first: an open screen would see the arrival live and play it there (once
  // per order), and the reload below would then open on the calm receipt.
  await page.goto(`${origin}/`, LOADED);
  await demoPost(`/demo/ride/advance?orderId=${orderId}`);
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('arrival').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await shot('ride-arrived');
  await byTestId('arrival-rate').click();
  await byTestId('stars-delivery').waitFor();
  await settle(500);
  await shot('ride-rating');
}

/**
 * Joy J7b: a gift to «أمي» through checkout (wallet, hidden prices, a line), its heads-up card while
 * the kitchen decides; «عزّم صديقك» with two friends who took the code; a friend's landing as a guest;
 * the sticker pack; the share card after a delivered meal and after a الرجعة trip, with the rendered
 * PNGs the web downloads (the browser here cannot share files).
 */
async function giftShots(khalid, personId) {
  const item = (key) => `${khalid}_${key}`;
  if (personId) await demoPost(`/demo/account?personId=${encodeURIComponent(personId)}`);
  await page.goto(`${origin}/restaurant/${khalid}`, LOADED);
  await byTestId(`dish-add-${item('pepsi')}`).waitFor({ timeout: 15_000 });
  await byTestId(`dish-${item('kebab_plate')}`).click();
  await byTestId('item-sheet').waitFor();
  await byTestId('item-add').click();
  await byTestId('item-sheet').waitFor({ state: 'detached' });
  await page.locator('[data-testid="cart-bar"]:visible').click();
  await byTestId('cart-checkout').click();
  await byTestId('checkout-price-total').waitFor({ timeout: 15_000 });
  await byTestId('checkout-row-receiver').click();
  await byTestId('chip-other').click();
  await page.locator('[data-testid="checkout-recipient-name"]').fill('أمي');
  await page.locator('[data-testid="checkout-recipient-phone"]').fill('07801112233');
  await byTestId('chip-me_wallet').click();
  await byTestId('checkout-gift-switch').click();
  await page.getByText('بالعافية يمه', { exact: true }).first().click();
  await settle(600);
  await byTestId('checkout-gift').scrollIntoViewIfNeeded();
  await shot('gift-checkout');
  await fullShot('gift-checkout-full');

  await byTestId('checkout-place').click();
  await byTestId('gift-heads-up').waitFor({ timeout: 15_000 }).catch(() => errors.push('gift heads-up card not shown'));
  await settle(1200);
  await shot('gift-kitchen');
  const giftOrder = new URL(page.url()).pathname.split('/').pop();
  await fetch(`${apiBase}/demo/kitchen?orderId=${giftOrder}&action=accept`, { method: 'POST' });
  await page.waitForURL(/\/order\//, { timeout: 15_000 }).catch(() => errors.push('accepted gift did not open /order/[id]'));
  await page.goto(`${origin}/order/${giftOrder}?sheet=2`, LOADED);
  await byTestId('sheet-body').waitFor({ timeout: 15_000 });
  await page.locator('[data-testid="sheet-body"]').evaluate((el) => el.scrollBy(0, 2000));
  await settle(1200);
  await shot('gift-order');

  if (personId) await demoPost(`/demo/invite?personId=${encodeURIComponent(personId)}`);
  await page.goto(`${origin}/invite`, LOADED);
  await byTestId('invite-code').waitFor({ timeout: 15_000 });
  await settle(800);
  await shot('gift-invite');
  await fullShot('gift-invite-full');
  const code = (await byTestId('invite-code').innerText()).trim();

  // A friend without the app or an account opens the link.
  const guest = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'ar-IQ' });
  guest.on('pageerror', (e) => errors.push(`[guest] ${e.stack ?? e.message}`));
  await guest.goto(`${origin}/i/${code}`, LOADED);
  await guest.locator('[data-testid="invite-landing-title"]').waitFor({ timeout: 20_000 }).catch(() => errors.push('invite landing not shown'));
  await guest.evaluate(() => document.fonts.ready);
  await guest.waitForTimeout(900);
  if (wanted('gift-invite-landing')) await guest.screenshot({ path: join(outDir, 'gift-invite-landing.png') });
  await guest.close();

  await page.goto(`${origin}/stickers`, LOADED);
  await byTestId('sticker-bil_afia').waitFor({ timeout: 15_000 });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await settle(800);
  await shot('gift-stickers');
  await fullShot('gift-stickers-full');

  // The share card after a delivered meal: the sheet, then the picture the web renders (a download here).
  const history = personId ? await demoPost(`/demo/history?personId=${encodeURIComponent(personId)}`) : null;
  const delivered = history?.orderIds?.[0];
  if (delivered) {
    await page.goto(`${origin}/order/${delivered}?sheet=2`, LOADED);
    await byTestId('action-share-card').waitFor({ timeout: 15_000 });
    await byTestId('action-share-card').click();
    await byTestId('sharecard-panel').waitFor({ timeout: 10_000 });
    await settle(900);
    await shot('gift-sharecard');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), byTestId('sharecard-share').click()]);
    if (wanted('gift-card')) await dl.saveAs(join(outDir, 'gift-card-food.png'));
    await byTestId('sharecard-name').click();
    await settle(400);
    const [named] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), byTestId('sharecard-share').click()]);
    if (wanted('gift-card')) await named.saveAs(join(outDir, 'gift-card-food-name.png'));
  } else errors.push('no delivered order for the share card');

  const trip = personId ? await demoPost(`/demo/rajaa/arrived?personId=${encodeURIComponent(personId)}`) : null;
  if (trip?.bookingId) {
    await page.goto(`${origin}/rajaa/pass/${trip.bookingId}`, LOADED);
    await byTestId('share-moment').waitFor({ timeout: 15_000 });
    await byTestId('share-moment').click();
    await byTestId('sharecard-panel').waitFor({ timeout: 10_000 });
    await settle(900);
    await shot('gift-sharecard-rajaa');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), byTestId('sharecard-share').click()]);
    if (wanted('gift-card')) await dl.saveAs(join(outDir, 'gift-card-rajaa.png'));
  } else errors.push('no الرجعة trip for the share card');
}

if (errors.length) {
  console.error('Errors:\n' + errors.map((e) => JSON.stringify(e).slice(0, 2000)).join('\n'));
  process.exitCode = 1;
}

/**
 * Joy J5b live moments on a food order, each from real events the demo API plays: the kitchen's yes,
 * «بدأنا», a courier taking it while the screen is open (the reveal), «جاهز»; the ETA box in kashi, its
 * range option (dev preview `?etaRange=1`) and late look; then the delivered moment with the courier
 * and the compliments after a 5-star rating (the tip card still follows).
 */
async function liveShots(personId) {
  const pid = encodeURIComponent(personId ?? '');
  const k = await demoPost(`/demo/track?personId=${pid}&scenario=kitchen`);
  if (!k) return;
  await page.goto(`${origin}/order/${k.orderId}`, LOADED);
  await byTestId('kitchen-progress').waitFor({ timeout: 15_000 });
  await settle(1200);
  await shot('live-kitchen-accepted');
  await demoPost(`/demo/track/kitchen?orderId=${k.orderId}&step=preparing`);
  await page.locator('[data-testid="kitchen-cooking"]').getByText(/\d:\d\d/).waitFor({ timeout: 20_000 }).catch(() => errors.push('kitchen strip did not show cooking'));
  await settle(900);
  await shot('live-kitchen-cooking');
  await demoPost(`/demo/track/assign?orderId=${k.orderId}&rated=1`);
  if (await byTestId('driver-reveal').waitFor({ timeout: 25_000 }).then(() => true).catch(() => false)) {
    await settle(1500);
    await shot('live-reveal-food');
    await byTestId('driver-reveal-close').click();
  } else errors.push('driver reveal did not show');
  await demoPost(`/demo/track/kitchen?orderId=${k.orderId}&step=ready`);
  await page.locator('[data-testid="kitchen-ready"]').getByText(/\d:\d\d/).waitFor({ timeout: 20_000 }).catch(() => errors.push('kitchen strip did not show ready'));
  await settle(900);
  await shot('live-kitchen-ready');
  await page.goto(`${origin}/order/${k.orderId}?etaRange=1`, LOADED);
  await byTestId('eta-range').waitFor({ timeout: 15_000 }).catch(() => errors.push('ETA range option did not show'));
  await settle(1200);
  await shot('live-eta-range');

  const late = await demoPost(`/demo/track?personId=${pid}&scenario=late&pastPromiseMin=6`);
  if (late) {
    await page.goto(`${origin}/order/${late.orderId}`, LOADED);
    await byTestId('eta').waitFor({ timeout: 15_000 });
    // A fresh demo order opens within a minute of the courier's accept: the reveal shows; close it.
    if (await byTestId('driver-reveal').waitFor({ timeout: 3_000 }).then(() => true).catch(() => false)) await byTestId('driver-reveal-close').click();
    await settle(1500);
    await shot('live-eta-late');
  }

  const o = await demoPost(`/demo/track?personId=${pid}&scenario=on_the_way&rated=1`);
  if (!o) return;
  await page.goto(`${origin}/order/${o.orderId}`, LOADED);
  await byTestId('eta').waitFor({ timeout: 15_000 });
  if (await byTestId('driver-reveal').waitFor({ timeout: 3_000 }).then(() => true).catch(() => false)) await byTestId('driver-reveal-close').click();
  await settle(2500);
  await shot('live-eta');
  await demoPost(`/demo/track/advance?orderId=${o.orderId}`);
  await demoPost(`/demo/track/advance?orderId=${o.orderId}`);
  if (!(await byTestId('arrival').waitFor({ timeout: 25_000 }).then(() => true).catch(() => false))) {
    errors.push('arrival did not show');
    return;
  }
  await settle(1800);
  await shot('live-delivered');
  await byTestId('arrival-rate').click();
  await byTestId('stars-delivery-5').click();
  await byTestId('stars-food-5').click();
  if (!(await byTestId('compliment-offer').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false))) {
    errors.push('compliment chips did not show');
    return;
  }
  await settle(1500);
  await shot('live-compliments');
  await page.getByText('مؤدب', { exact: true }).first().click();
  await page.getByText('الأكل وصل حار', { exact: true }).first().click();
  await settle(500);
  await shot('live-compliments-picked');
  await byTestId('compliment-send').click();
  await byTestId('compliment-sent').waitFor({ timeout: 15_000 }).catch(() => errors.push('compliments not sent'));
  await settle(900);
  await shot('live-compliments-sent');

  // The ride reveal: a taxi to the first landmark; the demo driver accepts while the screen is open.
  await demoPost('/demo/ride?acceptMs=0');
  await page.goto(`${origin}/`, LOADED);
  await byTestId('service-taxi').click();
  await byTestId('ride-where').waitFor({ timeout: 15_000 });
  await page.locator('[data-testid^="ride-spot-landmark:"]').first().click();
  await byTestId('ride-price-taxi').waitFor({ timeout: 15_000 });
  await byTestId('ride-request').click();
  await page.waitForURL(/\/order\//, { timeout: 15_000 });
  const rideId = new URL(page.url()).pathname.split('/').pop();
  await byTestId('ride-search-counter').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await demoPost(`/demo/ride/accept?orderId=${rideId}`);
  if (await byTestId('driver-reveal').waitFor({ timeout: 25_000 }).then(() => true).catch(() => false)) {
    await settle(1500);
    await shot('live-reveal-ride');
  } else errors.push('ride reveal did not show');
}

/** The V2 basket and kitchen card (switch `basket_v2`, on in DEV_TOOLS builds). */
async function basketShots(khalid) {
  const item = (key) => `${khalid}_${key}`;
  const cartBar = page.locator('[data-testid="cart-bar"]:visible');
  await page.goto(`${origin}/restaurant/${khalid}`, LOADED);
  await byTestId(`dish-add-${item('pepsi')}`).waitFor({ timeout: 15_000 });
  await byTestId(`dish-add-${item('pepsi')}`).click();
  await cartBar.waitFor();
  await byTestId(`dish-${item('tikka_wrap')}`).click();
  await byTestId('item-sheet').waitFor();
  await byTestId(`mod-${item('tikka_wrap')}_mg_1_m_2`).click();
  await byTestId(`mod-${item('tikka_wrap')}_mg_2_m_4`).click();
  const sara = page.getByText('سارة', { exact: true });
  if ((await sara.count()) > 0) await sara.first().click();
  else {
    await page.getByText('ضيف شخص', { exact: true }).click();
    await page.locator('[data-testid="item-person-name"]').fill('سارة');
    await page.locator('[data-testid="item-person-phone"]').fill('07701234567');
    await byTestId('item-person-save').click();
  }
  await byTestId('item-add').click();
  await byTestId('item-sheet').waitFor({ state: 'detached' });
  await cartBar.click();
  await byTestId('basket-total').waitFor({ timeout: 15_000 });
  await byTestId('cart-price').waitFor({ timeout: 15_000 }).catch(() => errors.push('basket quote not ready'));
  await page.waitForTimeout(3800); // let the last "added" toast go
  await shot('basket-cart');
  // The hint strip and the place sit under the tray: scroll the basket to its end.
  await page.mouse.move(W / 2, 300);
  await page.mouse.wheel(0, 2000);
  await shot('basket-cart-end');
  const tabs = page.locator('[data-testid^="basket-tab-"]');
  if ((await tabs.count()) > 1) {
    await tabs.nth(1).click();
    await shot('basket-cart-person');
    await tabs.first().click();
  } else errors.push('basket person tabs not shown');

  await byTestId('cart-checkout').click();
  await byTestId('checkout-place').waitFor({ timeout: 15_000 });
  await byTestId('checkout-place').click();
  await byTestId('kitchen-card').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(6000); // the ring glides a little
  await shot('basket-kitchen-waiting');
  // Slow (45 s without an answer); needs the demo kitchen's auto-accept off (DEMO_KITCHEN_MS=0).
  await page.waitForTimeout(42_000);
  if (/\/kitchen\//.test(page.url())) await shot('basket-kitchen-slow');
  const orderId = new URL(page.url()).pathname.split('/').pop();
  const accept = await fetch(`${apiBase}/demo/kitchen?orderId=${orderId}&action=accept`, { method: 'POST' });
  if (!accept.ok) errors.push(`kitchen accept: ${accept.status} ${await accept.text()}`);
  await byTestId('kitchen-accepted').waitFor({ timeout: 15_000 }).catch(() => errors.push('kitchen accepted card not shown'));
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(outDir, 'basket-kitchen-accepted.png') });
}
