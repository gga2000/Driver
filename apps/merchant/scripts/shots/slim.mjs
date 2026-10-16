// Library photos from the API (merchant-slim): the «من صورنا» sheet loading Driver's dish photos from
// /media/food/lib-*.webp, one picked for a dish with no photo, and the menu showing it. Also the
// fallback when a photo cannot load (the API refuses it): a quiet dish glyph, never a broken image.
// Seeded by scripts/demo/menu.mjs; POST /demo/menu/reset puts the menu back first.
export default {
  name: 'slim',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    const visible = (sel) => page.locator(`${sel}:visible`).first();
    await demoPost('/demo/menu/reset');
    await demoPost('/demo/board/store?open=1&busy=0');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();

    // A grill with no photo (كص لحم بالكيلو): open the library from its editor.
    await byTestId(phone ? 'tab-menu' : 'nav-menu').click();
    await byTestId('menu').waitFor();
    await byTestId('menu-cat-1').click();
    await page.locator('[data-testid^="dish-"]:visible', { hasText: 'كص لحم بالكيلو' }).first().locator('[data-testid^="tray-edit-"]').click();
    await byTestId('item-editor').waitFor();
    await byTestId('photo-from-library').click();
    await byTestId('library-sheet').waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot('library', { wait: 1500 });
    await byTestId('library-tab-grill').click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot('library-grill', { wait: 1500 });
    await visible('[data-testid="library-kebab-2"]').click();
    await shot('library-picked', { wait: 400 });
    await byTestId('library-use').click();
    await byTestId('library-sheet').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
    await shot('item-library-photo', { wait: 1500 });

    // Back on the menu: the dish now shows the picked photo.
    await page.goBack();
    await byTestId('menu').waitFor();
    await byTestId('menu-cat-1').click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await shot('menu-library-photo', { wait: 1500 });

    // A photo that cannot load: the tile keeps its bed and shows a dish glyph.
    await page.route('**/media/food/lib-**', (route) => route.abort());
    await page.locator('[data-testid^="dish-"]:visible').first().locator('[data-testid^="tray-edit-"]').click();
    await byTestId('item-editor').waitFor();
    await byTestId('photo-from-library').click();
    await byTestId('library-sheet').waitFor();
    await byTestId('library-tab-sweets').click();
    await shot('library-offline', { wait: 1500 });
    await page.unroute('**/media/food/lib-**');
  },
};
