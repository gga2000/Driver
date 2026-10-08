// Counter redesign step 4 shots (the menu as a glass display): the trays (photo or the drawing customers
// see, price, «ساخن / بارد»), one tap stamping «خلص اليوم · يرجع باچر» with undo (m1–m3), the dishes
// with no photo and their «ماكو صورة · دوس وصوّر» (p1, p2), the editor opened for a photo with its tips,
// and a dish set to sell by weight (ربع · نص · كيلو, k2) showing «من … دينار» on its tray.
// Seeded by scripts/demo/menu.mjs; POST /demo/menu/reset puts everything back first and last.
export default {
  name: 'display',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    await demoPost('/demo/menu/reset');
    await demoPost('/demo/board/store?open=1&busy=0');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();

    await byTestId(phone ? 'tab-menu' : 'nav-menu').click();
    await byTestId('menu').waitFor();
    await page.locator('[data-testid^="tray-tap-"]').first().waitFor({ timeout: 15_000 });
    await shot('display', { wait: 1200 });
    if (phone) await shot('display-full', { full: true });

    // One tap: «خلص اليوم» stamped on the tray, the toast offers undo.
    // Tapped on its name, the way a hand at the counter does (the corners hold the pencil and the camera).
    const first = page.locator('[data-testid^="tray-tap-"]:visible').nth(1);
    const box = await first.boundingBox();
    const tap = { position: { x: box.width / 2, y: box.height - 24 } };
    await first.click(tap);
    await page.waitForTimeout(900);
    await shot('sold-out', { wait: 200 });
    // A second tap brings it back.
    await page.waitForTimeout(4500);
    await first.click(tap);
    await page.waitForTimeout(1500);

    // The dishes still without a photo, each asking for one.
    if (await byTestId('filter-no-photo').count()) {
      await byTestId('filter-no-photo').click();
      await page.waitForTimeout(600);
      await shot('no-photo', { wait: 400 });
      await page.locator('[data-testid^="tray-photo-"]:visible').first().click();
      await byTestId('item-editor').waitFor();
      await byTestId('photo-tips').waitFor();
      await shot('photo-tips', { wait: 900 });
      await page.goBack();
      await byTestId('menu').waitFor();
      await byTestId('filter-all').click();
    }

    // كص لحم بالكيلو sold by weight: ربع · نص · كيلو with their full prices.
    await byTestId('menu-cat-1').click();
    await page.locator('[data-testid^="dish-"]:visible', { hasText: 'كص لحم بالكيلو' }).first().locator('[data-testid^="tray-edit-"]').click();
    await byTestId('item-editor').waitFor();
    // :visible: on the web an editor left a moment ago can linger hidden in the page.
    await page.locator('[data-testid="sold-by"]:visible').getByText('بالوزن', { exact: true }).click();
    await page.locator('[data-testid="tier-sheet"]:visible').waitFor();
    for (const [i, price] of ['5000', '9500', '18000'].entries()) await page.locator(`[data-testid="tier-price-${i}"]:visible`).fill(price);
    await shot('tiers-sheet', { wait: 600 });
    await page.locator('[data-testid="tier-save"]:visible').click();
    await page.locator('[data-testid="tier-list"]:visible').waitFor({ timeout: 10_000 });
    await shot('tiers-saved', { wait: 1200 });
    await page.goBack();
    await byTestId('menu').waitFor();
    await byTestId('menu-cat-1').click();
    await page.waitForTimeout(1200);
    if (phone) await page.locator('[data-testid^="dish-"]:visible', { hasText: 'كص لحم بالكيلو' }).first().scrollIntoViewIfNeeded();
    await shot('display-weight', { wait: 400 });
    await demoPost('/demo/menu/reset');
  },
};
