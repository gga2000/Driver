// An accepted order the customer cancels: a red «انلغى، لا تكمل» card on the board, one tap to hide it.
// Seeded by scripts/demo/cancelled.mjs.
export default {
  name: 'cancelled',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn } = h;
    await demoPost('/demo/board/store?open=1&busy=0');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    const cooking = await demoPost('/demo/cancelled/one?ready=0');
    const ready = await demoPost('/demo/cancelled/one?ready=1');
    await byTestId(`cancelled-${cooking.orderId}`).waitFor({ timeout: 15_000 });
    await shot('red-cards', { wait: 1200 });
    await byTestId(`cancelled-${ready.orderId}`).click();
    await page.waitForTimeout(600);
    await shot('one-dismissed', { wait: 600 });
  },
};
