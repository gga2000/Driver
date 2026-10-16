// Taxi/tuktuk safety (ride step 3; docs/api/ride-safety.md), on the real trips/chat path.
//
//   POST /demo/ride-safety?who=tuktuk&step=to_pickup|at_pickup
//        an accepted tuktuk ride with a night ride's 4-digit trip code (s1), by day too: the job says
//        «بالليل: يحتاج رمز من الراكب» and «الراكب صعد» opens the code pad. The answer carries the code
//        the rider would read out ({ startCode }) — type it, or a wrong one to see the refusal (five
//        wrong ones put a row on the Console safety strip).
//   POST /demo/ride-safety?who=tuktuk&step=lost_item
//        a finished ride whose rider asked «نسيت غرض بالسيارة؟» (s7): home shows the reopened chat.
const PICKUP = { zoneKey: 'hashimi', pin: { lat: 32.8968, lng: 45.0662 } };
const DROPOFF = { zoneKey: 'mahdood_2', pin: { lat: 32.9165, lng: 45.0585 } };

export default async function register(demo) {
  const { services, CITY } = demo;
  const { orders, trips, dispatch } = services;
  const dispatcher = { personId: 'demo-dispatcher', sessionId: 'demo' };
  const buyer = () => demo.people.get('buyer').personId;
  const { ORDERS_REPOSITORY, newStartCode } = await demo.load('modules/orders/index.js');
  const { ChatService } = await demo.load('modules/chat/index.js');
  const repo = demo.app.get(ORDERS_REPOSITORY);
  const chat = demo.app.get(ChatService);

  async function freeUp(personId) {
    for (let i = 0, open = await dispatch.openOffer(personId, CITY); open && i < 5; i++, open = await dispatch.openOffer(personId, CITY)) {
      await dispatch.respond({ personId, sessionId: 'demo' }, { offerId: open.offer.id, accept: false }).catch(() => undefined);
    }
    for (const t of await trips.forDriver(personId)) await trips.cancel(t.id, 'platform', 'demo-dispatcher', 'demo_reset').catch(() => undefined);
    if (!(await dispatch.presence.get(personId))) await demo.online(personId, PICKUP.pin, 'tuktuk');
  }

  /** A tuktuk ride from the buyer, accepted by him; with `night` it carries a trip code. */
  async function acceptedRide(personId, night) {
    const ride = await orders.place(buyer(), { cityId: CITY, type: 'ride', rideVertical: 'tuktuk', pickup: PICKUP, dropoff: DROPOFF });
    // By day a ride has no code: give it the one a night ride is placed with (in-memory record only).
    const startCode = night ? ((await orders.startCodeOf(ride.id)) ?? newStartCode()) : null;
    if (startCode) await repo.update(ride.id, { startCode });
    const trip = await trips.activeForOrder(ride.id);
    const { offerId } = await dispatch.override(dispatcher, { tripId: trip.id, driverId: personId, reason: 'demo', force: true });
    await dispatch.respond({ personId, sessionId: 'demo' }, { offerId, accept: true });
    const stops = (await trips.get(trip.id)).stops;
    return { orderId: ride.id, tripId: trip.id, startCode, pickup: stops.find((s) => s.type === 'pickup'), drop: stops.find((s) => s.type === 'dropoff') };
  }

  demo.route('/demo/ride-safety', async ({ res, query }) => {
    const p = demo.who(query);
    const step = query.step ?? 'at_pickup';
    await freeUp(p.personId);
    const r = await acceptedRide(p.personId, step !== 'lost_item');
    if (step === 'to_pickup') return demo.json(res, 200, { step, orderId: r.orderId, tripId: r.tripId, startCode: r.startCode });
    await dispatch.presence.heartbeat(p.personId, PICKUP.pin).catch(() => undefined);
    await trips.arrive(r.tripId, r.pickup.id, p.personId, { pin: PICKUP.pin });
    if (step === 'at_pickup') return demo.json(res, 200, { step, orderId: r.orderId, tripId: r.tripId, startCode: r.startCode });
    // lost_item: the whole ride, then the rider asks about something he left in the car.
    // After dark the server gives every ride a trip code; the rider reads it out at the door.
    const code = (await orders.startCodeOf(r.orderId)) ?? undefined;
    await trips.completeStop(r.tripId, r.pickup.id, p.personId, code ? { startCode: code } : {});
    await dispatch.presence.heartbeat(p.personId, DROPOFF.pin).catch(() => undefined);
    await trips.arrive(r.tripId, r.drop.id, p.personId, { pin: DROPOFF.pin });
    const order = await orders.get(r.orderId);
    await trips.completeStop(r.tripId, r.drop.id, p.personId, { handover: { cashCollectedIqd: order.totalIqd } });
    const asked = await chat.lostItem({ personId: buyer(), sessionId: 'demo' }, { orderId: r.orderId });
    demo.json(res, 200, { step, orderId: r.orderId, tripId: r.tripId, threadId: asked.threadId, openUntil: asked.openUntil });
  });
}
