// Core work hooks (wave 1): live offers and active jobs on the real dispatch/trips path.
//
//   POST /demo/offer?who=courier&kind=food     a cash order from مطعم خالد, offered to him (dispatcher override)
//   POST /demo/offer?who=courier&kind=batch    he is on a job; a second order on his way is offered
//   POST /demo/offer?who=tuktuk&kind=ride      a tuktuk ride broadcast in waves (he is the nearest)
//   POST /demo/job?who=courier&step=…          an accepted food job at: to_pickup · at_pickup ·
//                                              to_dropoff · at_dropoff · unreachable
//        …&door=1                              to the customer's saved home with a door photo and note,
//                                              never delivered to before ("اتصل قبل لا توصل", maps f6/a5)
//        …&tender=25000                        the customer said "راح أدفع بـ 25,000" at checkout
//                                              ("الخردة علينا": the job card and the door helper show it)
//   POST /demo/online?who=…                    puts him online where his persona works
//   POST /demo/clear?who=…                     cancels his open jobs and takes him offline
//
// At start food dispatch is set to suggest-only (nothing reaches drivers by itself) and three
// orders wait at مشويات الحاج كريم in the centre, so the waiting screen reads "الطلب عالي بالمركز".
import { doorPng } from '../door-photo.mjs';

const KHALID_PIN = { lat: 32.9095, lng: 45.0635 };
const HOMES = {
  zakur: { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } },
  hashimi: { zoneKey: 'hashimi', pin: { lat: 32.896, lng: 45.0675 } },
  fidaa: { zoneKey: 'fidaa', pin: { lat: 32.9135, lng: 45.067 } },
  zakurNorth: { zoneKey: 'zakur', pin: { lat: 32.8892, lng: 45.0741 } },
};
const NEAR_KHALID = { lat: 32.9138, lng: 45.0592 };
const HOME_BASE = { courier: NEAR_KHALID, tuktuk: { lat: 32.8985, lng: 45.0652 }, intercity: { lat: 32.9105, lng: 45.0505 }, khat: { lat: 32.901, lng: 45.058 } };

export default async function register(demo) {
  const { services, CITY } = demo;
  const { orders, trips, dispatch } = services;
  const dispatcher = { personId: 'demo-dispatcher', sessionId: 'demo' };
  const buyer = () => demo.people.get('buyer').personId;
  const item = (r, key) => demo.restaurants[r].itemIds.get(key);

  const { SavedPlacesService, BLOB_STORE } = await demo.load('modules/places/index.js');
  const places = demo.app.get(SavedPlacesService);
  const blobs = demo.app.get(BLOB_STORE);

  /** The buyer's saved home in الزكور with a door photo and a standing note (made once). */
  let home = null;
  async function savedHome() {
    if (home) return home;
    const bytes = doorPng();
    const ticket = await blobs.createUpload({ ownerId: buyer(), contentType: 'image/png', sizeBytes: bytes.length });
    const u = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'image/png', bytes });
    const saved = await places.save(buyer(), { cityId: CITY, label: 'home', name: 'البيت', pin: HOMES.zakur.pin, note: 'بيت طابقين، الباب الأخضر جوه الدربونة الثانية', photoIds: [ticket.uploadId], shareWithHousehold: false, clientRef: 'demo-home' });
    home = { ...HOMES.zakur, placeId: saved.id };
    return home;
  }

  let topUps = 0;
  async function placeAccepted(restaurant, lines, dropoff, prepMinutes = 12, paymentMethod = 'cash', note, statedTenderIqd) {
    // A prepaid (wallet) order needs a wallet that covers it (wallet_insufficient): the buyer topped up.
    if (paymentMethod === 'wallet') {
      const account = demo.Accounts.customer(buyer());
      await services.ledger.recordAll({ id: `demo:topup:buyer:${++topUps}:${Date.now()}`, kind: 'money', occurredAt: new Date(), refs: {}, lines: [{ type: 'credit_issued', amount: 50_000, fromAccount: demo.Accounts.bank, toAccount: account, memo: 'topup:agent' }], controls: [{ account, net: 50_000 }] });
    }
    const placed = await orders.place(buyer(), { cityId: CITY, type: 'food', merchantOrgId: demo.restaurants[restaurant].orgId, lines, paymentMethod, dropoff, ...(note ? { note } : {}), ...(statedTenderIqd ? { statedTenderIqd } : {}) });
    await orders.merchantAccept('demo-staff', { orderId: placed.id, prepMinutes });
    await orders.markPreparing('demo-staff', { orderId: placed.id });
    const trip = await trips.activeForOrder(placed.id);
    if (!trip) throw new Error(`no trip for ${placed.id}`);
    return { order: placed, trip };
  }

  async function offerTo(tripId, driverId) {
    const { offerId } = await dispatch.override(dispatcher, { tripId, driverId, reason: 'demo', force: true });
    return offerId;
  }

  async function ensureOnline(key, personId, vehicle) {
    if (!(await dispatch.presence.get(personId))) await demo.online(personId, HOME_BASE[key] ?? NEAR_KHALID, vehicle);
  }

  /** An accepted food job for him, moved to `step`. */
  async function job(personId, step, tender, door) {
    const { order, trip } = await placeAccepted(
      'khalid',
      [
        { catalogItemId: item('khalid', 'liver_plate'), qty: 2 },
        { catalogItemId: item('khalid', 'salad'), qty: 1 },
        { catalogItemId: item('khalid', 'pepsi'), qty: 2 },
      ],
      door ? await savedHome() : HOMES.zakur,
      step === 'to_pickup' ? 14 : 6,
      'cash',
      'باب أخضر يم جامع الرسول، اتصل من توصل',
      tender,
    );
    const offerId = await offerTo(trip.id, personId);
    await dispatch.respond({ personId, sessionId: 'demo' }, { offerId, accept: true });
    const stops = (await trips.get(trip.id)).stops;
    const pickup = stops.find((s) => s.type === 'pickup');
    const drop = stops.find((s) => s.type === 'dropoff');
    if (step === 'to_pickup') return { tripId: trip.id, orderId: order.id };
    await dispatch.presence.heartbeat(personId, KHALID_PIN).catch(() => undefined);
    await trips.arrive(trip.id, pickup.id, personId, { pin: KHALID_PIN });
    if (step === 'at_pickup') return { tripId: trip.id, orderId: order.id };
    await orders.markReady('demo-staff', { orderId: order.id });
    await trips.completeStop(trip.id, pickup.id, personId);
    const mid = { lat: 32.8995, lng: 45.0702 };
    await dispatch.presence.heartbeat(personId, mid).catch(() => undefined);
    await trips.reportPosition(personId, { tripId: trip.id, pin: mid, at: new Date(), bearing: 150, speedKmh: 22 });
    if (step === 'to_dropoff') return { tripId: trip.id, orderId: order.id };
    await dispatch.presence.heartbeat(personId, HOMES.zakur.pin).catch(() => undefined);
    await trips.arrive(trip.id, drop.id, personId, { pin: HOMES.zakur.pin });
    if (step === 'unreachable') await trips.startUnreachable(trip.id, drop.id, personId);
    return { tripId: trip.id, orderId: order.id };
  }

  async function clear(personId) {
    for (let i = 0, open = await dispatch.openOffer(personId, CITY); open && i < 5; i++, open = await dispatch.openOffer(personId, CITY)) {
      await dispatch.respond({ personId, sessionId: 'demo' }, { offerId: open.offer.id, accept: false }).catch(() => undefined);
    }
    for (const t of await trips.forDriver(personId)) await trips.cancel(t.id, 'platform', 'demo-dispatcher', 'demo_reset').catch(() => undefined);
    await dispatch.presence.offline(personId);
  }

  // Waiting jobs in the centre for the demand hint; food goes suggest-only so they stay waiting.
  await dispatch.setPolicy(dispatcher, { cityId: CITY, vertical: 'food', suggestOnly: true });
  for (let i = 0; i < 3; i++) {
    await placeAccepted('haj_kareem', [{ catalogItemId: item('haj_kareem', 'rice_qeema'), qty: 2 }], Object.values(HOMES)[i], 1, 'cash');
  }

  demo.route('/demo/online', async ({ res, query }) => {
    const p = demo.who(query);
    await demo.online(p.personId, HOME_BASE[query.who] ?? NEAR_KHALID, p.vehicle ?? 'bike');
    demo.json(res, 200, { personId: p.personId, online: true });
  });

  demo.route('/demo/clear', async ({ res, query }) => {
    const p = demo.who(query);
    await clear(p.personId);
    demo.json(res, 200, { personId: p.personId, cleared: true });
  });

  demo.route('/demo/job', async ({ res, query }) => {
    const p = demo.who(query);
    const step = query.step ?? 'to_pickup';
    await clear(p.personId);
    await ensureOnline(query.who, p.personId, p.vehicle ?? 'bike');
    const tender = query.tender ? Number(query.tender) : undefined;
    demo.json(res, 200, { step, ...(await job(p.personId, step, tender, query.door === '1')) });
  });

  demo.route('/demo/offer', async ({ res, query }) => {
    const p = demo.who(query);
    const kind = query.kind ?? 'food';
    if (kind !== 'batch') await clear(p.personId);
    await ensureOnline(query.who, p.personId, p.vehicle ?? 'bike');

    if (kind === 'ride') {
      const ride = await orders.place(buyer(), {
        cityId: CITY,
        type: 'ride',
        rideVertical: 'tuktuk',
        pickup: { zoneKey: 'hashimi', pin: { lat: 32.8968, lng: 45.0662 } },
        dropoff: { zoneKey: 'mahdood_2', pin: { lat: 32.9165, lng: 45.0585 } },
      });
      // Placing the ride built its trip and broadcast it (dispatch:ride-request).
      const trip = (await trips.activeForOrder(ride.id)) ?? await trips.createForOrders({
        cityId: CITY,
        vertical: 'tuktuk',
        orders: [{ orderId: ride.id }],
        stops: [
          { orderId: ride.id, type: 'pickup', zoneKey: 'hashimi', target: { lat: 32.8968, lng: 45.0662 } },
          { orderId: ride.id, type: 'dropoff', zoneKey: 'mahdood_2', target: { lat: 32.9165, lng: 45.0585 } },
        ],
      });
      await dispatch.request({ tripId: trip.id, cityId: CITY, vertical: 'tuktuk', zoneId: 'hashimi', pickup: { lat: 32.8968, lng: 45.0662 }, dropoffZoneId: 'mahdood_2', cashIqd: ride.totalIqd });
      const open = await dispatch.openOffer(p.personId, CITY);
      const offerId = open?.offer.id ?? (await offerTo(trip.id, p.personId));
      return demo.json(res, 200, { kind, offerId, tripId: trip.id });
    }

    if (kind === 'batch' && (await trips.forDriver(p.personId)).length === 0) await job(p.personId, 'to_pickup');
    const { trip } = await placeAccepted(
      'khalid',
      kind === 'batch'
        ? [{ catalogItemId: item('khalid', 'liver_plate'), qty: 1 }, { catalogItemId: item('khalid', 'salad'), qty: 1 }]
        : [
            { catalogItemId: item('khalid', 'khalid_mix'), qty: 1 },
            { catalogItemId: item('khalid', 'pepsi'), qty: 2 },
          ],
      kind === 'batch' ? HOMES.zakurNorth : HOMES.zakur,
      9,
      kind === 'batch' ? 'wallet' : 'cash',
    );
    const offerId = await offerTo(trip.id, p.personId);
    demo.json(res, 200, { kind, offerId, tripId: trip.id });
  });
}
