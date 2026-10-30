// «فريقنا عدّل بمحلك»: ياسر from field ops changed two prices at مطعم خالد from the Console, so the
// owner's board shows the chip and /staff-changes lists them (who, what, when). Staff never see it.
export default async function register(ctx) {
  const { identity, catalog } = ctx.services;
  const { khalid } = ctx.stores;
  const { StoresConsoleService } = await ctx.load('modules/merchant-admin/index.js');
  const stores = ctx.app.get(StoresConsoleService);

  // The partner demo's ياسر (field ops), as in the menu-photos section.
  const opsId = await identity.ensurePersonByPhone('07701110006', 'system:demo', 'demo');
  await identity.updateProfile({ personId: opsId, sessionId: 'demo' }, { name: 'ياسر عبد الله' });
  await identity.grantRole({ personId: 'system:demo' }, { personId: opsId, kind: 'field_ops' });
  const ops = { personId: opsId, sessionId: 'demo' };

  for (const [key, priceIqd] of [['liver_plate', 5500], ['salad', 1250]]) {
    const [item] = await catalog.itemsOf(khalid.orgId, [khalid.itemIds.get(key)]);
    await stores.upsertItem(ops, { merchantOrgId: khalid.orgId, itemId: item.id, nameAr: item.nameAr, priceIqd, categoryAr: item.categoryAr, why: 'صاحب المحل طلب بالتلفون' });
  }
}
