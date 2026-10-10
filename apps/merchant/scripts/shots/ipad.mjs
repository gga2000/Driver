// MER-13: the kitchen board on a 1024×768 iPad in landscape: ten new orders (the row numbers must
// read whole beside «اقبل»), then a single new ticket (its buttons on one line each).

export default {
  name: 'ipad',
  viewports: ['ipad'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, startShift } = h;
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/rush?count=10');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(4500);
    await shot('rush-10', { wait: 800 });
    await demoPost('/demo/board/rush?count=1');
    await page.reload();
    await byTestId('board').waitFor();
    await startShift();
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    await shot('one-new', { wait: 800 });
  },
};
