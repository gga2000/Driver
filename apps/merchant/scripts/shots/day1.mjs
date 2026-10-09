// Day-one fixes (d01–d10, the merchant day-one walk-through): the same moments the audit shot, so one
// list gives a before/after pair on either build. Steps the other build lacks are skipped.
//   d08 sign-in hint and a wrong number · d09 the lesson while orders wait, then at the first quiet
//   moment · d01/d04/d05/d06 the board in a rush (day card, header, «#7477», «اقبل · 20 دقيقة») ·
//   d03 cooking tickets, the order sheet, the cash sheet · d01 quiet and closed · d10 not-found and a
//   slow start · d02 no internet while changing tab, and the net coming back · d07 paused for customers.
// Seeded by scripts/demo/board.mjs. `SHOTS=day1 node scripts/web-shots.mjs <out>`.
export default {
  name: 'day1',
  viewports: ['tablet', 'phone'],
  async run(h) {
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
  },
};
