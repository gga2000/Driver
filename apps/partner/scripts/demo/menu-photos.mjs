// Menu photo service (maps program k3): مطعم خالد asked for three dishes to be photographed («الأفضل
// الصبح قبل الزحمة»). Field ops (0770 111 0006, ياسر) see it on Ops › تصوير منيو, set the visit, shoot
// each dish (the camera on a phone, the file picker on the web) and hand the photos over.
//
//   POST /demo/menu-photos/reset   a fresh open request again (cancels whatever request Khalid has open)
const DISHES = ['liver_plate', 'tikka_plate', 'salad'];
const NOTE = 'الأفضل الصبح قبل الزحمة';
const OPEN = ['requested', 'scheduled', 'shot'];

export default async function register(demo) {
  const { MENU_PHOTOS_REPOSITORY } = await demo.load('modules/menu-photos/index.js');
  const repo = demo.app.get(MENU_PHOTOS_REPOSITORY);
  const khalid = demo.restaurants.khalid;
  // The owner lives in the merchant demo; here the request only needs to exist.
  const ownerId = 'system:demo';

  async function seed() {
    for (const r of await repo.forOrg(khalid.orgId, 20)) {
      if (OPEN.includes(r.state)) await repo.update(r.id, { states: OPEN }, { state: 'cancelled', closedAt: new Date(), closedById: 'system:demo' });
    }
    await repo.create({
      orgId: khalid.orgId,
      cityId: demo.CITY,
      requestedById: ownerId,
      note: NOTE,
      itemIds: DISHES.map((k) => khalid.itemIds.get(k)).filter(Boolean),
      state: 'requested',
      assignedOpsId: null,
      scheduledFor: null,
      shotAt: null,
      closedAt: null,
      closedById: null,
      createdAt: new Date(Date.now() - 3 * 3_600_000),
    });
  }
  await seed();

  demo.route('/demo/menu-photos/reset', async ({ res }) => {
    await seed();
    demo.json(res, 200, { ok: true });
  });
}
