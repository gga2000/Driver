// Shop rules shots (Ali, 2026-10-08): a juice bar's accept sheet with 3 / 5 / 8 (t5), the busy sheet
// picking +20 and the board with it on (r5), «وضعك» on المحل (x6), and a dish photo «ينتظر المراجعة» in
// the menu (p4). Seeded by scripts/demo/rules.mjs (juice bar, pending photo) and board.mjs (switches).
export default {
  name: 'rules',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    const tab = (name) => byTestId(phone ? `tab-${name}` : `nav-${name}`).click();
    const dayOk = async () => {
      if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();
    };

    // t5: عصائر الربيع's new order — the prep choices are 3 / 5 / 8.
    await demoPost('/demo/rules/juice-order');
    await signIn('0770 444 0001');
    await byTestId('board').waitFor();
    await dayOk();
    await page.locator('[data-testid^="accept-more-"]').first().waitFor({ timeout: 15_000 });
    await page.locator('[data-testid^="accept-more-"]').first().click();
    await byTestId('accept-sheet').waitFor();
    await byTestId('prep-5').waitFor();
    await shot('juice-prep', { wait: 900 });
    await byTestId('accept-sheet-close').click().catch(() => page.keyboard.press('Escape'));

    // r5: مطعم خالد switches busy mode on and picks +20.
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/rules/photo?pending=1');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await dayOk();
    await byTestId('busy-chip').click();
    await byTestId('busy-sheet').waitFor();
    await byTestId('busy-pick-20').click();
    await shot('busy-pick', { wait: 700 });
    await byTestId('busy-toggle').click();
    await byTestId('busy-frame').waitFor({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(3500); // the toast goes
    await shot('busy-on-20', { wait: 600 });
    await byTestId('busy-chip').click();
    await byTestId('busy-sheet').waitFor();
    await shot('busy-on-sheet', { wait: 600 });
    await byTestId('busy-toggle').click();
    await page.waitForTimeout(1500);

    // x6: «وضعك» on المحل — on time, accepted and the food score, last 30 days.
    await tab('more');
    await page.locator('[data-testid="shop"]:visible').waitFor();
    await page.locator('[data-testid="standing-accepted"]:visible').waitFor({ timeout: 20_000 });
    await shot('standing', { wait: 1200 });
    await shot('standing-card', { element: page.locator('[data-testid="shop-standing"]:visible').first(), wait: 300 });

    // p4: the menu, «صحن كص» with its photo waiting for review.
    await tab('menu');
    await byTestId('menu').waitFor();
    await page.locator('[data-testid^="tray-tap-"]').first().waitFor({ timeout: 15_000 });
    // «صحن كص» sits in the كص section: open it (tablet rail / phone chips).
    await page.locator('[data-testid^="menu-cat-"]:visible', { hasText: 'كص' }).first().click();
    const pending = page.locator('[data-testid^="tray-review-"]:visible').first();
    await pending.waitFor({ timeout: 15_000 });
    await pending.scrollIntoViewIfNeeded();
    await shot('photo-pending', { wait: 1000 });
    await shot('photo-pending-dish', { element: page.locator('[data-testid^="dish-"]:visible', { has: pending }).first(), wait: 300 });
  },
};
