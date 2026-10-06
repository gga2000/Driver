// «قدر اليوم» and «قصة مطعمك» (joy J7a h2/h5). مطعم خالد starts with no pot today, last week's same
// day (وجبة كباب) so «نفسها اليوم» shows, two other recent pots as chips, a few people following its
// dishes (the counts on the pot screen), and its story written and shown.
//
//   POST /demo/pot/reset    back to that start (today's pot taken off, the history and followers seeded)
//   POST /demo/pot/clear    no pot history at all (the screen without suggestions)
//   POST /demo/story/clear  no story (the empty editor)
const DAY_MS = 86_400_000;
const STORY = 'نشوي على الفحم من أيام أبوي، ونفس الخلطة.\nالكباب ينگطع بالساطور كل صبح.';

/** A Baghdad date key `daysAgo` days back. */
function localDate(daysAgo) {
  return new Date(Date.now() + 3 * 3_600_000 - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

export default async function register(ctx) {
  const { catalog } = ctx.services;
  const { khalid } = ctx.stores;
  const { CATALOG_REPOSITORY } = await ctx.load('modules/catalog/index.js');
  const repo = ctx.app.get(CATALOG_REPOSITORY);
  const item = (key) => khalid.itemIds.get(key);

  async function clearAll() {
    for (let d = 0; d <= 14; d++) await repo.deletePot(khalid.orgId, localDate(d));
  }

  async function seed() {
    await clearAll();
    const at = new Date();
    for (const [daysAgo, key] of [
      [7, 'kebab_plate'],
      [5, 'liver_plate'],
      [3, 'tikka_plate'],
    ]) {
      await repo.upsertPot({ merchantOrgId: khalid.orgId, itemId: item(key), localDate: localDate(daysAgo), note: null, until: null, postedById: ctx.people.owner.id, at });
    }
    for (const [i, key] of ['kebab_plate', 'kebab_plate', 'kebab_plate', 'tikka_plate'].entries()) await catalog.followDish(`demo_fan_${i}`, khalid.orgId, item(key), true);
  }

  await seed();
  await catalog.setStory(khalid.orgId, { text: STORY, sinceYear: 2009, shown: true });

  ctx.route('/demo/pot/reset', async () => {
    await seed();
    return { ok: true };
  });
  ctx.route('/demo/pot/clear', async () => {
    await clearAll();
    return { ok: true };
  });
  ctx.route('/demo/story/clear', async () => {
    await catalog.setStory(khalid.orgId, { text: null, sinceYear: null, shown: false });
    return { ok: true };
  });
}
