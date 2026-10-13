// «دوّرلي» (shop-for-me): a courier's job (6 pieces in all: a bike's item cap) whose first stop is the customer's list «الليستة» — five items,
// one with a photo, one with a voice note, a known shop with its pin, the «إذا ماكو» choices and the
// customer's price ceilings.
//
//   POST /demo/errand-job?who=courier   the list accepted by him, on his way to the shops
//        &step=at_shops                 …and arrived at them (the receipt panel shows)
import { Buffer } from 'node:buffer';
import { platePng } from '../door-photo.mjs';

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
const SHOPS = { zoneKey: 'hashimi', pin: { lat: 32.8968, lng: 45.0662 } };
const HOME = { zoneKey: 'mahdood_2', pin: { lat: 32.9165, lng: 45.0585 } };
const PHONE_SHOP = { lat: 32.8975, lng: 45.0671 };

export default async function register(demo) {
  const { services, CITY } = demo;
  const { orders, trips, dispatch } = services;
  const dispatcher = { personId: 'demo-dispatcher', sessionId: 'demo' };
  const { BLOB_STORE } = await demo.load('modules/places/index.js');
  const blobs = demo.app.get(BLOB_STORE);

  async function upload(ownerId, contentType, bytes) {
    const ticket = await blobs.createUpload({ ownerId, contentType, sizeBytes: bytes.length });
    const u = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType, bytes });
    return ticket.uploadId;
  }

  async function clear(personId) {
    for (let i = 0, open = await dispatch.openOffer(personId, CITY); open && i < 5; i++, open = await dispatch.openOffer(personId, CITY)) {
      await dispatch.respond({ personId, sessionId: 'demo' }, { offerId: open.offer.id, accept: false }).catch(() => undefined);
    }
    for (const t of await trips.forDriver(personId)) await trips.cancel(t.id, 'platform', 'demo-dispatcher', 'demo_reset').catch(() => undefined);
  }

  demo.route('/demo/errand-job', async ({ res, query }) => {
    const p = demo.who(query);
    const buyer = demo.people.get('buyer').personId;
    await clear(p.personId);
    if (!(await dispatch.presence.get(p.personId))) await demo.online(p.personId, SHOPS.pin, p.vehicle ?? 'bike');
    const photo = await upload(buyer, 'image/png', platePng([214, 222, 236]));
    const voice = await upload(buyer, 'audio/webm', WEBM);
    const listMaxIqd = 30000;
    const near = { kind: 'near' };
    const line = (freeText, qty, item) => ({ freeText, qty, errandItem: { maxIqd: null, photoUploadId: null, voiceUploadId: null, voiceSec: null, listMaxIqd, ...item } });
    const order = await orders.place(buyer, {
      cityId: CITY,
      type: 'errand',
      pickup: SHOPS,
      dropoff: HOME,
      lines: [
        line('شاحن تايب سي', 1, { unit: 'piece', where: { kind: 'known', name: 'موبايلات النور', pin: PHONE_SHOP }, ifMissing: 'call', maxIqd: 6000, photoUploadId: photo }),
        line('حليب نيدو الكبير', 1, { unit: 'piece', where: near, ifMissing: 'similar', voiceUploadId: voice, voiceSec: 9 }),
        line('طماطة', 1, { unit: 'kg', where: near, ifMissing: 'skip' }),
        line('صمون', 2, { unit: 'piece', where: near, ifMissing: 'skip' }),
        line('ماي صحة', 1, { unit: 'carton', where: near, ifMissing: 'similar', maxIqd: 4000 }),
      ],
    });
    // Dispatch builds the trip itself on order.placed (outbox): wait a moment for it before building one.
    let built = null;
    for (let i = 0; i < 20 && !built; i++) {
      built = await trips.activeForOrder(order.id);
      if (!built) await new Promise((r) => setTimeout(r, 100));
    }
    const trip =
      built ??
      (await trips.createForOrders({
        cityId: CITY,
        vertical: 'errand',
        orders: [{ orderId: order.id }],
        stops: [
          { orderId: order.id, type: 'pickup', zoneKey: SHOPS.zoneKey, target: SHOPS.pin },
          { orderId: order.id, type: 'dropoff', zoneKey: HOME.zoneKey, target: HOME.pin },
        ],
      }));
    await dispatch.request({ tripId: trip.id, cityId: CITY, vertical: 'errand', zoneId: SHOPS.zoneKey, pickup: SHOPS.pin, dropoffZoneId: HOME.zoneKey, cashIqd: order.totalIqd }).catch(() => undefined);
    const open = await dispatch.openOffer(p.personId, CITY);
    const offerId = open?.offer.id ?? (await dispatch.override(dispatcher, { tripId: trip.id, driverId: p.personId, reason: 'demo', force: true })).offerId;
    await dispatch.respond({ personId: p.personId, sessionId: 'demo' }, { offerId, accept: true });
    if (query.step === 'at_shops') {
      const mine = (await trips.forDriver(p.personId)).find((t) => t.orders.some((o) => o.orderId === order.id)) ?? trip;
      const pickup = mine.stops.find((s) => s.type === 'pickup');
      await dispatch.presence.heartbeat(p.personId, SHOPS.pin).catch(() => undefined);
      await trips.arrive(mine.id, pickup.id, p.personId, { pin: SHOPS.pin });
    }
    demo.json(res, 200, { tripId: trip.id, orderId: order.id });
  });
}
