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
    await signIn('0770 123 4567', { keepGate: true });
    await byTestId('board').waitFor();
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 });
    // "ابدأ الشغل": sound, screen on, printer — then the ringing board.
    await shot('shift-gate', { wait: 1200 });
    await h.startShift();
    await shot('board', { wait: 1200 });

    // "سكّت 30 ثانية" is a snooze: the banner says when it rings again.
    await byTestId('alarm-snooze').click();
    await shot('snoozed');
    await byTestId('alarm-unsnooze').click();

    // Missed orders: the «فاتك اليوم» chip in the status bar (a dot until seen); its sheet says what
    // happened and offers busy mode or a short close. Closing it counts as seen.
    await demoPost('/demo/board/missed?count=2');
    await byTestId('missed-chip').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await shot('missed');
    await byTestId('missed-chip').click();
    await byTestId('missed-new').waitFor();
    await shot('missed-sheet');
    await byTestId('missed-sheet-close').click();

    // The new-order card with its 90-s ring.
    await shot('new-order', { element: page.locator('[data-testid^="order-"]').first() });

    if (phone) {
      await byTestId('segment-preparing').click();
      await shot('preparing');
      await byTestId('segment-ready').click();
      await shot('ready');
      await byTestId('segment-new').click();
    }

    // Accept sheet (the chevron next to one-tap "اقبل · 15 د"): prep-time choices, then partial accept.
    const firstNew = page.locator('[data-testid^="accept-more-"]').first();
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

    // Busy mode on: the sheet, then the board with the countdown chip (on a phone it lives in "…").
    if (phone) await byTestId('header-more').click();
    await shot('DEBUG');
    await byTestId('busy-chip').click();
    await byTestId('busy-sheet').waitFor();
    await shot('busy-sheet');
    await byTestId('busy-toggle').click();
    await page.waitForTimeout(800);
    await page.locator('[data-testid="board"] div').evaluateAll((els) => els.forEach((e) => (e.scrollTop = 0)));
    await shot('busy-on', { wait: 1500 });

    // Accept with busy mode on: the note says the customer sees +10.
    await page.locator('[data-testid^="accept-more-"]').first().click();
    await byTestId('accept-sheet').waitFor();
    await shot('accept-busy');
    await byTestId('accept-confirm').click();
    await page.waitForTimeout(1200);

    // One tap accepts with the usual time; the preparing card then offers "+5 د" once.
    await page.locator('[data-testid^="accept-"]:not([data-testid^="accept-more-"])').first().click();
    await page.waitForTimeout(1200);
    if (phone) await byTestId('segment-preparing').click();
    const extend = page.locator('[data-testid^="extend-"]').first();
    await extend.waitFor();
    await shot('one-tap-accepted');
    await extend.click();
    await page.waitForTimeout(1200);
    await shot('extended');
    if (phone) await byTestId('segment-new').click();

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

    // Cash balance and "اطلب فلوسك" (on a phone it lives in "…" too). The detail and receipt sheets
    // must be gone first, or the tap on "…" lands on a closing sheet. Once the tablet run has asked
    // for the money the pill says «طلبت فلوسك» and has no button: the phone run then shoots the menu.
    if (phone) {
      await byTestId('order-detail').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
      await byTestId('receipt-preview').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
      await byTestId('header-more').click();
      await byTestId('header-menu').waitFor();
    }
    if (await byTestId('request-money').waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) {
      await byTestId('request-money').click();
      await byTestId('cash-sheet').waitFor();
      await shot('cash');
      await byTestId('cash-confirm').click();
      await page.waitForTimeout(1000);
      await shot('cash-requested');
      await byTestId('cash-sheet-close').click();
    } else {
      await shot('cash-requested');
      if (phone) await byTestId('header-menu-close').click();
    }

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
