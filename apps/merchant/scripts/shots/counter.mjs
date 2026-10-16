// Counter redesign step 2 shots: the board as the kitchen sees it with four new orders — the next one
// on the saffron ribbon with one-tap accept (a1), short readable tickets (o1), «على النار» due-first
// with its draining bar (o5/o6), a dish ticked off (o10) and the cooking totals (o11); the phone's
// «هسة» view (o2) and its cooking segment. Seeded by scripts/demo/board.mjs (`/demo/board/rush`).
export default {
  name: 'counter',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';

    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/printer?state=connected');
    await demoPost('/demo/board/rush?count=4');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 });
    // The day's card from yesterday, then let the "ابدأ الشغل" toast go.
    if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();
    await page.waitForTimeout(4500);
    await shot('board', { wait: 800 });

    if (!phone) {
      await shot('lane-new', { element: byTestId('column-new') });
      await page.locator('[data-testid^="tick-"]').first().click();
      await shot('lane-cooking', { element: byTestId('column-preparing') });
      await shot('lane-ready', { element: byTestId('column-ready') });
      return;
    }
    if ((await page.locator('[data-testid^="row-"]').count()) > 0) {
      await page.locator('[data-testid^="row-"]').last().scrollIntoViewIfNeeded();
      await shot('now-rows');
      await page.locator('[data-testid="board"] div').evaluateAll((els) => els.forEach((e) => (e.scrollTop = 0)));
    }
    await byTestId('segment-preparing').click();
    await page.locator('[data-testid^="tick-"]').first().click();
    await shot('cooking', { wait: 800 });
  },
};
