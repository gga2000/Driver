// Phase 2 kitchen-rush shots (UI/UX audit M-05, M-06, M-09, M-10, M-11, M-13): ten new orders at once
// (queue strip + compact tickets on a tablet, sticky accept bar on a phone), a group order with an
// allergy and a courier note, the detail sheet with its ring, and the best sellers. Seeded by
// scripts/demo/board.mjs (`/demo/board/rush`, `/demo/board/fresh`) and scripts/demo/insights.mjs.
// Steps the older board lacks are skipped, so the same list shoots a before/after pair.
export default {
  name: 'rush',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    const has = async (id) => (await page.locator(`[data-testid="${id}"]`).count()) > 0;
    const top = () => page.locator('[data-testid="board"] div').evaluateAll((els) => els.forEach((e) => (e.scrollTop = 0)));

    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/printer?state=disconnected');
    await demoPost('/demo/board/rush?count=10');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 });
    // Let the "ابدأ الشغل" toast go.
    await page.waitForTimeout(4500);
    await shot('rush-10', { wait: 800 });

    if (!phone && (await page.locator('[data-testid^="compact-"]').count()) > 3) {
      // Tap the fourth short ticket: it opens in full in the column, the rest stay short.
      await page.locator('[data-testid^="compact-"]').nth(3).click();
      await shot('rush-picked', { wait: 1200 });
    }
    if (phone && (await page.locator('[data-testid^="row-"]').count()) > 1) {
      // Phone «هسة»: a row tapped comes to the top in full.
      await page.locator('[data-testid^="row-"]').nth(1).click();
      await shot('rush-row-picked', { wait: 1200 });
      await top();
    }
    if (phone && (await has('sticky-accept'))) {
      await page.evaluate(() => document.querySelectorAll('[data-testid="board"] div').forEach((e) => (e.scrollTop = 600)));
      await shot('rush-scrolled', { wait: 800 });
      await top();
    }

    // Three fresh orders: the group order for three (allergy, courier note) has the least time left.
    await demoPost('/demo/board/fresh');
    await page.waitForTimeout(2500);
    await top();
    await shot('group', { wait: 1500 });

    // The group order's detail sheet: ring (M-11), allergy, the kitchen note and the courier's note.
    const note = page.locator('[data-testid^="kitchen-note-"]').first();
    if (await note.count()) await note.click();
    else await page.locator('[data-testid^="order-"]').first().click();
    await byTestId('order-detail').waitFor();
    await shot('detail', { wait: 1000 });
    await page.locator('[data-testid="order-detail"] div').evaluateAll((els) => els.forEach((e) => (e.scrollTop = 9999)));
    await shot('detail-notes', { wait: 600 });
    await byTestId('order-detail-close').click();

    // Phone header menu (busy, printer, cash, switch store).
    if (phone && (await has('header-more'))) {
      await byTestId('header-more').click();
      await byTestId('header-menu').waitFor();
      await shot('header-menu');
      await byTestId('header-menu-close').click();
    }

    // Best sellers (M-13): rank and bar from the same measure.
    await byTestId(phone ? 'tab-insights' : 'nav-insights').click();
    await byTestId('insights-best').waitFor({ timeout: 20_000 });
    // Panel top just under the page's sticky title.
    await byTestId('insights-best').evaluate((e) => {
      e.scrollIntoView({ block: 'start' });
      let p = e.parentElement;
      while (p && !(p.scrollHeight > p.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(p).overflowY))) p = p.parentElement;
      if (p) p.scrollTop -= 150;
    });
    await shot('best-sellers', { wait: 1200 });
    if (await has('segment-sales')) {
      await byTestId('segment-sales').click();
      await shot('best-sellers-sales', { wait: 900 });
    }
  },
};
