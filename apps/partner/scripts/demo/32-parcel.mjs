// طرود on the courier's side (parcels.courier.*): a parcel sent by the buyer to «علي», carried by him.
//
//   POST /demo/parcel?who=courier&step=…      a parcel job at: to_pickup · at_pickup · to_dropoff · at_dropoff
//        …&payer=sender                        the sender paid (the door says «الأجرة مدفوعة»); default the
//                                              receiver pays at the door («استلم … دينار من المستلم»)
//   Answers { tripId, orderId, parcelId, pin } — the receipt code the receiver would read out.
import { doorPng } from '../door-photo.mjs';

const PICKUP = { zoneKey: 'hashimi', pin: { lat: 32.896, lng: 45.0675 } };
const DOOR = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
const MID = { lat: 32.8925, lng: 45.072 };

export default async function register(demo) {
  const { services, CITY } = demo;
  const { trips, dispatch } = services;
  const dispatcher = { personId: 'demo-dispatcher', sessionId: 'demo' };
  const { ParcelsService } = await demo.load('modules/parcels/index.js');
  const { BLOB_STORE } = await demo.load('modules/places/index.js');
  const parcels = demo.app.get(ParcelsService);
  const blobs = demo.app.get(BLOB_STORE);

  /** The sender's photo of the parcel, stored as his upload (as the app's ticket + PUT would). */
  async function senderPhoto(ownerId) {
    const bytes = doorPng();
    const ticket = await blobs.createUpload({ ownerId, contentType: 'image/png', sizeBytes: bytes.length });
    const u = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'image/png', bytes });
    return ticket.uploadId;
  }

  async function clear(personId) {
    for (let i = 0, open = await dispatch.openOffer(personId, CITY); open && i < 5; i++, open = await dispatch.openOffer(personId, CITY)) {
      await dispatch.respond({ personId, sessionId: 'demo' }, { offerId: open.offer.id, accept: false }).catch(() => undefined);
    }
    for (const t of await trips.forDriver(personId)) await trips.cancel(t.id, 'platform', 'demo-dispatcher', 'demo_reset').catch(() => undefined);
  }

  demo.route('/demo/parcel', async ({ res, query }) => {
    const p = demo.who(query);
    const step = query.step ?? 'at_dropoff';
    await clear(p.personId);
    if (!(await dispatch.presence.get(p.personId))) await demo.online(p.personId, PICKUP.pin, p.vehicle ?? 'bike');
    const sender = { personId: demo.people.get('buyer').personId, sessionId: 'demo' };
    const quote = await parcels.quote(sender, { cityId: CITY, pickup: PICKUP, dropZoneKey: DOOR.zoneKey, size: 'small' });
    const sent = await parcels.send(sender, {
      cityId: CITY,
      clientRequestId: `demo-parcel-${Date.now()}`,
      what: 'ملابس العيد',
      size: 'small',
      declaredValueIqd: 35_000,
      photoUploadId: await senderPhoto(sender.personId),
      recipient: { from: 'typed', name: 'علي حسين', phone: '+9647801234567' },
      pickup: PICKUP,
      door: { by: 'sender', dropoff: DOOR },
      payer: query.payer === 'sender' ? 'sender' : 'receiver',
      fareIqd: quote.fareIqd,
    });
    // Dispatch builds no courier trip for a parcel order yet: the demo builds it as the server will.
    const trip =
      (await trips.activeForOrder(sent.orderId)) ??
      (await trips.createForOrders({
        cityId: CITY,
        vertical: 'parcel',
        orders: [{ orderId: sent.orderId }],
        stops: [
          { orderId: sent.orderId, type: 'pickup', zoneKey: PICKUP.zoneKey, target: PICKUP.pin },
          { orderId: sent.orderId, type: 'dropoff', zoneKey: DOOR.zoneKey, target: DOOR.pin },
        ],
      }));
    await dispatch.request({ tripId: trip.id, cityId: CITY, vertical: 'parcel', zoneId: PICKUP.zoneKey, pickup: PICKUP.pin, dropoffZoneId: DOOR.zoneKey, cashIqd: quote.fareIqd });
    const open = await dispatch.openOffer(p.personId, CITY);
    const offerId = open?.offer.tripId === trip.id ? open.offer.id : (await dispatch.override(dispatcher, { tripId: trip.id, driverId: p.personId, reason: 'demo', force: true })).offerId;
    await dispatch.respond({ personId: p.personId, sessionId: 'demo' }, { offerId, accept: true });
    const stops = (await trips.get(trip.id)).stops;
    const pickup = stops.find((s) => s.type === 'pickup');
    const drop = stops.find((s) => s.type === 'dropoff');
    const out = { step, tripId: trip.id, orderId: sent.orderId, parcelId: sent.id, pin: sent.pin };
    if (step === 'to_pickup') return demo.json(res, 200, out);
    await dispatch.presence.heartbeat(p.personId, PICKUP.pin).catch(() => undefined);
    await trips.arrive(trip.id, pickup.id, p.personId, { pin: PICKUP.pin });
    if (step === 'at_pickup') return demo.json(res, 200, out);
    await trips.completeStop(trip.id, pickup.id, p.personId);
    await dispatch.presence.heartbeat(p.personId, MID).catch(() => undefined);
    await trips.reportPosition(p.personId, { tripId: trip.id, pin: MID, at: new Date(), bearing: 150, speedKmh: 22 });
    if (step === 'to_dropoff') return demo.json(res, 200, out);
    // At the door: his last fix is the receiver's pin, so «رفضت تستلم» passes the 150 m check.
    await dispatch.presence.heartbeat(p.personId, DOOR.pin).catch(() => undefined);
    await trips.reportPosition(p.personId, { tripId: trip.id, pin: DOOR.pin, at: new Date(), bearing: 150, speedKmh: 0 });
    await trips.arrive(trip.id, drop.id, p.personId, { pin: DOOR.pin });
    demo.json(res, 200, out);
  });
}
