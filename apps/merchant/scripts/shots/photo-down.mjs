// p4 photo take-down, the owner's side: the board's one-time strip (one dish, then two), the dish tile
// «نزّلنا صورتها» in the menu, and the dish screen saying why with the photo buttons under it.
// Seeded by scripts/demo/photo-down.mjs (POST /demo/photo-down). `SHOTS=photo-down node scripts/web-shots.mjs <out>`.
export default {
  name: 'photo-down',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, startShift, viewport } = h;
    const phone = viewport === 'phone';
    const acceptAll = async () => {
      for (let i = 0; i < 20; i++) {
        const btn = page.locator('[data-testid="sticky-accept-now"]:visible, [data-testid="ribbon-accept"]:visible, [data-testid^="accept-"]:not([data-testid^="accept-more"]):not([data-testid^="accept-all"]):visible').first();
        if (!(await btn.count())) break;
        await btn.click().catch(() => undefined);
        await page.waitForTimeout(900);
      }
    };
    await demoPost('/demo/menu/reset');
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/photo-down?key=pacha_trotters&reason=blurry');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await startShift?.();
    await acceptAll();

    // The board says it once, in a quiet moment (after the first-quiet-moment lesson, if it comes up).
    await byTestId('photo-down-strip').waitFor({ timeout: 15_000 });
    if (await byTestId('learn-cards').isVisible().catch(() => false)) await byTestId('learn-done').click();
    await page.waitForTimeout(600);
    await shot('board-one', { wait: 800 });

    // «صوّرها» opens the dish: why, then the photo buttons.
    await byTestId('photo-down-take').click();
    await byTestId('photo-down-note').waitFor({ timeout: 10_000 });
    await shot('dish', { wait: 800 });

    // The menu: the dish's tile says the photo came down.
    await page.goBack();
    await byTestId(phone ? 'tab-menu' : 'nav-menu').click();
    await byTestId('menu').waitFor();
    await byTestId('filter-no-photo').click().catch(() => undefined);
    const tile = page.locator('[data-testid^="tray-nophoto-"][aria-label*="كوارع"]').first();
    await tile.waitFor({ timeout: 15_000 });
    await tile.scrollIntoViewIfNeeded();
    await shot('menu-tile', { wait: 800 });

    // Two take-downs at once: one line on the board, «شوفها» opens the menu.
    await demoPost('/demo/photo-down?key=pacha_tongue&reason=people');
    await demoPost('/demo/photo-down?key=pacha_broth&reason=wrong_dish');
    await page.goto(new URL('/', page.url()).href);
    await byTestId('board').waitFor();
    await startShift?.();
    await acceptAll();
    await byTestId('photo-down-strip').waitFor({ timeout: 15_000 });
    await shot('board-many', { wait: 800 });
    await byTestId('photo-down-ok').click();
    await page.waitForTimeout(500);
    await shot('board-after-ok');
  },
};
