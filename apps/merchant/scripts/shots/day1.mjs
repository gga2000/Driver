// Day-one fixes (d01–d10, the merchant day-one walk-through): the same moments the audit shot, so one
// list gives a before/after pair on either build. Steps the other build lacks are skipped.
//   d08 sign-in hint and a wrong number · d09 the lesson while orders wait, then at the first quiet
//   moment · d01/d04/d05/d06 the board in a rush (day card, header, «#7477», «اقبل · 20 دقيقة») ·
//   d03 cooking tickets, the order sheet, the cash sheet · d01 quiet and closed · d10 not-found and a
//   slow start · d02 no internet while changing tab, and the net coming back · d07 paused for customers.
// The second batch (d11–d23) is `later()` below. `DAY1=first|later` runs one batch (default both).
// Seeded by scripts/demo/board.mjs. `SHOTS=day1 node scripts/web-shots.mjs <out>`.
export default {
  name: 'day1',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const only = process.env.DAY1 ?? 'all';
    if (only === 'all' || only === 'first') await first(h);
    if (only === 'all' || only === 'later') await later(h);
  },
};

async function first(h) {
    const { page, byTestId, shot, demoPost, signIn, startShift, goto, viewport, apiBase, origin } = h;
    const phone = viewport === 'phone';
    const visible = async (id) => byTestId(id).isVisible().catch(() => false);
    const appear = (id, timeout = 4000) => byTestId(id).waitFor({ timeout }).then(() => true, () => false);
    const escape = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    };
    /** Answers every waiting order at the usual time (the ribbon / sticky bar / ticket buttons). */
    const acceptAll = async () => {
      for (let i = 0; i < 20; i++) {
        const btn = page.locator('[data-testid="sticky-accept-now"]:visible, [data-testid="ribbon-accept"]:visible, [data-testid^="accept-"]:not([data-testid^="accept-more"]):not([data-testid^="accept-all"]):visible').first();
        if (!(await btn.count())) break;
        await btn.click().catch(() => undefined);
        await page.waitForTimeout(900);
      }
    };
    const reload = async () => {
      await page.reload({ waitUntil: 'load' });
      await byTestId('board').waitFor({ timeout: 20_000 });
      await startShift();
    };

    // ── d08: sign-in ──
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${origin}/welcome`, { waitUntil: 'load' });
    await byTestId('welcome-start').waitFor({ timeout: 20_000 });
    await byTestId('welcome-start').click();
    await byTestId('phone-input').waitFor();
    await shot('signin-empty');
    await page.locator('[data-testid="phone-input"]').fill('0123 456 789');
    await page.locator('[data-testid="phone-input"]').blur();
    await shot('signin-bad');

    // ── d09: the lesson while three orders ring ──
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/printer?state=disconnected');
    await demoPost('/demo/board/missed?count=2');
    await demoPost('/demo/board/rush?count=3');
    await signIn('0770 123 4567', { lesson: true });
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await shot('lesson-ringing', { wait: 1500 });
    if (await visible('learn-cards')) await byTestId('learn-done').click();
    else await startShift();
    await page.waitForTimeout(1200);

    // Answer them: the first quiet moment (the lesson comes now on the new build).
    await acceptAll();
    if (await appear('learn-cards', 6000)) {
      await shot('lesson-quiet', { wait: 6000 });
      await byTestId('learn-done').click();
    }
    // ── d01: quiet board (no waiting order) ──
    await page.waitForTimeout(4500);
    await shot('quiet', { wait: 6000 });

    // ── d01 · d04 · d05 · d06: ten orders at once ──
    await demoPost('/demo/board/rush?count=10');
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    await shot('rush-10', { wait: 800 });

    // The header's "…" (d04).
    if (await visible('header-more')) {
      await byTestId('header-more').click();
      await byTestId('header-menu').waitFor();
      await shot('header-menu', { wait: 700 });
      await escape();
    }
    // The accept sheet's title (d05).
    const more = page.locator('[data-testid^="accept-more-"]:visible').first();
    if (await more.count()) {
      await more.click();
      await byTestId('accept-sheet').waitFor({ timeout: 5000 }).catch(() => undefined);
      await shot('accept-sheet', { wait: 700 });
      await escape();
    }

    // ── d03: cooking tickets and the order sheet ──
    if (phone) await byTestId('segment-preparing').click();
    await page.waitForTimeout(800);
    await shot('cooking', { wait: 600 });
    // The cooking ticket's own buttons («التفاصيل» used to break into «التفاصي / ل»).
    const readyBtn = page.locator('[data-testid^="ready-"]:visible').first();
    if (await readyBtn.count()) {
      await readyBtn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await shot('cooking-buttons', { wait: 700 });
    }
    const details = page.locator('[data-testid^="details-"]:visible').first();
    if (await details.count()) await details.click();
    else await page.getByText('التفاصيل', { exact: true }).first().click().catch(() => undefined);
    if (await appear('order-detail', 5000)) {
      await page.locator('[data-testid="order-detail"] div').evaluateAll((els) => els.forEach((e) => (e.scrollTop = 9999)));
      await shot('detail-cooking', { wait: 800 });
      await escape();
    }
    if (phone) await byTestId('segment-new').click();
    // The cash sheet over the board (tablet: the day card's net was cut to «250,447 دي...»).
    if (await visible('request-money')) await byTestId('request-money').click();
    else if (await visible('header-more')) {
      await byTestId('header-more').click();
      await byTestId('header-menu').waitFor();
      if (await visible('request-money')) await byTestId('request-money').click();
    }
    if (await appear('cash-sheet', 4000)) {
      await shot('cash-sheet', { wait: 800 });
      await escape();
    } else await escape();

    // ── d01: closed shop ──
    await demoPost('/demo/board/store?open=0');
    await page.waitForTimeout(7000);
    await shot('closed', { wait: 800 });
    await demoPost('/demo/board/store?open=1&busy=0');

    // ── d10: a page that doesn't exist ──
    await goto('/no-such-page');
    await page.waitForTimeout(1200);
    await shot('not-found', { wait: 600 });
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await byTestId('board').waitFor({ timeout: 20_000 });
    await startShift();

    // ── d02: no internet, then a tab change ──
    await page.waitForTimeout(2500);
    await page.context().setOffline(true);
    await page.waitForTimeout(1500);
    await byTestId(phone ? 'tab-money' : 'nav-money').click().catch(() => undefined);
    await page.waitForTimeout(3000);
    await shot('offline-tab', { wait: 600 });
    await byTestId(phone ? 'tab-orders' : 'nav-orders').click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    await shot('offline-board', { wait: 600 });
    await page.context().setOffline(false);
    await page.waitForTimeout(9000);
    await byTestId(phone ? 'tab-money' : 'nav-money').click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(4000);
    await shot('back-online', { wait: 600 });
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await byTestId('board').waitFor({ timeout: 20_000 });
    await startShift();

    // ── d10: a slow start (every answer 5 s late) ──
    await page.route(`${apiBase}/trpc/**`, async (r) => {
      await new Promise((res) => setTimeout(res, 5000));
      await r.continue().catch(() => undefined);
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(3200);
    await shot('slow-start', { wait: 100 });
    await page.unroute(`${apiBase}/trpc/**`);
    await byTestId('board').waitFor({ timeout: 30_000 });
    await startShift();

    // ── d07: paused for customers (offline 7 minutes on a fake clock), with orders waiting ──
    await demoPost('/demo/board/rush?count=3');
    await page.clock.install();
    await reload();
    await page.waitForTimeout(2000);
    await page.route(`${apiBase}/trpc/**`, (r) => r.abort('internetdisconnected'));
    await page.clock.fastForward('02:00');
    await page.clock.fastForward('05:00');
    await byTestId('paused-strip').waitFor({ timeout: 20_000 }).catch(() => undefined);
    await shot('paused-now', { wait: 800 });
    await page.unroute(`${apiBase}/trpc/**`);
}

/**
 * d11–d23 (the rest of the day-one walk-through), on either build:
 *   d14 the setup preview's gaps · d13 the setup words and prices · d12 a new shop's money · d20 a new
 *   shop's «يومك» · d15 one switch (printer, settings) · d16 staff phones · d17 «منو سوّى شنو» and the
 *   remake sheet · d18 «وقتك مضبوط» · d19 the week in sentences · d21 a dish without a photo · d22 the
 *   cooking ticket · d23 the chat on a tablet · d11 «حدّث التطبيق» (last: it changes the build header).
 * The new shop is scripts/demo/setup.mjs (owner 0770 777 0001); the rest is مطعم خالد.
 */
async function later(h) {
  const { page, shot, demoPost, signIn, startShift, goto, viewport, origin } = h;
  const phone = viewport === 'phone';
  const visible = (id) => page.locator(`[data-testid="${id}"]:visible`).first();
  const appear = (id, timeout = 6000) => visible(id).waitFor({ timeout }).then(() => true, () => false);
  /** One step; a step the other build lacks is skipped, never the whole list. */
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (err) {
      console.log(`[day1 ${viewport}] ${name} skipped: ${String(err?.message ?? err).split('\n')[0]}`);
      if (process.env.DAY1_DEBUG) await shot(`zz-${name.replace(/\W+/g, '-')}-skipped`, { wait: 100 }).catch(() => undefined);
      await page.keyboard.press('Escape').catch(() => undefined);
    }
  };
  /** The board, fresh: the shift gate and the lesson (it comes back at the first quiet moment) out of the way. */
  const board = async () => {
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await visible('board').waitFor({ timeout: 20_000 });
    await startShift();
    if (await appear('learn-cards', 3000)) await visible('learn-done').click();
    await page.waitForTimeout(500);
  };
  const open = async (path, id) => {
    await page.goto(`${origin}${path}`, { waitUntil: 'load' });
    await visible(id).waitFor({ timeout: 20_000 });
  };

  // ── the new shop (setup) ──
  await demoPost('/demo/setup/stage?to=fresh');
  await signIn('0770 777 0001');
  await step('d14 preview', async () => {
    if (await appear('setup-welcome', 15_000)) await visible('setup-welcome-go').click();
    await visible('setup-preview').waitFor({ timeout: 15_000 });
    await shot('d14-preview', { wait: 1500 });
  });
  await step('d13 steps', async () => {
    await visible('setup-steps').scrollIntoViewIfNeeded();
    await shot('d13-steps', { element: visible('setup-steps'), wait: 600 });
  });
  await step('d13 cards', async () => {
    await goto('/setup/menu');
    await visible('setup-card-ok').waitFor({ timeout: 15_000 });
    await shot('d13-cards', { wait: 1200 });
    await visible('setup-card-fix').click();
    await visible('setup-fix').waitFor();
    await shot('d13-fix', { wait: 900 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });
  await step('d12 money', async () => {
    await open('/money', 'money');
    await page.waitForTimeout(2500);
    await shot('d12-money', { wait: 800 });
    if (await appear('cash-hero', 4000)) await shot('d12-cash', { element: visible('cash-hero'), wait: 400 });
  });
  await step('d20 numbers', async () => {
    await open('/money?tab=insights', 'money');
    await page.waitForTimeout(2500);
    await shot('d20-numbers', { wait: 800, full: true });
  });
  await demoPost('/demo/setup/stage?to=fresh');

  // ── مطعم خالد ──
  await demoPost('/demo/board/store?open=1&busy=0');
  await demoPost('/demo/shop/remake?on=0');
  await signIn('0770 123 4567');
  await step('d15 printer', async () => {
    await goto('/printer');
    await visible('printer-slip').waitFor({ timeout: 10_000 });
    await visible('printer-slip').scrollIntoViewIfNeeded();
    await shot('d15-printer', { wait: 800 });
  });
  await step('d15 settings', async () => {
    await goto('/settings');
    await visible('setting-sound').waitFor({ timeout: 10_000 });
    await shot('d15-settings', { wait: 800 });
  });
  await step('d16 staff', async () => {
    await goto('/staff');
    await visible('staff-team').waitFor({ timeout: 10_000 });
    await shot('d16-staff', { wait: 800 });
  });
  await step('d18 day', async () => {
    await open('/money', 'money');
    await visible('day-strip').waitFor({ timeout: 15_000 });
    await shot('d18-day', { wait: 1200 });
  });
  await step('d17 activity', async () => {
    await visible('activity').waitFor({ timeout: 15_000 });
    await visible('activity').scrollIntoViewIfNeeded();
    await shot('d17-activity', { element: visible('activity'), wait: 600 });
  });
  await step('d19 week', async () => {
    await open('/money?tab=statement', 'money');
    await visible('statement-bridge').waitFor({ timeout: 15_000 });
    await visible('statement-bridge').scrollIntoViewIfNeeded();
    await shot('d19-week', { wait: 800 });
    await shot('d19-week-crop', { element: visible('statement-bridge'), wait: 300 });
  });
  await step('d21 menu', async () => {
    await open('/menu', 'menu');
    await page.waitForTimeout(2000);
    // The first dish without a photo, in view.
    const bare = page.locator('[data-testid^="tray-nophoto-"]:visible, [data-testid^="dish-"]:visible').first();
    await bare.scrollIntoViewIfNeeded().catch(() => undefined);
    await shot('d21-menu', { wait: 1200 });
  });
  await step('d17 remake', async () => {
    await demoPost('/demo/shop/remake?on=1');
    await board();
    if (phone) await visible('segment-ready').click();
    const tag = page.locator('[data-testid^="remake-"][data-testid$="-action"]:visible').first();
    await tag.waitFor({ timeout: 20_000 });
    await tag.click();
    await visible('remake-sheet').waitFor();
    await shot('d17-remake', { wait: 700 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await demoPost('/demo/shop/remake?on=0');
  });
  await step('d22 cooking', async () => {
    await demoPost('/demo/board/rush?count=2');
    await board();
    for (let i = 0; i < 6; i++) {
      const btn = page.locator('[data-testid="sticky-accept-now"]:visible, [data-testid="ribbon-accept"]:visible, [data-testid^="accept-"]:not([data-testid^="accept-more"]):not([data-testid^="accept-all"]):visible').first();
      if (!(await btn.count())) break;
      await btn.click().catch(() => undefined);
      await page.waitForTimeout(900);
    }
    if (await appear('learn-cards', 2500)) await visible('learn-done').click();
    if (await appear('day-ok', 1500)) await visible('day-ok').click().catch(() => undefined);
    if (phone) await visible('segment-preparing').click();
    const tick = page.locator('[data-testid^="tick-"]:visible').first();
    await tick.waitFor({ timeout: 10_000 });
    await tick.click();
    await page.waitForTimeout(600);
    const card = page.locator('[data-testid^="order-"]:visible', { has: page.locator('[data-testid^="tick-"]') }).first();
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot('d22-cooking', { wait: 800 });
    await shot('d22-ticket', { element: card, wait: 300 });
  });
  await step('d23 chat', async () => {
    const fresh = await demoPost('/demo/chat/fresh');
    if (!fresh) return;
    await board();
    if (phone) await visible('segment-preparing').click();
    const card = visible(`order-${fresh.number}`);
    await card.waitFor({ timeout: 15_000 });
    const details = visible(`details-${fresh.number}`);
    if (await details.count()) await details.click();
    else await card.locator('[role="button"]').first().click();
    await visible('detail-contact').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(5500);
    await visible('detail-chat-courier').click();
    await visible('chat-msg-2').waitFor({ timeout: 15_000 });
    await shot('d23-chat', { wait: 1000 });
    await page.keyboard.press('Escape');
  });
  await step('d11 update', async () => {
    await page.goto(`${origin}/?demoBuild=0.0.1`, { waitUntil: 'load' });
    await visible('update-required').waitFor({ timeout: 20_000 });
    await shot('d11-update', { wait: 900 });
  });
}
