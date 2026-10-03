// Wave 2 deals shots: the list (running, waiting for Driver, scheduled, paused, over), the propose
// wizard with the server's projected cost before sending (tablet: one page + live summary; phone: four
// steps), the sent deal waiting for approval, and the owner pausing a running one.
// Seeded by scripts/demo/deals.mjs.
export default {
  name: 'deals',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, signIn, viewport } = h;
    const phone = viewport === 'phone';
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();

    await byTestId(phone ? 'tab-more' : 'nav-more').click();
    await byTestId('more-deals').click();
    await byTestId('deals').waitFor();
    await page.locator('[data-testid^="deal-"][data-testid*="promo"], [data-testid^="deal-toggle-"]').first().waitFor({ timeout: 15_000 });
    await shot('list', { wait: 1000 });
    await shot('list-full', { full: true });

    // Propose: 20% on the tikka dishes, Thursday and Friday dinners, two weeks, minimum 15,000.
    await byTestId('deal-new').click();
    await byTestId('deal-new-screen').waitFor();
    await shot('new-empty');
    await byTestId('kind-percent').click();
    if (phone) {
      await shot('step-kind');
      await byTestId('wizard-next').click();
    }
    await byTestId('percent-20').click();
    await byTestId('items-some').click();
    await page.locator('[data-testid^="pick-"]:visible', { hasText: 'لفة تكة' }).first().click();
    await page.locator('[data-testid^="pick-"]:visible', { hasText: 'وجبة تكة' }).first().click();
    await page.locator('[data-testid="deal-name"]').fill('تكة الخميس والجمعة');
    if (phone) {
      await shot('step-offer');
      await byTestId('wizard-next').click();
    }
    await byTestId('duration-14').click();
    await byTestId('day-4').click();
    await byTestId('day-5').click();
    await byTestId('hours-dinner').click();
    await byTestId('min-0').click();
    await byTestId('budget-100000').click();
    if (phone) {
      await shot('step-when');
      await byTestId('wizard-next').click();
    }
    await page.locator('[data-testid="deal-projection"]:visible', { hasText: 'محسوبة من' }).first().waitFor({ timeout: 15_000 });
    await shot('projection', { wait: 1200 });
    if (!phone) await shot('projection-full', { full: true });

    await byTestId('deal-submit').click();
    await byTestId('deals').waitFor();
    await page.waitForTimeout(1200);
    await shot('sent', { wait: 600 });

    // Pause the running one.
    await page.locator('[data-testid^="deal-toggle-"]').first().click();
    await page.waitForTimeout(1200);
    await shot('paused', { wait: 400 });
    await page.locator('[data-testid^="deal-toggle-"]').first().click();
    await page.waitForTimeout(800);
  },
};
