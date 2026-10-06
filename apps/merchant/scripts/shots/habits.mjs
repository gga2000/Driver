// Joy J7a (2026-10-07): «قدر اليوم» — the row on top of the menu, the pot screen with last week's
// one tap, a posted pot — and «قصة مطعمك» (the owner's editor with its preview). Seeded by
// scripts/demo/pot.mjs.
export default {
  name: 'habits',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    const tall = async (name) => {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: vp.width, height: 1900 });
      await shot(name, { wait: 900 });
      await page.setViewportSize(vp);
    };
    await demoPost('/demo/pot/reset');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await byTestId(phone ? 'tab-menu' : 'nav-menu').click();
    await byTestId('menu-pot').waitFor({ timeout: 15_000 });
    await shot('menu-pot-row', { wait: 700 });

    await byTestId('menu-pot').click();
    await byTestId('pot-last-week').waitFor({ timeout: 15_000 });
    await tall('pot');
    await byTestId('pot-recent-0').click();
    await page.locator('[data-testid="pot-note"]').fill('ويا تمن عنبر وشوربة');
    await byTestId('pot-until-17:00').click();
    await tall('pot-picked');
    await byTestId('pot-post').click();
    await byTestId('pot-today').waitFor({ timeout: 10_000 });
    await tall('pot-posted');
    await demoPost('/demo/pot/reset');

    await h.goto('/story');
    await byTestId('story-edit').waitFor({ timeout: 15_000 });
    await tall('story');
  },
};
