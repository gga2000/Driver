// Opening hours (الدوام): مطعم خالد starts on the hours from onboarding (the catalog seed); the owner
// edits them on /hours (merchant.setHours) — split shifts, past midnight, Friday prayer, holidays.
//
//   POST /demo/hours/reset   back to the seed: no store-set hours, no closures, the storefront's seed hours
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
}
