// Menu photo service (تصوير المنيو, maps program k3): مطعم خالد's shoot of three dishes has been done by
// ياسر from field ops and handed over, so the owner opens /menu-photos on the review — today's photo
// next to the new one, «قبول» / «رفض» per dish. Accepting makes it the dish's photo on the menu.
//
//   POST /demo/menu-photos/reset       back to the handed-over shoot (3 photos waiting)
//   POST /demo/menu-photos/scheduled   a request with the visit set for tomorrow morning, no photos yet
//   POST /demo/menu-photos/clear       no open request (the «اطلب تصوير» form)
import { platePng } from '../../../partner/scripts/door-photo.mjs';

const DISHES = [
  { key: 'liver_plate', food: [120, 60, 40] },
  { key: 'tikka_plate', food: [196, 110, 50] },
  { key: 'salad', food: [90, 160, 70] },
];
const NOTE = 'الأفضل الصبح قبل الزحمة';
const OPEN = ['requested', 'scheduled', 'shot'];
const HOUR = 3_600_000;

export default async function register(ctx) {
  const { identity } = ctx.services;
  const { khalid } = ctx.stores;
  const { BLOB_STORE } = await ctx.load('modules/places/index.js');
  const { MENU_PHOTOS_REPOSITORY } = await ctx.load('modules/menu-photos/index.js');
  const blobs = ctx.app.get(BLOB_STORE);
  const repo = ctx.app.get(MENU_PHOTOS_REPOSITORY);

  // The field ops photographer (the partner demo's ياسر).
  const opsId = await identity.ensurePersonByPhone('07701110006', 'system:demo', 'demo');
  await identity.updateProfile({ personId: opsId, sessionId: 'demo' }, { name: 'ياسر عبد الله' });

  /** A drawn plate as the photographer's own upload (ticket + PUT, like the Partner app). */
  async function plate(food) {
    const bytes = platePng(food);
    const ticket = await blobs.createUpload({ ownerId: opsId, contentType: 'image/png', sizeBytes: bytes.length });
    const url = new URL(ticket.uploadUrl, 'http://local');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig'), contentType: 'image/png', bytes });
    return ticket.uploadId;
  }

  async function closeOpen() {
    for (const r of await repo.forOrg(khalid.orgId, 20)) {
      if (OPEN.includes(r.state)) await repo.update(r.id, { states: OPEN }, { state: 'cancelled', closedAt: new Date(), closedById: 'system:demo' });
    }
  }

  async function request(state, scheduledFor) {
    await closeOpen();
    return repo.create({
      orgId: khalid.orgId,
      cityId: 'aziziyah',
      requestedById: ctx.people.owner.id,
      note: NOTE,
      itemIds: DISHES.map((d) => khalid.itemIds.get(d.key)).filter(Boolean),
      state,
      assignedOpsId: opsId,
      scheduledFor,
      shotAt: state === 'shot' ? new Date(Date.now() - HOUR) : null,
      closedAt: null,
      closedById: null,
      createdAt: new Date(Date.now() - 26 * HOUR),
    });
  }

  async function handedOver() {
    const r = await request('shot', new Date(Date.now() - 2 * HOUR));
    for (const d of DISHES) {
      const itemId = khalid.itemIds.get(d.key);
      if (itemId) await repo.putShot({ requestId: r.id, itemId, uploadId: await plate(d.food), takenById: opsId, at: new Date(Date.now() - 90 * 60_000) });
    }
  }

  /** Tomorrow 10:00 Baghdad. */
  function tomorrowMorning() {
    const day = Math.floor((Date.now() + 3 * HOUR) / 86_400_000) + 1;
    return new Date(day * 86_400_000 + 10 * HOUR - 3 * HOUR);
  }

  await handedOver();

  ctx.route('/demo/menu-photos/reset', async () => {
    await handedOver();
    return { ok: true };
  });
  ctx.route('/demo/menu-photos/scheduled', async () => {
    await request('scheduled', tomorrowMorning());
    return { ok: true };
  });
  ctx.route('/demo/menu-photos/clear', async () => {
    await closeOpen();
    return { ok: true };
  });
}
