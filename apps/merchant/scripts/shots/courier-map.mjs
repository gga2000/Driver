// N16 the tablet sees the courier coming (Ali 2026-10-11): the map over the ready lane with the shop lit,
// each courier's photo and minutes, the dotted way behind one driving in, and the shop after it warmed.
// Needs the map's files in the export (EXPO_PUBLIC_MAP_TILES_URL / _GLYPHS_URL); without them the panel
// isn't drawn. `SHOTS=courier-map VIEWPORTS=tablet node scripts/web-shots.mjs <out>`.
export default {
  name: 'courier-map',
  viewports: ['tablet', 'ipad'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, startShift } = h;
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/fresh');
    // One more courier driving in from 1.2 km (a fix every 2 s), so a trail grows behind him.
    await demoPost('/demo/board/courier?metres=1200');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await startShift?.();
    if (await byTestId('learn-cards').isVisible().catch(() => false)) await byTestId('learn-done').click();
    await byTestId('courier-map').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(6000);
    await shot('board', { wait: 1500 });
    await shot('panel', { wait: 500, element: byTestId('courier-map') });
    // He comes closer: the trail grows and, inside 2 minutes, the shop warms once.
    await page.waitForTimeout(16_000);
    await shot('panel-closer', { wait: 500, element: byTestId('courier-map') });
  },
};
