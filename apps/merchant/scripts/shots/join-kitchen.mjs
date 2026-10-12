// أكل بيت, a cook asks to join: «تطبخين ببيتج؟» on the gate (her number has no store yet), the
// «اطبخي ويانا» sheet (kitchen name, her name, her door on the day map), and the waiting tile after.
// Map pictures need the map's files in the export (EXPO_PUBLIC_MAP_TILES_URL / _GLYPHS_URL); without
// them the sheet asks «قرب شنو؟» instead. A fresh number each run, so the gate shows no application.
export default {
  name: 'join-kitchen',
  viewports: ['phone', 'tablet'],
  async run(h) {
    const { page, byTestId, shot, signIn } = h;
    const fresh = String(Date.now() % 10000).padStart(4, '0');
    await signIn(`0770 777 ${fresh}`);
    await byTestId('join-kitchen-tile').waitFor();
    await shot('gate', { wait: 800 });

    await byTestId('join-kitchen-tile').click();
    await byTestId('join-kitchen-sheet').waitFor();
    await page.waitForTimeout(2500);
    await shot('sheet', { wait: 600 });

    await byTestId('join-kitchen-send').click();
    await page.waitForTimeout(500);
    await shot('missing', { wait: 400 });

    const fill = (id, v) => page.locator(`[data-testid="${id}"] input, input[data-testid="${id}"]`).first().fill(v);
    await fill('join-kitchen-name', 'مطبخ أم حسين');
    await fill('join-kitchen-cook', 'زينب');
    const map = byTestId('door-map');
    const box = await map.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 30, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(1200);
    }
    await fill('join-kitchen-landmark', 'ورا جامع الرسول، البيت الثاني');
    await shot('filled', { wait: 600 });
    await byTestId('join-kitchen-privacy').scrollIntoViewIfNeeded();
    await shot('filled-end', { wait: 400 });

    await byTestId('join-kitchen-send').click();
    await byTestId('join-kitchen-sheet').waitFor({ state: 'detached' });
    await shot('waiting', { wait: 800 });
  },
};
