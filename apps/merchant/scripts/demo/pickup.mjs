// Pickup spot (مكان الاستلام, maps program r7): مطعم خالد starts with a drawn takeaway window and
// «الاستلام من الشباك اليسار»; the owner edits them on /pickup-spot (merchant.setPickupSpot) and
// couriers see them on the pickup stop of their job.
//
//   POST /demo/pickup/reset   back to the seeded window photo and note
//   POST /demo/pickup/clear   no pickup spot (the screen's empty state)
import { pickupWindowPng } from '../../../partner/scripts/door-photo.mjs';

const NOTE = 'الاستلام من الشباك اليسار، جنب باب المطبخ';

export default async function register(ctx) {
  const { orgs } = ctx.services;
  const { khalid } = ctx.stores;
  const { BLOB_STORE } = await ctx.load('modules/places/index.js');
  const blobs = ctx.app.get(BLOB_STORE);

  /** The window photo as the owner's own upload (ticket + PUT, like the app). */
  async function windowPhoto() {
    const bytes = pickupWindowPng();
    const ticket = await blobs.createUpload({ ownerId: ctx.people.owner.id, contentType: 'image/png', sizeBytes: bytes.length });
    const url = new URL(ticket.uploadUrl, 'http://local');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp'), sig: url.searchParams.get('sig'), contentType: 'image/png', bytes });
    return ticket.uploadId;
  }

  /** Sets the spot, deleting the photos it replaces (as `setPickupSpot` does). */
  async function setSpot(spot) {
    const before = (await orgs.merchantSettings(khalid.orgId)).pickupSpot;
    await orgs.setMerchantSettings(khalid.orgId, { pickupSpot: spot });
    for (const id of before?.photoRefs ?? []) if (!spot?.photoRefs.includes(id)) await blobs.remove(id);
  }

  const seed = async () => setSpot({ note: NOTE, photoRefs: [await windowPhoto()], updatedAt: new Date() });
  await seed();

  ctx.route('/demo/pickup/reset', async () => {
    await seed();
    return { ok: true };
  });
  ctx.route('/demo/pickup/clear', async () => {
    await setSpot(null);
    return { ok: true };
  });
}
