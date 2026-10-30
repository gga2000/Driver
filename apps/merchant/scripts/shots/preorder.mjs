// A pre-order for tomorrow: off the board (and silent) until it is offered to the kitchen, then on
// the board with its 90-s countdown, and accepted. Seeded by scripts/demo/preorder.mjs.
export default {
  name: 'preorder',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn } = h;
    await demoPost('/demo/board/store?open=1&busy=0');
    const { orderId, number } = await demoPost('/demo/preorder/place');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await page.waitForTimeout(4500);
    await shot('before-offer', { wait: 800 });

    await demoPost(`/demo/preorder/offer?id=${orderId}`);
    await byTestId(`order-${number}`).first().waitFor({ timeout: 15_000 });
    await shot('offered', { wait: 1500 });

    // Phone «هسة» rows open first; the tablet card has the accept button.
    const row = page.locator(`[data-testid="row-${number}"]`);
    if (await row.count()) await row.first().click();
    await byTestId(`accept-${number}`).first().click();
    const confirm = page.locator('[data-testid="accept-confirm"]');
    if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
      await shot('accept-sheet', { wait: 600 });
      await confirm.click();
    }
    await page.waitForTimeout(2500);
    await shot('accepted', { wait: 800 });
  },
};
