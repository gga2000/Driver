// «احذف حسابي» (docs/api/account-close.md): the tile at the end of المحل, the screen that says what goes
// and what stays, and the answer once the request is in (a support case).
//
//   SHOTS=delete-account node scripts/web-shots.mjs <out-dir>
export default {
  name: 'delete-account',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, signIn, goto, viewport } = h;
    const phone = viewport === 'phone';
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await byTestId(phone ? 'tab-more' : 'nav-more').click();
    await page.locator('[data-testid="more-delete-account"]:visible').waitFor();
    await page.locator('[data-testid="more-delete-account"]:visible').scrollIntoViewIfNeeded();
    await shot('tile');
    await goto('/delete-account');
    await page.locator('[data-testid="delete-account"]:visible').waitFor();
    await shot('screen', { full: phone });
    await page.locator('[data-testid="delete-account-send"]:visible').click();
    await page.getByText('وصل طلبك').first().waitFor();
    await shot('sent');
  },
};
