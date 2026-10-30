// m5 «شيلها من المنيو لباقي اليوم»: a dish ticked as out on a new order comes off the menu for the
// rest of the day too. The accept sheet with one dish ticked, then two, the toast after sending, and
// the menu's «خلص اليوم» filter with the dish in it. Seeded by scripts/demo/board.mjs (مطعم خالد).
export default {
  name: 'stop-today',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, goto } = h;
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/fresh');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    // Toasts wait while the new-order bell rings; a 30-s snooze lets «دزينا للزبون…» show.
    await byTestId('alarm-snooze').click().catch(() => undefined);
    // An order with at least two dishes, so one can be out and the rest still go.
    const card = page.locator('[data-testid^="accept-more-"]');
    await card.first().waitFor({ timeout: 15_000 });
    let opened = false;
    for (let i = 0; i < (await card.count()) && !opened; i++) {
      await card.nth(i).click();
      await byTestId('accept-sheet').waitFor();
      await byTestId('accept-some-missing').click();
      if ((await page.locator('[data-testid^="missing-"]').count()) >= 3) opened = true;
      else await byTestId('accept-sheet-close').click();
    }
    const lines = page.locator('[data-testid^="missing-"]');
    await lines.first().click();
    await byTestId('accept-stop-today').waitFor();
    await shot('sheet-one');
    await lines.nth(1).click();
    await shot('sheet-two');
    await lines.nth(1).click();
    await byTestId('accept-partial-confirm').click();
    await shot('sent', { wait: 900 });

    await goto('/menu');
    await byTestId('filter-sold-out').click();
    await shot('menu-sold-out', { wait: 1200 });
  },
};
