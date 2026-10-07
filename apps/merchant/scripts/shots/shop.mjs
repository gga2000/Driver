// Counter redesign step 5 shots: «المحل» (the shutter, the four quick pauses, the week, why customers
// pick the shop), a power-cut pause rolling the shutter down with «نرجع …» and the board saying when
// it comes back, the close sheet asking how long, «عاشت إيدك» at the end of the day, and «يومك» for the
// owner (the day, money, the numbers) and for staff (no money). `/demo/board/store` resets the switches.
import { scrollPage } from './money.mjs';

export default {
  name: 'shop',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    const tab = (name) => byTestId(phone ? `tab-${name}` : `nav-${name}`).click();
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/hours/week');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();

    // المحل, open.
    await tab('more');
    await page.locator('[data-testid="shop"]:visible').waitFor();
    await byTestId('shop-why').getByText('%').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await shot('shop', { wait: 1200 });
    if (phone) await shot('shop-full', { full: true });

    // One tap: the power went off. The shutter rolls down and says when it opens again.
    await byTestId('pause-power').click();
    await page.waitForTimeout(1600);
    await scrollPage(page, 'more', 0);
    await shot('paused', { wait: 400 });
    await tab('orders');
    await page.locator('[data-testid="board"]:visible').waitFor();
    await shot('board-paused', { wait: 900 });

    // Back to المحل and open again with one tap on the shutter.
    await tab('more');
    await page.locator('[data-testid="shop"]:visible').waitFor();
    await page.locator('[data-testid="shutter"]:visible').click();
    await page.waitForTimeout(1600);

    // Close for the day: how long, then «عاشت إيدك».
    await page.waitForTimeout(3500); // let the "opened" toast go
    await page.locator('[data-testid="shutter"]:visible').click();
    await page.locator('[data-testid="close-sheet"]:visible').waitFor();
    await page.locator('[data-testid="close-closing_early"]:visible').click();
    await page.locator('[data-testid="close-length-hand"]:visible').click();
    await shot('close-sheet', { wait: 500 });
    await page.locator('[data-testid="close-confirm"]:visible').click();
    await page.waitForTimeout(1500);
    await shot('closed-thanks', { wait: 200 });
    await demoPost('/demo/board/store?open=1&busy=0');

    // يومك (owner): the day on top, then money; the numbers in their own tab.
    await tab('money');
    await byTestId('money').waitFor();
    await byTestId('day-strip').waitFor({ timeout: 15_000 });
    await shot('day', { wait: 1500 });
    await byTestId('segment-insights').click();
    await byTestId('insights-prep').waitFor({ timeout: 20_000 });
    await shot('day-numbers', { wait: 1200 });

    // يومك (staff): the same day and numbers, never money.
    await signIn('0770 999 0000');
    await byTestId('stores').waitFor();
    await page.locator('[data-testid^="store-"]').first().click();
    await byTestId('board').waitFor({ timeout: 15_000 });
    if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();
    await tab('money');
    await byTestId('insights-prep').waitFor({ timeout: 20_000 });
    await shot('day-staff', { wait: 1200 });
    await tab('more');
    await page.locator('[data-testid="shop"]:visible').waitFor();
    await shot('shop-staff', { wait: 1200 });
    await demoPost('/demo/hours/reset');
  },
};
