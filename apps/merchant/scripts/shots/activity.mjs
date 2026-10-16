// «مين سوّى شنو» (owner only): the card on يومك → اليوم and the who-line on an order's sheet.
// Seeded by scripts/demo/board.mjs (مصطفى and علي accept, add time, reject, mark ready) and
// scripts/demo/menu.mjs (علي: «خلص اليوم» on the kebab kilo; مصطفى: tabbouleh off).
import { scrollPage } from './money.mjs';

export default {
  name: 'activity',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, signIn, viewport } = h;
    const phone = viewport === 'phone';

    await signIn('0770 123 4567');
    await byTestId('board').waitFor();

    // The order sheet of an order being prepared: «قبله مصطفى … · زاد وقته علي …».
    if (phone) await byTestId('segment-preparing').click();
    const lane = phone ? page : byTestId('column-preparing');
    // The ticket number opens the sheet (a tap on a line ticks it off instead).
    await lane.locator('[data-testid^="order-"]').first().getByText(/^#\d+$/).first().click();
    await byTestId('order-detail').waitFor();
    await byTestId('detail-who').waitFor({ timeout: 15_000 });
    await shot('order-who');
    await page.keyboard.press('Escape');
    await byTestId('order-detail').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);

    await byTestId(phone ? 'tab-money' : 'nav-money').click();
    await byTestId('money').waitFor();
    await byTestId('activity-row-0').waitFor({ timeout: 15_000 });
    await scrollPage(page, 'money', 1);
    await shot('today-card', { wait: 1200, element: byTestId('activity') });
  },
};
