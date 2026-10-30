// «مكاني على الخريطة» (Ali's pick C, 2026-10-22): the tile on «المحل», the screen with the kitchen's
// pin, the map moved to a new door (send unlocks past 15 m), the wrong-name form, and the thanks.
export default {
  name: 'my-map',
  viewports: ['phone', 'tablet'],
  async run(h) {
    const { page, byTestId, shot, signIn, goto } = h;
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await goto('/more');
    const tile = page.getByText('مكاني على الخريطة').first();
    await tile.waitFor({ timeout: 15_000 });
    await tile.scrollIntoViewIfNeeded();
    await shot('tile', { wait: 800 });
    await goto('/my-map');
    await byTestId('my-map').waitFor({ timeout: 20_000 });
    await shot('screen', { wait: 2500 });
    const map = page.locator('.maplibregl-canvas').first();
    if (await map.count()) {
      const box = await map.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 90, box.y + box.height / 2 + 60, { steps: 12 });
      await page.mouse.up();
      await shot('moved', { wait: 1500 });
    }
    await byTestId('my-map-kind-wrong_name').click();
    await byTestId('my-map-name').fill('مطعم خالد للمشويات');
    await shot('name', { wait: 600 });
    await byTestId('my-map-send').click();
    await page.getByText('وصل. الفريق يشوفه ويصلّح الخريطة').first().waitFor({ timeout: 10_000 });
    await shot('sent', { wait: 400 });
  },
};
