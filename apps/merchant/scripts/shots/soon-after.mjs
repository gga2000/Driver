// MER-04/06: a staff member's menu (no add, sections or prices to change; a dish opens read-only with
// its photo and daily switches), then a board whose reads fail (no «0» counts, the error strip).
export default {
  name: 'soon-after',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, signIn, startShift, viewport } = h;
    const phone = viewport === 'phone';
    await signIn('0770 999 0000');
    await byTestId('stores').waitFor();
    await page.locator('[data-testid^="store-"]').first().click();
    await byTestId('board').waitFor({ timeout: 15_000 });
    await startShift();
    await byTestId(phone ? 'tab-menu' : 'nav-menu').click();
    await page.locator('[data-testid^="tray-tap-"]').first().waitFor({ timeout: 15_000 });
    await shot('staff-menu', { wait: 900 });
    await page.locator('[data-testid^="tray-edit-"]:visible').first().click();
    await byTestId('item-owner-only').waitFor({ timeout: 10_000 });
    await shot('staff-dish', { wait: 900 });

    h.allowConsole(/status of 500/);
    await page.route(/merchant\.board/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '[{"error":{"message":"down","code":-32603,"data":{"code":"INTERNAL_SERVER_ERROR","httpStatus":500}}}]' }));
    await page.goto(`${h.origin}/`, { waitUntil: 'load' });
    await byTestId('board').waitFor({ timeout: 20_000 });
    await startShift();
    // A board read last good more than 90 s ago (MER-04): the strip shows and the heartbeat stops.
    await byTestId('board-error').waitFor({ timeout: 150_000 });
    await shot('board-failed', { wait: 900 });
    await page.unroute(/merchant\.board/);
  },
};
