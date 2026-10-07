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
//   rajaa-*  board, seat screen on the driver's car, blocked seat, hold, pass, the board and «نبّهني» going out,
//            demand, request board, home                                POST /demo/rajaa/*
//   deals-*  مطعم خالد with its deal badges, the cart with line savings, checkout's deal line
//                                                                         POST /demo/deals
//   topup-*  wallet button, amount, code + QR, the ops agent's lookup and confirmation (Partner app
//            web export in PARTNER_DIST_DIR, built against the same demo API), the customer's receipt
//                                                                         POST /demo/ops-agent
//   chat-*   order screen chat/call/share, courier + kitchen + support threads, quick reply, masked call,
//            closed thread, ride share sheet, public share page (live + ended), and voice notes in the
//            ride chat (the driver's note, the mic explainer, recording, sent + his reply)  POST /demo/chat
//   ride-*   taxi/tuktuk booking: home bar, where to, search, choose (fare, door, family driver), edge
//            zone, pin, searching with the drivers sent it («نبّهه», a profile), cancel preview, matched,
//            a minute away, the screen light and safety shield (a night tab), the arrived card, on the
//            trip, night share, arrival (with the 10th-ride sticker), rating, the receipt's lost-item and
//            not-again rows
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
//   simple-* ride idea v2 «الوضع البسيط» on a fresh account with the phone's position faked: the account
//            switch, the simple home without a saved home and «وين بيتك؟», home saved from the phone, «رجعني
//            للبيت» from the souq to the simple choose screen, the simple search, the ride as the big card
//            (searching, then the driver coming)                         POST /demo/ride, /demo/ride/accept
//   later-*  step 4 c10/o4 on a fresh account: choose with «هسة / بعدين», the day+time picker (opened, a
//            time picked), the summary and «احجز لـ …», «مشوارك محجوز» with the reminder, the booked rides
//            in طلباتي and the free cancel, the «نفس مشوار البارحة» switch, and the push's link landing
//            on choose with both ends filled           POST /demo/ride-habits, /demo/same-ride
//   rajaa-taxi-* taxi ideas x2/x3/x4: the dev preview of the الرجعة taxi cards in every state (one shot per
//            card, plus the page), the live cards on the demo's seats, and the late notice on the live
//            ride screen of a taxi to a car                                POST /demo/rajaa-taxi
//            and ride idea n9 «Baghdad mode» (rajaa-taxi-n9-*): its card in every state, then live with the
//            browser's position in Baghdad (the next car back, then his seat with the n10 switch)
//                                                                         POST /demo/rajaa-taxi[&baghdadSeat=1]
//   booked-* review #28 on a fresh account: a ride booked for tomorrow while drivers are asked (home card
//            and screen), then one a driver confirmed («سايقك محجوز: حسين»)   POST /demo/booked-ride
//   habits-* joy J7a: pots strip + usual on home, a followed pot, Thursday 20:00 «باچر الجمعة» and its
//            booking sheet, the restaurant pot banner + story, the item follow row, the switch  POST /demo/usuals
//   crash-*  the root crash screen («صار خلل بالتطبيق», a demo render error from `?crash=1`, dev tools
//            only) and home again after «جرّب مرة ثانية»
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
// A fake microphone (a steady tone) so the chat's voice notes record headless.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
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
const GROUPS = ['app', 'acct', 'food', 'track', 'rajaa', 'driver', 'deals', 'topup', 'chat', 'ride', 'season', 'family', 'habits', 'gift', 'live', 'trips', 'crash', 'booked'];
const selected = (process.env.SHOTS ?? process.env.ONLY ?? process.env.SHOTS_PREFIX ?? 'all')
  .split(',')
  .map((s) => s.trim().replace(/-$/, ''))
  .filter(Boolean);
// Taxi/tuktuk step 4: booked rides (c10), the simple mode (v2) and the الرجعة-linked taxis (x2–x4); they run right after the ride flow.
const RIDE_GROUPS = ['later', 'simple', 'rajaa-taxi', 'ride-errors'];
const known = [...GROUPS, ...RIDE_GROUPS];
const groups = new Set(selected.includes('all') ? known : selected);
for (const g of groups) if (!known.includes(g)) throw new Error(`Unknown SHOTS group "${g}" (expected ${known.join(', ')} or all)`);
/** Whether a flow runs / a file is written: by its group, the longest group name the file name starts with. */
const wants = (group) => groups.has(group);
const groupOf = (name) => known.filter((g) => name === g || name.startsWith(`${g}-`)).sort((a, b) => b.length - a.length)[0] ?? name.split('-')[0];
const wanted = (name) => wants(groupOf(name));
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
    // Any element: React Native Web renders a screen's ScrollView as <main> on SDK 57.
    for (const el of document.querySelectorAll('*')) {
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
  if (wants('driver')) await driverShots(personId);
  if (wants('deals')) await dealsShots(khalid);
  if (wants('topup')) await topupShots();
  if (wants('chat')) await chatShots(personId);
  // c9/s3 «لمنو المشوار؟» runs after the ride flow (its recent destination would change that flow's searches), even when that flow stops early.
  if (wants('ride')) await rideShots().finally(() => rideForShots());
  if (wants('later')) await laterShots();
  if (wants('ride-errors')) await rideErrorShots();
  // Signs in as its own fresh account with the phone's position granted, then puts the demo account back.
  if (wants('simple')) await asOtherAccount(simpleShots);
  if (wants('rajaa-taxi')) await rajaaTaxiShots(personId);
  if (wants('season')) await seasonShots(khalid);
  if (wants('family')) await familyShots(personId);
  if (wants('habits')) await habitsShots();
  if (wants('gift')) await giftShots(khalid, personId);
  if (wants('live')) await liveShots(personId);
  if (wants('trips')) await tripsShots(khalid);
  if (wants('crash')) await crashShots();
  if (wants('booked')) await bookedShots();
} catch (err) {
  errors.push(err.stack ?? String(err));
  await page.screenshot({ path: join(outDir, 'app-failure.png') }).catch(() => {});
} finally {
  await browser.close();
  server.close();
}

/**
 * Runs a flow that signs in as another account on the shared page, then restores the demo account's
 * session (cookies + local storage) and drops the granted permissions, so the flows after it carry on
 * as before.
 */
async function asOtherAccount(flow) {
  const ctx = page.context();
  const saved = await ctx.storageState();
  try {
    await flow();
  } finally {
    await ctx.clearPermissions();
    await ctx.clearCookies();
    if (saved.cookies.length) await ctx.addCookies(saved.cookies);
    await page.goto(`${origin}/`, LOADED);
    const items = saved.origins.find((o) => o.origin === origin)?.localStorage ?? [];
    await page.evaluate((entries) => {
      localStorage.clear();
      for (const { name, value } of entries) localStorage.setItem(name, value);
    }, items);
    await page.goto(`${origin}/`, LOADED);
    await byTestId('home').waitFor({ timeout: 20_000 });
  }
}

/**
 * Taxi ideas x2/x3/x4 (docs/api/rajaa-taxi.md): the dev-only preview route with every card state on
 * sample data, one element shot per card; then the same route with the demo's seats (the live cards),
 * and the live ride screen of the taxi that would bring him late to his car (the x3 notice).
 */
async function rajaaTaxiShots(personId) {
  if (!personId) throw new Error('rajaa-taxi: no person');
  const seed = await demoPost(`/demo/rajaa-taxi?personId=${encodeURIComponent(personId)}`);
  if (!seed) return;
  const cardShot = async (name, id) => {
    if (!wanted(name)) return;
    const el = byTestId(id);
    await el.scrollIntoViewIfNeeded();
    await settle(400);
    const file = join(outDir, `${name}.png`);
    await el.screenshot({ path: file });
    console.log(file);
  };
  await page.goto(`${origin}/ride/garage-preview`, LOADED);
  await byTestId('garage-preview').waitFor({ timeout: 20_000 });
  await byTestId('pv-x4-error').waitFor({ timeout: 10_000 });
  await shot('rajaa-taxi-preview');
  await fullShot('rajaa-taxi-preview-full');
  const states = {
    x2: ['offer-later', 'offer-now', 'offer-offline', 'booked', 'no-place', 'too-late', 'loading', 'error', 'offline'],
    x3: ['not-told', 'told'],
    x4: ['off', 'armed', 'placed', 'dropped', 'failed', 'no-place', 'loading', 'error'],
    n9: ['next', 'next-last-seat', 'next-offline', 'kut', 'empty-announced', 'empty', 'booked', 'held', 'loading', 'error', 'offline'],
  };
  for (const [idea, keys] of Object.entries(states)) for (const key of keys) await cardShot(`rajaa-taxi-${idea}-${key}`, `pv-${idea}-${key}`);

  // The live cards on the demo server's seats.
  const q = Object.entries({ out: seed.outboundBookingId, ret: seed.returnBookingId, armed: seed.armedBookingId, placed: seed.placedBookingId, late: seed.lateOrderId })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  await page.goto(`${origin}/ride/garage-preview?${q}`, LOADED);
  await byTestId('garage-preview').waitFor({ timeout: 20_000 });
  for (const id of ['live-x2-body', 'live-x4-body', 'live-x4-armed-body', 'live-x4-placed', 'live-x3']) {
    await byTestId(id).waitFor({ timeout: 15_000 }).catch(() => errors.push(`rajaa-taxi: ${id} not shown`));
  }
  await cardShot('rajaa-taxi-live-x2', 'pv-live-x2');
  await cardShot('rajaa-taxi-live-x4-off', 'pv-live-x4');
  await cardShot('rajaa-taxi-live-x4-armed', 'pv-live-x4-armed');
  await cardShot('rajaa-taxi-live-x4-placed', 'pv-live-x4-placed');
  await cardShot('rajaa-taxi-live-x3', 'pv-live-x3');

  await rajaaTaxiN9Shots(personId, cardShot);

  // x3 where it lives: the taxi's own live screen.
  await page.goto(`${origin}/order/${seed.lateOrderId}`, LOADED);
  await byTestId('garage-late-notice').waitFor({ timeout: 20_000 }).catch(() => errors.push('rajaa-taxi: late notice not on the order screen'));
  await byTestId('garage-late-notice').scrollIntoViewIfNeeded().catch(() => {});
  await shot('rajaa-taxi-order-late');
  await fullShot('rajaa-taxi-order-late-full');
}

/**
 * Ride idea n9 «Baghdad mode» live on the preview route (`?n9=1`): nothing without the location
 * permission (the card never asks) or at home in Aziziyah; with the browser's position in Baghdad the
 * next car back from النهضة (the demo announced two), then — after `baghdadSeat=1` books him a seat — his
 * seat with the n10 switch under it. The permission is dropped again afterwards.
 */
async function rajaaTaxiN9Shots(personId, cardShot) {
  const BAGHDAD = { latitude: 33.3128, longitude: 44.3615, accuracy: 20 };
  const AZIZIYAH = { latitude: 32.9062, longitude: 45.0612, accuracy: 20 };
  const absent = async (why) => {
    await page.goto(`${origin}/ride/garage-preview?n9=1`, LOADED);
    await byTestId('pv-live-n9').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    if ((await byTestId('live-n9').count()) > 0) errors.push(`rajaa-taxi: the n9 card showed ${why}`);
  };
  const ctx = page.context();
  try {
    await absent('without the location permission');
    await ctx.grantPermissions(['geolocation'], { origin });
    await ctx.setGeolocation(AZIZIYAH);
    await absent('in Aziziyah');

    await ctx.setGeolocation(BAGHDAD);
    await page.goto(`${origin}/ride/garage-preview?n9=1`, LOADED);
    await byTestId('live-n9-time').waitFor({ timeout: 20_000 }).catch(() => errors.push('rajaa-taxi: n9 live card (next car) not shown'));
    await cardShot('rajaa-taxi-n9-live-next', 'pv-live-n9');

    const seat = await demoPost(`/demo/rajaa-taxi?personId=${encodeURIComponent(personId)}&baghdadSeat=1`);
    if (!seat) return;
    await page.goto(`${origin}/ride/garage-preview?n9=1`, LOADED);
    await byTestId('live-n9-seat-time').waitFor({ timeout: 20_000 }).catch(() => errors.push('rajaa-taxi: n9 live card (his seat) not shown'));
    await byTestId('live-n9-armed-body').waitFor({ timeout: 15_000 }).catch(() => errors.push('rajaa-taxi: n10 switch not under his seat'));
    await cardShot('rajaa-taxi-n9-live-booked', 'pv-live-n9');
  } finally {
    await ctx.clearPermissions();
  }
}

/**
 * Ride idea v2 «الوضع البسيط», as a fresh account with no saved place. The phone's position is faked
 * (granted geolocation): at home in الهاشمي to save it with «أني بالبيت هسة», then at كراج السوق for
 * «رجعني للبيت» → the simple choose screen → the search → the simple home's big ride card.
 */
async function simpleShots() {
  const HOME = { latitude: 32.896, longitude: 45.0675, accuracy: 15 };
  const SOUQ = { latitude: 32.9062, longitude: 45.0612, accuracy: 15 };
  await demoPost('/demo/ride?acceptMs=0');
  await page.context().grantPermissions(['geolocation'], { origin });
  await page.context().setGeolocation(HOME);
  await page.goto(`${origin}/`, LOADED);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${origin}/phone`, LOADED);
  await page.locator('[data-testid="phone-input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-testid="phone-input"]').fill(process.env.SIMPLE_PHONE ?? '0770 456 7722');
  await byTestId('phone-submit').click();
  await byTestId('otp-dev-strip').waitFor({ timeout: 15_000 });
  const code = (await byTestId('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
  if (!code) throw new Error('dev code not shown');
  await page.locator('[data-testid="otp-input"]').fill(code);
  const landed = await Promise.race([byTestId('setup-name').waitFor({ timeout: 15_000 }).then(() => 'setup'), byTestId('home').waitFor({ timeout: 15_000 }).then(() => 'home')]);
  if (landed === 'setup') {
    await page.locator('[data-testid="setup-name"]').fill('كاظم');
    await byTestId('setup-next').click();
    await byTestId('setup-skip-place').click();
    if (await byTestId('welcome-home').waitFor({ timeout: 8_000 }).then(() => true).catch(() => false)) {
      await byTestId('welcome-home').click();
      await byTestId('welcome-home').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
    }
  }
  await byTestId('home').waitFor({ timeout: 15_000 });

  // The account page: the switch with its one-line explanation; turning it on opens the simple home.
  await byTestId('tab-account').click();
  await byTestId('account-simple').waitFor({ timeout: 15_000 });
  await byTestId('account-simple').scrollIntoViewIfNeeded();
  await shot('simple-account');
  await byTestId('account-simple-switch').click();
  await byTestId('simple-home').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shot('simple-no-home');

  // «رجعني للبيت» with no saved home: «وين بيتك؟», then «أني بالبيت هسة» saves the phone's position.
  await byTestId('simple-go-home').click();
  await byTestId('simple-set-home').waitFor({ timeout: 10_000 });
  await settle(600);
  await shot('simple-set-home');
  await byTestId('simple-set-home-here').click();
  await byTestId('simple-set-home').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => errors.push('home not saved from the phone'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="simple-go-home-sub"]')?.textContent?.includes('بيتك أول'), null, { timeout: 15_000 }).catch(() => errors.push('simple home still asks for the home'));
  await page.waitForTimeout(2600);
  await shot('simple-home');

  // From the souq: one tap to the fares home, one confirm.
  // The web build asks the browser with maximumAge: Infinity (expo-location), so a fresh page reads the new position.
  await page.context().setGeolocation(SOUQ);
  await page.goto(`${origin}/simple`, LOADED);
  await byTestId('simple-go-home').waitFor({ timeout: 15_000 });
  await byTestId('simple-go-home').click();
  await byTestId('ride-choose').waitFor({ timeout: 15_000 });
  await byTestId('ride-price-taxi').waitFor({ timeout: 15_000 });
  await settle(1200);
  await shot('simple-choose');
  await byTestId('ride-request').click();
  await page.waitForURL(/\/order\//, { timeout: 15_000 });
  const orderId = new URL(page.url()).pathname.split('/').pop();
  await byTestId('ride-offers').waitFor({ timeout: 15_000 }).catch(() => errors.push('offered drivers not shown (simple)'));
  await page.waitForTimeout(3000);
  await shot('simple-searching');

  await page.goto(`${origin}/simple`, LOADED);
  await byTestId('simple-active-ride').waitFor({ timeout: 15_000 }).catch(() => errors.push('active ride card not shown on the simple home'));
  await settle(900);
  await shot('simple-active');
  const ok = await demoPost(`/demo/ride/accept?orderId=${orderId}`);
  if (!ok) return;
  await page.goto(`${origin}/simple`, LOADED);
  await byTestId('simple-active-driver').waitFor({ timeout: 15_000 }).catch(() => errors.push('driver not shown on the simple ride card'));
  await settle(900);
  await shot('simple-active-matched');
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('courier-marker').waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(3500);
  await shot('simple-live-matched');
  // Drive the ride to the end so its demo driver is free for the flows after this one.
  for (let i = 0; i < 3; i += 1) await demoPost(`/demo/ride/advance?orderId=${orderId}`);
}

/**
 * Joy J7d ride habits, as a fresh account (no order running): POST /demo/ride-habits gives two
 * finished taxi rides and a الرجعة (two favourites), two regular trips asking now and a ride booked for
 * the work trip's next day; POST /demo/dinner puts a taxi home on the road, then a seat to Aziziyah.
 */
async function tripsShots(khalid) {
  const personId = await freshSignIn(process.env.TRIPS_PHONE ?? '0770 456 8899');
  const seed = await demoPost(`/demo/ride-habits?personId=${encodeURIComponent(personId)}`);
  if (!seed) return;
  await tripsFlow(khalid, personId, seed);
}

/** Signs out, then in as that number (name and area on a first sign-in); the person's id. */
async function freshSignIn(phoneNumber) {
  await page.goto(`${origin}/`, LOADED);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${origin}/phone`, LOADED);
  await page.locator('[data-testid="phone-input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-testid="phone-input"]').fill(phoneNumber);
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
  return personId;
}

/**
 * Review #28 on a fresh account: a ride booked for tomorrow 7:30 while drivers are asked («ندوّرلك سايق،
 * نأكدلك قبل الساعة 10 بالليل») on home and its screen; cancelled from there; then one حسين confirmed
 * («سايقك محجوز: حسين» with his photo).                   POST /demo/booked-ride
 */
async function bookedShots() {
  const personId = await freshSignIn(process.env.BOOKED_PHONE ?? '0770 456 7711');
  const looking = await demoPost(`/demo/booked-ride?personId=${encodeURIComponent(personId)}&state=looking`);
  if (!looking) return;
  await page.goto(`${origin}/`, LOADED);
  await byTestId('home-booked-looking').waitFor({ timeout: 15_000 }).catch(() => errors.push('booked card «ندوّرلك سايق» not shown'));
  await shot('booked-home-looking');
  await page.goto(`${origin}/ride/booked/${looking.orderId}`, LOADED);
  await byTestId('booked-looking').waitFor({ timeout: 15_000 }).catch(() => errors.push('booked screen «نأكدلك قبل» not shown'));
  await shot('booked-looking');
  await byTestId('booked-cancel').click();
  await byTestId('booked-new').waitFor({ timeout: 15_000 }).catch(() => errors.push('booked ride not cancelled'));

  const confirmed = await demoPost(`/demo/booked-ride?personId=${encodeURIComponent(personId)}&state=confirmed`);
  if (!confirmed) return;
  await page.goto(`${origin}/`, LOADED);
  await byTestId('home-booked-driver').waitFor({ timeout: 15_000 }).catch(() => errors.push('booked card «سايقك محجوز» not shown'));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete)).catch(() => {});
  await shot('booked-home-confirmed');
  await page.goto(`${origin}/ride/booked/${confirmed.orderId}`, LOADED);
  await byTestId('booked-driver').waitFor({ timeout: 15_000 }).catch(() => errors.push('booked screen «سايقك محجوز» not shown'));
  await page.waitForFunction(() => [...document.images].every((i) => i.complete)).catch(() => {});
  await shot('booked-confirmed');
  await fullShot('booked-confirmed-full');
}

async function tripsFlow(khalid, personId, seed) {
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

  // Booking a ride for later with the favourite: home → work, «بعدين» (its picker's first time), حسين.
  await page.goto(`${origin}/ride`, LOADED);
  // The where-to screen may open on «من» or on «إلى»: الدائرة, then البيت if it was the pickup.
  await page.locator('[data-testid^="ride-saved-"]', { hasText: 'الدائرة' }).first().click();
  await settle(600);
  if (!(await byTestId('ride-choose').isVisible().catch(() => false))) await page.locator('[data-testid^="ride-saved-"]', { hasText: 'البيت' }).first().click();
  await byTestId('ride-choose').waitFor({ timeout: 15_000 }).catch(async () => {
    errors.push('choose screen not shown');
    await page.screenshot({ path: join(outDir, 'trips-debug-choose.png') });
  });
  // «وكتها» lives in the trip options sheet (ride idea c7).
  await byTestId('ride-options').click();
  await byTestId('ride-options-panel').waitFor();
  await page.getByText('بعدين', { exact: true }).click();
  await byTestId('ride-later-pick').waitFor({ timeout: 10_000 });
  await byTestId('ride-later-pick').click();
  await byTestId('ride-later-sheet').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  await byTestId('ride-fav').waitFor({ timeout: 10_000 }).catch(() => errors.push('favourite chips not shown'));
  await page.getByText('حسين', { exact: true }).click().catch(() => errors.push('favourite chip not found'));
  await byTestId('ride-when').scrollIntoViewIfNeeded();
  await settle(900);
  await shot('trips-choose-later');
  await byTestId('ride-options-done').click();
  await settle(600);
  await shot('trips-choose-later-row');

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
 * Step 4 c10 + o4, as a fresh account: a ride booked «بعدين» from choose (the picker, the summary, the
 * button), its booked screen with the reminder, the booked rides in طلباتي with «ألغي», the
 * «نفس مشوار البارحة» switch, and the push's deep link landing on choose with البيت ← الدائرة filled.
 */
/**
 * W11 launch fixes: what the ride screens say when a read fails (VIS-41 known places, FLOW-28 the pin's
 * area, FLOW-27 the price), each with its retry; and VIS-21, the pin at 360 px confirms after every drag
 * and after a touch that never moves the map. Each failure is one procedure's request answered as a
 * network failure (a batch carrying it fails as a whole, as it would on a phone).
 */
async function rideErrorShots() {
  const failing = (proc) => async (route) => (route.request().url().includes(proc) ? route.abort('failed') : route.continue());
  const withFailure = async (proc, flow) => {
    const handler = failing(proc);
    await page.route('**/trpc/**', handler);
    try {
      await flow();
    } finally {
      await page.unroute('**/trpc/**', handler);
    }
  };

  await withFailure('places.landmarks', async () => {
    await page.goto(`${origin}/ride`, LOADED);
    await byTestId('ride-landmarks-failed').waitFor({ timeout: 40_000 }).catch(() => errors.push('known places: no failed state'));
    await byTestId('ride-landmarks-failed').scrollIntoViewIfNeeded().catch(() => undefined);
    await settle(700);
    await shot('ride-errors-landmarks');
  });

  await withFailure('places.zoneFor', async () => {
    await page.goto(`${origin}/ride/pin?field=dropoff`, LOADED);
    await byTestId('ride-pin-zone-failed').waitFor({ timeout: 40_000 }).catch(() => errors.push('pin: no failed state'));
    await settle(700);
    await shot('ride-errors-pin');
  });

  await withFailure('pricing.quote', async () => {
    await page.goto(`${origin}/ride`, LOADED);
    // A saved place that isn't the pickup (البيت is): the choose screen opens with both ends.
    await page.locator('[data-testid^="ride-saved-"]', { hasText: 'الدائرة' }).first().click();
    await byTestId('ride-choose').waitFor({ timeout: 15_000 }).catch(() => errors.push('choose not opened'));
    await byTestId('ride-quote-failed').waitFor({ timeout: 40_000 }).catch(() => errors.push('choose: no price failed line'));
    await settle(700);
    await shot('ride-errors-price');
  });

  // VIS-21 at 360 px: ten drags, then a touch that lifts the pin without moving the map.
  await page.setViewportSize({ width: 360, height: 740 });
  try {
    await page.goto(`${origin}/ride/pin?field=dropoff`, LOADED);
    await byTestId('ride-pin').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    const enabled = () => page.waitForFunction(() => !document.querySelector('[data-testid="ride-pin-confirm"]')?.getAttribute('aria-disabled')?.includes('true'), null, { timeout: 4_000 }).then(() => true).catch(() => false);
    const box = await byTestId('ride-pin-map').boundingBox();
    let stuck = 0;
    for (let n = 0; box && n < 10; n++) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const dx = (n % 2 ? -1 : 1) * 8;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(x + i * dx, y + i * 6, { steps: 2 });
      await page.mouse.up();
      if (!(await enabled())) stuck++;
    }
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      if (!(await enabled())) stuck++;
    }
    if (stuck > 0) errors.push(`pin at 360 px: «ثبّت الوجهة» stayed off ${stuck} of 11 times`);
    else console.log('pin at 360 px: confirm enabled after all 11 touches');
    await settle(600);
    await shot('ride-errors-pin-360');
  } finally {
    await page.setViewportSize({ width: W, height: H });
  }
}

async function laterShots() {
  await page.goto(`${origin}/`, LOADED);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${origin}/phone`, LOADED);
  await page.locator('[data-testid="phone-input"]').waitFor({ timeout: 20_000 });
  await page.locator('[data-testid="phone-input"]').fill(process.env.LATER_PHONE ?? '0770 456 7711');
  await byTestId('phone-submit').click();
  await byTestId('otp-dev-strip').waitFor({ timeout: 15_000 });
  const code = (await byTestId('otp-dev-strip').innerText()).match(/\d{6}/)?.[0];
  if (!code) throw new Error('dev code not shown');
  await page.locator('[data-testid="otp-input"]').fill(code);
  const landed = await Promise.race([byTestId('setup-name').waitFor({ timeout: 15_000 }).then(() => 'setup'), byTestId('home').waitFor({ timeout: 15_000 }).then(() => 'home')]);
  if (landed === 'setup') {
    await page.locator('[data-testid="setup-name"]').fill('أم حيدر');
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
  // Home and الدائرة saved, two rides done, and the work trip's next day booked already.
  const seed = await demoPost(`/demo/ride-habits?personId=${encodeURIComponent(personId)}`);
  if (!seed) return;
  const visible = (id) => page.locator(`[data-testid="${id}"]:visible`).first();

  // Choose: البيت → الدائرة, then «بعدين».
  await page.goto(`${origin}/ride`, LOADED);
  await page.locator('[data-testid^="ride-saved-"]', { hasText: 'الدائرة' }).first().click();
  await settle(600);
  if (!(await byTestId('ride-choose').isVisible().catch(() => false))) await page.locator('[data-testid^="ride-saved-"]', { hasText: 'البيت' }).first().click();
  await byTestId('ride-choose').waitFor({ timeout: 15_000 });
  // «هسة / بعدين» lives in the trip options sheet (ride idea c7).
  await byTestId('ride-options').click();
  await byTestId('ride-options-panel').waitFor();
  await byTestId('ride-when').scrollIntoViewIfNeeded();
  await settle(900);
  await shot('later-choose-now');
  await page.getByText('بعدين', { exact: true }).click();
  await byTestId('ride-later-sheet').waitFor({ timeout: 10_000 });
  await settle(800);
  await shot('later-picker');
  // باچر at 7, then a quarter past.
  await visible('ride-later-day-1').click();
  await visible('ride-later-hour-7').click();
  await page.getByText('7:15', { exact: true }).last().click().catch(() => errors.push('quarter 7:15 not shown'));
  await settle(600);
  await shot('later-picker-picked');
  await visible('ride-later-pick').click();
  await byTestId('ride-later-sheet').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  await byTestId('ride-when-summary').waitFor({ timeout: 10_000 });
  await byTestId('ride-when-summary').scrollIntoViewIfNeeded();
  await settle(900);
  await shot('later-choose-booked');
  await byTestId('ride-options-done').click();
  await byTestId('ride-options-panel').waitFor({ state: 'detached' }).catch(() => undefined);
  await page.waitForFunction(() => /احجز لـ/.test(document.querySelector('[data-testid="ride-request"]')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => errors.push('book-for button not shown'));
  await settle(900);
  await shot('later-choose-booked-row');

  // Booked: «مشوارك محجوز» with the reminder half an hour before.
  await byTestId('ride-request').click();
  await byTestId('booked-reminder').waitFor({ timeout: 20_000 }).catch(() => errors.push('booked reminder row not shown'));
  await settle(900);
  await shot('later-booked');
  await fullShot('later-booked-full');

  // طلباتي: both rides booked for later, with «ألغي»; the cancel asks once.
  await page.goto(`${origin}/orders`, LOADED);
  await page.locator('[data-testid^="booked-cancel-"]').first().waitFor({ timeout: 15_000 }).catch(() => errors.push('booked rides not in طلباتي'));
  await settle(900);
  await shot('later-orders');
  if (seed.bookedOrderId) {
    await visible(`booked-cancel-${seed.bookedOrderId}`).click();
    await byTestId(`booked-cancel-sheet-${seed.bookedOrderId}-yes`).waitFor({ timeout: 10_000 });
    await settle(700);
    await shot('later-orders-cancel');
    await byTestId(`booked-cancel-sheet-${seed.bookedOrderId}-yes`).click();
    await byTestId(`booked-${seed.bookedOrderId}`).waitFor({ state: 'detached', timeout: 15_000 }).catch(() => errors.push('cancelled booked ride still listed'));
    await settle(900);
    await shot('later-orders-cancelled');
  }

  // o4: the switch in notification settings, and the push's link landing on choose.
  await page.goto(`${origin}/profile/notifications`, LOADED);
  await byTestId('pref-sameRide').waitFor({ timeout: 15_000 });
  await byTestId('pref-sameRide').scrollIntoViewIfNeeded();
  await settle(600);
  await shot('later-notify');
  const link = await demoPost(`/demo/same-ride?personId=${encodeURIComponent(personId)}`);
  if (link?.deepLink) {
    await page.goto(`${origin}/${link.deepLink.slice('driver://'.length)}`, LOADED);
    await byTestId('ride-again-note').waitFor({ timeout: 20_000 }).catch(() => errors.push('same-ride landing note not shown'));
    await settle(1200);
    await shot('later-again');
  }
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
  await page.goto(`${origin}/restaurant/${khalid}`, LOADED);
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

  // Narrowing (s2, s5, s7, x3): tomorrow's cars, then tomorrow night with none → one-tap «نبّهني».
  await byTestId('board-day-tomorrow').click();
  await settle(800);
  await shot('rajaa-board-tomorrow');
  await byTestId('board-part-night').click();
  await byTestId('board-wish').waitFor({ timeout: 10_000 });
  await settle(600);
  await shot('rajaa-board-wish');
  await byTestId('board-day-today').click();
  await byTestId('board-part-all').click();
  await firstCar.waitFor({ timeout: 15_000 });

  // Seat booking (Ali dropped «مسافر», 2026-10-07): the seat screen opens with the best seat picked.
  await firstCar.click();
  await byTestId('rajaa-book').waitFor({ timeout: 15_000 });
  await shot('rajaa-seat-top');
  await fullShot('rajaa-seat-sheet');
  await page.waitForTimeout(1200);
  // c4: the only seat open to him is picked for him already («اخترنالك ورا نص»); tap it only if not.
  if (await byTestId('rajaa-auto-picked').isVisible()) {
    await byTestId('rajaa-auto-picked').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await settle(300);
    await shot('rajaa-seat-auto');
  } else {
    await page.locator('[data-testid="rajaa-book"] [data-testid="seat-back_middle"]').click();
  }
  await byTestId('rajaa-quote').waitFor({ timeout: 10_000 });
  // The driver's own car under the seats (an Elantra on this run), with the picked seat.
  await byTestId('car-seat-art').scrollIntoViewIfNeeded().catch(() => errors.push('car picture not shown on the seat screen'));
  await shot('rajaa-seat-picked');
  // Where you get in (c5): one row of three; «على الطريق» opens the stops.
  await byTestId('pickup-tile-way').click();
  await page.locator('[data-testid^="pickup-mp_"]').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await settle(400);
  await shot('rajaa-seat-pickup-way');
  await byTestId('pickup-tile-garage').click();
  await byTestId('rajaa-hold').click();
  await byTestId('rajaa-hold-ring').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await shot('rajaa-hold');
  await fullShot('rajaa-hold-full');
  // p2/p3: the wallet, «الأضمن», with what it lacks and «اشحن»; back to cash for the reservation.
  await byTestId('pay-wallet').click();
  await byTestId('rajaa-wallet-balance').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await settle(400);
  await shot('rajaa-pay-wallet');
  await byTestId('pay-cash').click();

  // Cash reservation → boarding pass (boarding is open on this car: live position shows).
  await byTestId('rajaa-confirm').click();
  await byTestId('rajaa-ticket').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shot('rajaa-pass');
  await fullShot('rajaa-pass-full');

  // Leaving Aziziyah from a gate, paid from the wallet (t4, t6): when to leave home, the late bar.
  if (personId) {
    const out = await demoPost(`/demo/rajaa/outbound?personId=${encodeURIComponent(personId)}`);
    if (out?.bookingId) {
      await page.goto(`${origin}/rajaa/pass/${out.bookingId}`, LOADED);
      await byTestId('rajaa-ticket').waitFor({ timeout: 15_000 });
      await settle(1200);
      await fullShot('rajaa-pass-out-full');
      await byTestId('rajaa-leave-home').evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => errors.push('leave-home card not shown on the outbound pass'));
      await settle(300);
      await shot('rajaa-pass-out-leave');
    }
    // On the road (r1–r3, r6): just left, his mother and Zainab following.
    const onRoad = await demoPost(`/demo/rajaa/onboard?personId=${encodeURIComponent(personId)}&road=1`);
    if (onRoad?.bookingId) {
      await page.goto(`${origin}/rajaa/pass/${onRoad.bookingId}`, LOADED);
      await byTestId('rajaa-road').waitFor({ timeout: 15_000 }).catch(() => errors.push('road card not shown on the road'));
      await settle(1500);
      await byTestId('rajaa-road').evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
      await settle(300);
      await shot('rajaa-road');
      await fullShot('rajaa-road-full');
    }
  }

  // Going out (f1, f3, n1, n2): the board reads «العزيزية ← بغداد» and «نبّهني», never «الرجعة».
  await page.goto(`${origin}/rajaa?corridor=aziziyah_baghdad&direction=from_aziziyah`, LOADED);
  await byTestId('rajaa-board').waitFor({ timeout: 15_000 });
  await settle(1200);
  await shot('rajaa-board-out');
  await page.goto(`${origin}/rajaa/demand?corridor=aziziyah_baghdad&direction=from_aziziyah`, LOADED);
  await byTestId('rajaa-demand').waitFor({ timeout: 15_000 });
  await settle();
  await shot('rajaa-demand-out');

  // أريد أرجع: post for the coming hour → "N people waiting with you" → a driver announces → claimed.
  await page.goto(`${origin}/rajaa/demand?corridor=aziziyah_baghdad&direction=to_aziziyah`, LOADED);
  await byTestId('rajaa-demand').waitFor({ timeout: 15_000 });
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
  // y1, y2: the places as chips, there and back with a 4-hour wait, AC.
  await byTestId('req-from-aziziyah').click();
  await byTestId('req-place-najaf').click();
  await byTestId('req-trip-wait_return').click();
  await byTestId('req-wait').waitFor({ timeout: 5_000 });
  await page.locator('[data-testid="req-wait"] [aria-label="زيد واحد"]').first().click();
  await byTestId('req-ac').click();
  await shot('rajaa-request-form');
  await fullShot('rajaa-request-form-full');
  await byTestId('req-trip-two_days').click();
  await byTestId('req-return').waitFor({ timeout: 5_000 });
  await byTestId('req-return').scrollIntoViewIfNeeded();
  await shot('rajaa-request-form-two-days');
  await byTestId('req-trip-wait_return').click();
  await byTestId('rajaa-request-submit').click();
  await page.locator('[data-testid^="request-"]').first().waitFor({ timeout: 15_000 });
  await byTestId('rajaa-req-seen').waitFor({ timeout: 10_000 });
  await shot('rajaa-request-waiting');
  if (personId) {
    await demoPost(`/demo/rajaa/offers?personId=${encodeURIComponent(personId)}`);
    await demoPost(`/demo/rajaa/topup?personId=${encodeURIComponent(personId)}&amount=25000`);
    // y4–y6: seen count, sort, rich cards with the winners named.
    await byTestId('offer-sort-best').waitFor({ timeout: 20_000 });
    await fullShot('rajaa-request-offers-full');
    await byTestId('offer-sort-cheapest').click();
    await shot('rajaa-request-offers-cheapest');
    await byTestId('offer-sort-best').click();
    // The pick button (offer-<id>) of the top card, not the driver row, price or card inside it.
    const offer = page.locator('[data-testid^="offer-"]:not([data-testid^="offer-driver-"]):not([data-testid^="offer-price-"]):not([data-testid^="offer-card-"]):not([data-testid^="offer-record-"]):not([data-testid^="offer-win-"]):not([data-testid^="offer-miss-"]):not([data-testid^="offer-sort-"])').first();
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

/** The الرجعة driver's record (x12–x17): tile, seat sheet, «ملفه», and the one-line review. */
async function driverShots(personId) {
  if (personId) await demoPost(`/demo/rajaa/rode?personId=${encodeURIComponent(personId)}`);
  await page.goto(`${origin}/rajaa`, LOADED);
  const firstCar = page.locator('[data-testid="garage-mp_garage_nahdha"] [data-testid^="departure-"]').first();
  await firstCar.waitFor({ timeout: 15_000 });
  await settle(1200);
  await shot('driver-board');

  await firstCar.click();
  await byTestId('rajaa-departure-driver-record').waitFor({ timeout: 15_000 }).catch(() => errors.push('driver record not shown on the seat screen'));
  await byTestId('rajaa-departure-driver-record').scrollIntoViewIfNeeded().catch(() => {});
  await settle();
  await shot('driver-seat-record');

  await byTestId('rajaa-departure-driver-record-open').click();
  await byTestId('driver-profile').waitFor({ timeout: 15_000 });
  await settle(1200);
  await shot('driver-profile');
  await fullShot('driver-profile-full');

  // A new driver (أحمد, the تاهو: no trips yet): «جديد» instead of a rating, no bars, no reviews yet.
  await page.goto(`${origin}/rajaa`, LOADED);
  await page.locator('[data-testid="garage-mp_garage_nahdha"] [data-testid^="departure-dep_"]').first().waitFor({ timeout: 15_000 });
  const tiles = await page.locator('[data-testid="garage-mp_garage_nahdha"] [data-testid^="departure-dep_"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  const newId = tiles[2]?.replace(/^departure-/, '');
  await page.goto(`${origin}/rajaa/driver/${newId}`, LOADED);
  await byTestId('driver-profile-qualities-wait').waitFor({ timeout: 15_000 }).catch(() => errors.push('new driver profile not shown'));
  await settle();
  await fullShot('driver-profile-new');

  if (!personId) return;
  const trip = await demoPost(`/demo/rajaa/arrived?personId=${encodeURIComponent(personId)}`);
  await page.goto(`${origin}/rajaa/pass/${trip.bookingId}`, LOADED);
  await byTestId('rajaa-safe-arrival').waitFor({ timeout: 15_000 });
  // a2, a4: home by tuktuk and the next trip (with its cars) come first, before the rating.
  await settle(1500);
  await fullShot('driver-arrival-full');
  await byTestId('rate-star-5').click();
  await page.locator('[data-testid="rajaa-review-input"]').fill('رقمه 07701234567 اذا تحتاجونه');
  await byTestId('rajaa-review-input').scrollIntoViewIfNeeded();
  await settle();
  await shot('driver-review-refused');
  await page.locator('[data-testid="rajaa-review-input"]').fill('سايق محترم ووصلنا قبل الوقت');
  await settle();
  await shot('driver-review-typed');
  await byTestId('rajaa-rate-send').click();
  await byTestId('rajaa-safe-review').waitFor({ timeout: 15_000 }).catch(() => errors.push('sent review not shown'));
  await byTestId('rajaa-safe-review').scrollIntoViewIfNeeded().catch(() => {});
  await settle();
  await shot('driver-review-sent');
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
  await byTestId('cart-bar').click();
  await byTestId('cart-price-total').waitFor({ timeout: 15_000 });
  await byTestId('cart-deal-saving').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(3800); // let the last "added" toast go
  await shot('deals-cart');
  await fullShot('deals-cart-full');

  await byTestId('cart-checkout').click();
  await byTestId('checkout-price-total').waitFor({ timeout: 15_000 });
  await page.evaluate(() => {
    // Scroll to the price breakdown so the deal line is in view.
    for (const el of document.querySelectorAll('*')) {
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
/** The root crash screen: `?crash=1` throws one render error (dev tools only); the retry mounts home again. */
async function crashShots() {
  const before = errors.length;
  await page.goto(`${origin}/?crash=1`, LOADED);
  await byTestId('crash-screen').waitFor({ timeout: 15_000 });
  await shot('crash-screen');
  await byTestId('crash-screen-state-retry').click();
  const back = await byTestId('home').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false);
  // The demo crash logs itself on purpose (React's caught-error report): not a failure.
  errors.splice(before);
  if (!back) errors.push('crash retry did not bring home back');
  await shot('crash-retried');
}

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

  // Voice notes (ride ideas n7/n8) in the ride's chat: the driver's note, then he holds the mic.
  // The fake microphone counts as already allowed; report "not asked yet" so the first hold shows our
  // explanation, as on a first visit (the browser's own prompt then answers yes).
  await page.addInitScript(() => {
    const perms = globalThis.navigator.permissions;
    const query = perms.query.bind(perms);
    perms.query = (d) => (d?.name === 'microphone' ? Promise.resolve({ state: 'prompt' }) : query(d));
  });
  await page.goto(`${origin}/chat/${r.orderId}?kind=customer_courier`, LOADED);
  await byTestId('chat-msg-2').waitFor({ timeout: 15_000 });
  await shot('chat-voice-thread');
  const mic = await byTestId('chat-mic').boundingBox();
  if (!mic) throw new Error('chat-mic not on screen');
  const [mx, my] = [mic.x + mic.width / 2, mic.y + mic.height / 2];
  // The first hold explains before the browser asks.
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.up();
  await byTestId('chat-mic-prompt').waitFor({ timeout: 10_000 });
  await shot('chat-voice-mic-prompt');
  await page.getByText('اسمح بالمايك').click();
  await byTestId('chat-mic-prompt').waitFor({ state: 'hidden', timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await byTestId('chat-voice-recording').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(3200);
  // Half way to the cancel line (towards the right in Arabic): the hint follows the finger.
  await page.mouse.move(mx + 40, my, { steps: 4 });
  await shot('chat-voice-recording');
  await page.mouse.move(mx, my, { steps: 4 });
  await page.mouse.up();
  // His note goes up and the demo driver answers with one 2.5 s later.
  await byTestId('chat-msg-3').waitFor({ timeout: 20_000 });
  await byTestId('chat-msg-4').waitFor({ timeout: 20_000 });
  await shot('chat-voice-sent');
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
  await byTestId('cart-bar').click();
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
  // Offers are held, and a nudged driver doesn't answer either, so the searching and cancel shots stay put.
  await demoPost('/demo/ride?acceptMs=0&nudgeAcceptMs=0');
  await page.goto(`${origin}/`, LOADED);
  await byTestId('service-taxi').waitFor({ timeout: 15_000 });
  await byTestId('service-taxi').scrollIntoViewIfNeeded();
  await shot('ride-home');

  await byTestId('service-taxi').click();
  await byTestId('ride-where').waitFor({ timeout: 15_000 });
  await page.locator('[data-testid^="ride-spot-landmark:"]').first().waitFor({ timeout: 15_000 });
  // Ride ideas w1–w8: the live map with the free cars, the smart picks with their prices.
  await byTestId('ride-where-map').waitFor({ timeout: 15_000 });
  await page.locator('[data-testid="nearby-vehicle"]').first().waitFor({ timeout: 15_000 }).catch(() => errors.push('no free cars on the where-to map'));
  await settle(1200);
  await shot('ride-where');
  await fullShot('ride-where-full');
  await byTestId('ride-zones-toggle').click();
  await byTestId('ride-zones').waitFor();
  await byTestId('ride-zones-toggle').scrollIntoViewIfNeeded();
  await shot('ride-where-zones');
  await byTestId('ride-zones-toggle').click();
  await byTestId('ride-pickup').click();
  await byTestId('ride-my-location').waitFor();
  await page.mouse.click(5, 5);
  await settle(400);
  await shot('ride-where-pickup');
  await byTestId('ride-dropoff').click();
  // w7: a restaurant by name.
  await page.locator('[data-testid="ride-dropoff-input"]').fill('خالد');
  await page.locator('[data-testid="ride-results"]').waitFor();
  await settle(500);
  await shot('ride-search-shop');
  await page.locator('[data-testid="ride-dropoff-input"]').fill('');

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
  // x1: a July afternoon on the server's clock — «اليوم حار، نبعثلك سيارة مكيّفة» under the car.
  await nightShot('/', 'ride-choose-hot', 'ride-climate-hot', {
    at: Date.UTC(2026, 6, 14, 11),
    act: async (p) => {
      await p.locator('[data-testid="service-taxi"]').click({ timeout: 15_000 });
      await p.locator('[data-testid^="ride-spot-landmark:"]').first().click({ timeout: 15_000 });
      await p.locator('[data-testid="ride-price-taxi"]').waitFor({ timeout: 15_000 });
    },
  });

  await byTestId('ride-details-taxi').click();
  await byTestId('ride-fare-panel').waitFor();
  await settle(500);
  await shot('ride-fare');
  await byTestId('ride-fare-close').click();
  await byTestId('ride-fare-panel').waitFor({ state: 'detached' });

  // The options row opens its sheet: door pickup with its price difference.
  await byTestId('ride-options').click();
  await byTestId('ride-options-panel').waitFor();
  await page.getByText('تعال للباب', { exact: false }).last().click();
  await page.waitForTimeout(600);
  await byTestId('ride-pickup-hint').scrollIntoViewIfNeeded();
  await shot('ride-door');
  await page.getByText('أطلع للشارع', { exact: true }).last().click();
  await byTestId('ride-options-done').click();
  await byTestId('ride-options-panel').waitFor({ state: 'detached' });

  // An edge zone: the tuktuk is off, with the reason and "try anyway".
  await byTestId('ride-edit-route').click();
  await byTestId('ride-where').waitFor({ timeout: 15_000 });
  await byTestId('ride-dropoff').click();
  await byTestId('ride-zones-toggle').click();
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
  await byTestId('ride-options').click();
  // p4: the note from two quick chips.
  await byTestId('ride-note-chip-0').click();
  await byTestId('ride-note-chip-1').click();
  await settle(400);
  await shot('ride-options');
  // s6: «سايق للعوائل» in the same panel (switched back off, so this tuktuk goes to everyone).
  await byTestId('ride-family').scrollIntoViewIfNeeded();
  await byTestId('ride-family').click();
  await settle(400);
  await shot('ride-family');
  await byTestId('ride-family').click();
  // x5 «عندي غراض»: bags and a gas cylinder; with the car chosen the tuktuk row says it fits best.
  await byTestId('ride-cargo').scrollIntoViewIfNeeded();
  await byTestId('chip-bags').click();
  await byTestId('chip-gas').click();
  await settle(400);
  await shot('ride-cargo');
  await byTestId('ride-options-done').click();
  await byTestId('ride-options-panel').waitFor({ state: 'detached' });
  await byTestId('ride-vehicle-taxi').click();
  await byTestId('ride-fit-tuktuk').waitFor({ timeout: 10_000 }).catch(() => errors.push('tuktuk cargo hint not shown'));
  await settle(600);
  await shot('ride-cargo-hint');
  await byTestId('ride-vehicle-tuktuk').click();
  await byTestId('ride-options').click();
  await byTestId('ride-cargo').scrollIntoViewIfNeeded();
  await byTestId('chip-bags').click();
  await byTestId('chip-gas').click();
  await byTestId('ride-options-done').click();
  await byTestId('ride-options-panel').waitFor({ state: 'detached' });
  await settle(600);
  await shot('ride-choose-tuktuk');
  await byTestId('ride-request').click();
  await page.waitForURL(/\/order\//, { timeout: 15_000 });
  const orderId = new URL(page.url()).pathname.split('/').pop();
  await byTestId('ride-search-counter').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(4200);
  await shot('ride-searching');
  // n3/n4: the drivers who were sent it, «نبّهه» on the first; n5 his profile on tap.
  const nudge = page.locator('[data-testid^="ride-nudge-"]').first();
  if (await nudge.waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
    await nudge.click();
    await page.locator('[data-testid^="ride-nudged-"]').first().waitFor({ timeout: 10_000 }).catch(() => errors.push('nudge not confirmed'));
    await settle(600);
    await shot('ride-nudged');
    await page.locator('[data-testid^="ride-offer-open-"]').first().click();
    await byTestId('driver-profile-body').waitFor({ timeout: 15_000 }).catch(() => errors.push('driver profile not shown'));
    await settle(700);
    await shot('ride-profile');
    await page.keyboard.press('Escape');
    await byTestId('driver-profile').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
  } else errors.push('offered drivers not shown while searching');
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
  // m5: nobody accepted by the free-cancel time — on a second tab whose city config says that time is
  // 6 s (the app's clock follows the server's, so a faked browser clock would not move it).
  if (wanted('ride-no-driver')) {
    const ctx = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'ar-IQ' });
    const soon = (node) => {
      if (Array.isArray(node)) node.forEach(soon);
      else if (node && typeof node === 'object') {
        if ('customerFreeCancelAfterSec' in node) node.customerFreeCancelAfterSec = 6;
        Object.values(node).forEach(soon);
      }
    };
    await ctx.route(/\/trpc\/[^?]*config\.city/, async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      soon(body);
      await route.fulfill({ response: res, json: body });
    });
    const later = await ctx.newPage();
    await later.goto(`${origin}/order/${orderId}`, LOADED);
    const offer = later.locator('[data-testid="ride-switch-offer"]').first();
    if (await offer.waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
      await later.locator('[data-testid="ride-switch-body"]').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await later.waitForTimeout(1200);
      const file = join(outDir, 'ride-no-driver.png');
      await later.screenshot({ path: file });
      console.log(file);
    } else errors.push('no-driver offer not shown');
    await ctx.close();
  }

  // The nearest tuktuk accepts and drives over. Between two waves no offer is open (and a held offer
  // can run out while the shots above are taken), so wait for the next one to ring.
  let ok = null;
  const held = await demoPost(`/demo/ride/nudges?orderId=${orderId}`);
  console.log('offers before accept:', JSON.stringify(held?.offers?.map((o) => [o.name, o.state]) ?? null), 'searching:', held?.searching);
  for (let i = 0; i < 40 && !ok; i++) {
    const r = await fetch(`${apiBase}/demo/ride/accept?orderId=${orderId}`, { method: 'POST' });
    if (r.ok) ok = await r.json().catch(() => ({}));
    else if (r.status === 409) await page.waitForTimeout(1000);
    else return void errors.push(`/demo/ride/accept: ${r.status} ${await r.text()}`);
  }
  if (!ok) return void errors.push(`/demo/ride/accept?orderId=${orderId}: no offer rang within 40 s`);
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('courier-marker').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(4500);
  await shot('ride-matched');
  await page.goto(`${origin}/order/${orderId}?sheet=1`, LOADED);
  await byTestId('courier-card').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await shot('ride-matched-expanded');
  // d3 a minute away (with d4's light at night), d4 the screen light, t3 the safety shield.
  await nightShot(`/order/${orderId}`, 'ride-near', 'ride-near', { etaInSec: 45 });
  await nightShot(`/order/${orderId}`, 'ride-light', 'ride-light', {
    etaInSec: 45,
    act: async (p) => {
      await p.locator('[data-testid="ride-light-button"]').first().click({ timeout: 15_000 });
    },
  });
  await byTestId('safety-shield').click();
  await byTestId('safety-sheet').waitFor({ timeout: 10_000 }).catch(() => errors.push('safety sheet not shown'));
  await settle(700);
  await shot('ride-shield');
  await page.keyboard.press('Escape');

  await demoPost(`/demo/ride/advance?orderId=${orderId}`);
  await page.goto(`${origin}/order/${orderId}?sheet=1`, LOADED);
  await byTestId('ride-wait-note').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await shot('ride-at-pickup');
  // d5: the arrived card in the tuktuk's colour with the free-wait ring (and d4's light at night).
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('driver-here').waitFor({ timeout: 15_000 }).catch(() => errors.push('driver-here card not shown'));
  await page.waitForTimeout(1500);
  await shot('ride-driver-here');
  await nightShot(`/order/${orderId}`, 'ride-driver-here-night', 'driver-here-ring');

  // Ride step 3 (s1): the same ride as if placed at night — «رمز المشوار» on the arrived card, and in the
  // collapsed sheet once that card is closed.
  await demoPost(`/demo/ride/night?orderId=${orderId}`);
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('driver-here').waitFor({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  await shot('ride-driver-here-code');
  await byTestId('driver-here-close').click().catch(() => errors.push('arrived card would not close'));
  if (await byTestId('ride-trip-code').waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
    await page.waitForTimeout(1500);
    await shot('ride-trip-code');
  } else errors.push('trip code not shown on a night ride');

  await demoPost(`/demo/ride/advance?orderId=${orderId}`);
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('courier-marker').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(5000);
  await shot('ride-on-trip');
  // t1 the trip line in the collapsed sheet; t2 the night share card up front.
  await byTestId('ride-trip-progress').waitFor({ timeout: 10_000 }).catch(() => errors.push('trip progress not shown'));
  await nightShot(`/order/${orderId}?sheet=1`, 'ride-night-share', 'ride-night-share');
  await page.goto(`${origin}/order/${orderId}?sheet=2`, LOADED);
  await byTestId('sheet-body').waitFor({ timeout: 15_000 });
  await page.locator('[data-testid="sheet-body"]').evaluate((el) => el.scrollBy(0, 2000));
  await page.waitForTimeout(1200);
  await shot('ride-on-trip-actions');

  // Leave the order screen first: an open screen would see the arrival live and play it there (once
  // per order), and the reload below would then open on the calm receipt.
  await page.goto(`${origin}/`, LOADED);
  await demoPost(`/demo/ride/advance?orderId=${orderId}`);
  // g2: show this ride as his 10th, so the arrival offers its sticker (the demo rider has one ride).
  const asTenth = async (route) => {
    const res = await route.fetch();
    const patch = (v) => {
      if (Array.isArray(v)) return v.forEach(patch);
      if (!v || typeof v !== 'object') return;
      if ('tuktukOrderId' in v && 'rideMilestone' in v) {
        v.rideMilestone = { orderId, count: 10 };
        // His 10th ride can't also be his first tuktuk: that moment would win over the sticker.
        if (v.tuktukOrderId === orderId) v.tuktukOrderId = null;
      }
      Object.values(v).forEach(patch);
    };
    const body = await res.json().catch(() => null);
    if (body === null) return route.fulfill({ response: res });
    patch(body);
    await route.fulfill({ response: res, json: body });
  };
  await page.route('**/trpc/*orders.firsts*', asTenth);
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('arrival').waitFor({ timeout: 15_000 });
  await byTestId('ride-sticker-milestone').waitFor({ timeout: 10_000 }).catch(() => errors.push('ride sticker not shown'));
  await page.waitForTimeout(1200);
  await shot('ride-arrived');
  await page.unroute('**/trpc/*orders.firsts*', asTenth);
  await byTestId('arrival-rate').click();
  await byTestId('stars-delivery').waitFor();
  await settle(500);
  await shot('ride-rating');

  // w2 / a3: after a ride, «تحب تسمّي هالمكان؟» on the receipt, and the place among the smart picks.
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('ride-name-place').waitFor({ timeout: 15_000 }).catch(() => errors.push('name-this-place not shown'));
  await byTestId('ride-name-place').scrollIntoViewIfNeeded().catch(() => undefined);
  await shot('ride-receipt-name');
  // s7 «نسيت غرض» and s5 «ما أريده مرة ثانية» among the receipt's actions.
  await page.goto(`${origin}/order/${orderId}?sheet=2`, LOADED);
  await byTestId('action-lost-item').waitFor({ timeout: 15_000 }).catch(() => errors.push('lost-item row not shown'));
  await byTestId('action-lost-item').scrollIntoViewIfNeeded().catch(() => undefined);
  await settle(500);
  await shot('ride-receipt-actions');
  await byTestId('action-avoid').click();
  await byTestId('avoid-sheet').waitFor({ timeout: 10_000 }).catch(() => errors.push('avoid sheet not shown'));
  await settle(600);
  await shot('ride-avoid');
  await byTestId('avoid-cancel').click();
  await byTestId('action-lost-item').click();
  await page.waitForURL(/\/chat\//, { timeout: 15_000 }).catch(() => errors.push('lost item did not open the chat'));
  await settle(1200);
  await shot('ride-lost-item-chat');
  await page.goto(`${origin}/ride`, LOADED);
  await byTestId('ride-picks').waitFor({ timeout: 15_000 }).catch(() => errors.push('smart picks not shown after a ride'));
  await page.locator('[data-testid="ride-pick-price-0"]').waitFor({ timeout: 15_000 }).catch(() => errors.push('smart pick prices not shown'));
  await settle(900);
  await shot('ride-where-picks');
}

/**
 * Ride ideas c9/s3 «لمنو المشوار؟»: the row on the choose screen («إلي»), its sheet (ماما booked for
 * before, two trusted people, «شخص ثاني»), a typed name with a wrong then a right number, the row «لـ
 * خالتي»; then the booker's live screen for her ride, its end («مشوار خالتي وصل بالسلامة») and the
 * history row «لـ خالتي». The ride is driven to the end, so nothing is left running.
 */
async function rideForShots() {
  const personId = await page.evaluate(() => JSON.parse(localStorage.getItem('driver.customer.session') ?? '{}').personId ?? null);
  if (!personId || !(await demoPost(`/demo/ride-for?personId=${encodeURIComponent(personId)}`))) return;
  await page.goto(`${origin}/`, LOADED);
  await byTestId('service-taxi').click({ timeout: 15_000 });
  await byTestId('ride-where').waitFor({ timeout: 15_000 });
  await byTestId('ride-dropoff').click();
  await page.locator('[data-testid="ride-dropoff-input"]').fill('الشاشه');
  await page.locator('[data-testid="ride-results"]').waitFor();
  await page.locator('[data-testid="ride-results"] [data-testid^="ride-spot-"]').first().click();
  await byTestId('ride-choose').waitFor({ timeout: 15_000 });
  await byTestId('ride-price-taxi').waitFor({ timeout: 15_000 });
  await byTestId('ride-rider').waitFor({ timeout: 10_000 });
  await settle(900);
  await shot('ride-for-choose');

  await byTestId('ride-rider').click();
  await byTestId('ride-rider-sheet').waitFor();
  await byTestId('chip-trusted:0').waitFor({ timeout: 10_000 }).catch(() => errors.push('trusted people not offered for a ride'));
  await settle(600);
  await shot('ride-for-sheet');
  await byTestId('chip-other').click();
  await page.locator('[data-testid="ride-rider-name"]').fill('خالتي');
  await page.locator('[data-testid="ride-rider-phone"]').fill('0771 234');
  await byTestId('ride-rider-done').click();
  await settle(500);
  await shot('ride-for-typed-error');
  await page.locator('[data-testid="ride-rider-phone"]').fill('0771 234 5678');
  await settle(400);
  await shot('ride-for-typed');
  await byTestId('ride-rider-done').click();
  await byTestId('ride-rider-sheet').waitFor({ state: 'detached' });
  await settle(600);
  await shot('ride-for-row');

  await byTestId('ride-request').click();
  await page.waitForURL(/\/order\//, { timeout: 15_000 });
  const orderId = new URL(page.url()).pathname.split('/').pop();
  await page.waitForTimeout(2500);
  await shot('ride-for-searching');
  if (!(await demoPost(`/demo/ride/accept?orderId=${orderId}`))) return;
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('courier-marker').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(4500);
  await shot('ride-for-live');
  await page.goto(`${origin}/order/${orderId}?sheet=1`, LOADED);
  await byTestId('ride-follow').waitFor({ timeout: 15_000 }).catch(() => errors.push('follow card not shown on a ride for someone else'));
  await page.waitForTimeout(2000);
  await shot('ride-for-live-expanded');

  // To the end, away from the order screen; the arrival plays when he opens it.
  await page.goto(`${origin}/`, LOADED);
  for (let i = 0; i < 3; i++) await demoPost(`/demo/ride/advance?orderId=${orderId}`);
  await page.goto(`${origin}/order/${orderId}`, LOADED);
  await byTestId('arrival').waitFor({ timeout: 15_000 }).catch(() => errors.push('arrival not shown for a ride for someone else'));
  await page.waitForTimeout(1500);
  await shot('ride-for-arrived');
  await page.goto(`${origin}/orders`, LOADED);
  await byTestId(`order-${orderId}`).waitFor({ timeout: 15_000 }).catch(() => errors.push('ride for someone else not in history'));
  await settle(700);
  await shot('ride-for-history');
}

/**
 * Ride ideas d3/d4/t2: a second tab that lives at night. Every date the API sends moves by the same
 * amount, so the app's server-corrected clock reads 22:30 in Baghdad while every countdown keeps its
 * real length (unless it already is night). `etaInSec` pins the driver's ETA that far ahead of that
 * clock (the "a minute away" card). Shoots `name` once `testID` shows; `act` runs first on the page.
 * `at` (epoch ms) moves the server's clock to that instant instead (x1: a July afternoon).
 */
async function nightShot(path, name, testID, { etaInSec = null, act = null, at = null } = {}) {
  if (!wanted(name)) return;
  const now = Date.now();
  const bagh = new Date(now + 3 * 3_600_000);
  const h = bagh.getUTCHours();
  const night = h >= 21 || h < 6;
  const target = Date.UTC(bagh.getUTCFullYear(), bagh.getUTCMonth(), bagh.getUTCDate(), 19, 30);
  const shift = at !== null ? at - now : night ? 0 : target - now;
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  const move = (node) => {
    if (Array.isArray(node)) return node.map(move);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'etaAt' && etaInSec !== null && typeof v === 'string') node[k] = new Date(Date.now() + shift + etaInSec * 1000).toISOString();
        else node[k] = move(v);
      }
      return node;
    }
    return typeof node === 'string' && iso.test(node) ? new Date(new Date(node).getTime() + shift).toISOString() : node;
  };
  const ctx = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: W, height: H }, deviceScaleFactor: 2, locale: 'ar-IQ' });
  await ctx.route(/\/trpc\//, async (route) => {
    // Live subscriptions stream; the next read of the order carries the moved dates anyway.
    if ((route.request().headers().accept ?? '').includes('event-stream')) return route.continue();
    const res = await route.fetch().catch(() => null);
    if (!res) return route.abort().catch(() => undefined);
    const type = res.headers()['content-type'] ?? '';
    if (!type.includes('json')) return route.fulfill({ response: res });
    await route.fulfill({ response: res, json: move(await res.json()) });
  });
  const night_ = await ctx.newPage();
  try {
    await night_.goto(`${origin}${path}`, LOADED);
    if (act) await act(night_);
    await night_.locator(`[data-testid="${testID}"]`).first().waitFor({ timeout: 15_000 });
    await night_.waitForTimeout(1500);
    const file = join(outDir, `${name}.png`);
    await night_.screenshot({ path: file });
    console.log(file);
  } catch (err) {
    errors.push(`${name}: ${err?.message ?? err}`);
  }
  await ctx.unrouteAll({ behavior: 'ignoreErrors' });
  await ctx.close();
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
  await byTestId('cart-bar').click();
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
