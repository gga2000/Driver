// Opening hours (الدوام): مطعم خالد starts on the hours from onboarding (the catalog seed); the owner
// edits them on /hours (merchant.setHours) — split shifts, past midnight, Friday prayer, holidays.
//
//   POST /demo/hours/reset   back to the seed: no store-set hours, no closures, the storefront's seed hours
//   POST /demo/hours/week    a late-night kitchen's week (السبت–الخميس 10 الصبح – 3 بالليل, الجمعة after
//                            the prayer): the week on المحل and «خلص الأكل · لباچر» (counter step 5)
export default async function register(ctx) {
  const { orgs, catalog } = ctx.services;
  const { khalid } = ctx.stores;
  const front = await catalog.storefront(khalid.orgId);
  const seedHours = front ? front.hours.map((w) => ({ ...w })) : [];

  ctx.route('/demo/hours/reset', async () => {
    await orgs.setMerchantSettings(khalid.orgId, {
      openingHours: null,
      holidays: null,
      hoursUpdatedAt: null,
      closed: null,
    });
    const now = await catalog.storefront(khalid.orgId);
    if (now) await catalog.saveStorefront({ ...now, hours: seedHours });
    return { ok: true, seedShifts: seedHours.length };
  });

  ctx.route('/demo/hours/week', async () => {
    const openingHours = Array.from({ length: 7 }, (_, dow) => ({ dow, start: dow === 5 ? '13:15' : '10:00', end: '03:00' }));
    await orgs.setMerchantSettings(khalid.orgId, { openingHours, holidays: null, hoursUpdatedAt: new Date() });
    const now = await catalog.storefront(khalid.orgId);
    if (now) await catalog.saveStorefront({ ...now, hours: openingHours });
    return { ok: true };
  });
}
