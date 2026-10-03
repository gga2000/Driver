// Wave 1 shots: welcome, sign-in gates, the orders board and its sheets, busy mode, receipt, cash,
// المزيد and the printer screen. Seeded by scripts/demo/board.mjs (مطعم خالد).
export default {
  name: 'board',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';

    // Signed out: welcome.
    await page.goto(`${h.origin}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${h.origin}/welcome`, { waitUntil: 'networkidle' });
    await byTestId('welcome-start').waitFor({ timeout: 20_000 });
    await shot('welcome');

    // A number with no store, then one with two stores.
    await signIn('0770 555 0000');
    await byTestId('not-activated').waitFor();
    await shot('not-activated');
    await signIn('0770 999 0000');
    await byTestId('stores').waitFor();
    await shot('stores');

    // The owner of مطعم خالد: straight to the board with fresh new orders.
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/printer?state=disconnected');
    await demoPost('/demo/board/fresh');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 });
    await shot('board', { wait: 1200 });

    // The new-order card with its 90-s ring.
    await shot('new-order', { element: page.locator('[data-testid^="order-"]').first() });

    if (phone) {
      await byTestId('segment-preparing').click();
      await shot('preparing');
      await byTestId('segment-ready').click();
      await shot('ready');
      await byTestId('segment-new').click();
    }

    // Accept sheet: prep-time choices (15 picked), then the partial-accept list.
    const firstNew = page.locator('[data-testid^="accept-"]').first();
    await firstNew.click();
    await byTestId('accept-sheet').waitFor();
    await byTestId('prep-15').click();
    await shot('accept');
    await byTestId('accept-some-missing').click();
    await page.locator('[data-testid^="missing-"]').first().click();
    await shot('accept-partial');
    await byTestId('accept-sheet-close').click();

    // Reject sheet: reasons, "خلص الأكل" picked with its nudge.
    await page.locator('[data-testid^="reject-"]').first().click();
    await byTestId('reject-sheet').waitFor();
    await byTestId('reason-sold_out').click();
    await shot('reject');
    await byTestId('reject-sheet-close').click();

    // Busy mode on: the sheet, then the board with the countdown chip.
    await byTestId('busy-chip').click();
    await byTestId('busy-sheet').waitFor();
    await shot('busy-sheet');
    await byTestId('busy-toggle').click();
    await page.waitForTimeout(800);
    await page.locator('[data-testid="board"] div').evaluateAll((els) => els.forEach((e) => (e.scrollTop = 0)));
    await shot('busy-on', { wait: 1500 });

    // Accept with busy mode on: the note says the customer sees +10.
    await page.locator('[data-testid^="accept-"]').first().click();
    await byTestId('accept-sheet').waitFor();
    await shot('accept-busy');
    await byTestId('accept-confirm').click();
    await page.waitForTimeout(1200);

    // Order detail and the 80 mm receipt preview.
    await page.locator('[data-testid^="order-"]').first().click();
    await byTestId('order-detail').waitFor();
    await shot('detail');
    await byTestId('detail-print').click();
    await byTestId('receipt-preview').waitFor();
    await shot('receipt');
    await byTestId('receipt-preview-close').click();
    await page.waitForTimeout(300);
    if (await byTestId('order-detail-close').isVisible().catch(() => false)) await byTestId('order-detail-close').click();

    // Cash balance and "اطلب فلوسك".
    await byTestId('request-money').scrollIntoViewIfNeeded();
    await byTestId('request-money').click();
    await byTestId('cash-sheet').waitFor();
    await shot('cash');
    await byTestId('cash-confirm').click();
    await page.waitForTimeout(1000);
    await shot('cash-requested');
    await byTestId('cash-sheet-close').click();

    // Early close with a reason.
    await byTestId('store-open-toggle').click();
    await byTestId('close-sheet').waitFor();
    await byTestId('close-power_cut').click();
    await shot('close');
    await byTestId('close-sheet-close').click();

    // المزيد and the printer.
    await byTestId(phone ? 'tab-more' : 'nav-more').click();
    await byTestId('more').waitFor();
    await shot('more');
    await byTestId('more-printer').click();
    await byTestId('printer').waitFor();
    await shot('printer');

    // A wave-2 placeholder (المنيو), with the alarm pill if a new order is still waiting.
    await byTestId(phone ? 'printer' : 'nav-menu').waitFor();
    if (!phone) {
      await byTestId('nav-menu').click();
      await byTestId('menu').waitFor();
      await shot('menu-placeholder');
    }
    await demoPost('/demo/board/store?open=1&busy=0');
  },
};
