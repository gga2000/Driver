// p4 photo take-down (owner's side): Driver's team took a shop's dish photo down, and the board and the
// menu say why. Nothing is seeded by default, so other screenshots stay as they are.
//
//   POST /demo/photo-down?key=pacha_trotters&reason=blurry   one take-down (a dish with no photo; reason
//                                                           blurry | wrong_dish | people | other)

export default async function register(ctx) {
  const { catalog } = ctx.services;
  const { khalid } = ctx.stores;
  const { EventsService } = await ctx.load('modules/events/index.js');
  const events = ctx.app.get(EventsService);

  ctx.route('/demo/photo-down', async (_req, _res, url) => {
    const key = url.searchParams.get('key') ?? 'pacha_trotters';
    const reason = url.searchParams.get('reason') ?? 'blurry';
    const itemId = khalid.itemIds.get(key);
    if (!itemId) throw new Error(`no item ${key}`);
    const [item] = await catalog.itemsOf(khalid.orgId, [itemId]);
    if (item?.photoUrl) throw new Error(`${key} still has a photo`);
    const at = new Date();
    await events.emit(undefined, { type: 'catalog.photo_taken_down', actorId: 'system:demo', occurredAt: at, payload: { merchantOrgId: khalid.orgId, itemId, reason, at } }, { name: 'org', id: khalid.orgId });
    return { itemId, reason };
  });
}
