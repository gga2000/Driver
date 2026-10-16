// Review #28: «مشاوير باچر» — rides booked for later, offered to drivers the evening before.
//
//   POST /demo/booked?who=tuktuk[&mine=1]   three tuktuk rides the buyer booked for tomorrow (7:00, 9:30 and
//                                           13:15; the day after when it is already 21:00 or later). The
//                                           evening offer is opened now — the demo can't wait for 18:00 —
//                                           9:30 asks for him by name («الزبون طلبك إنت», his hour alone),
//                                           the others wait for any driver until 22:00. With mine=1 he has
//                                           already taken 7:00 (his own, with «ما أگدر أجي»). → {tripIds}
//
// A new call cancels the rides the last one booked, so the screen always shows one fresh set.
const RIDES = [
  { key: 'early', hhmm: '07:00', pickup: { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } }, dropoff: { zoneKey: 'centre', pin: { lat: 32.9055, lng: 45.0605 } } },
  { key: 'fav', hhmm: '09:30', pickup: { zoneKey: 'hashimi', pin: { lat: 32.8968, lng: 45.0662 } }, dropoff: { zoneKey: 'mahdood_2', pin: { lat: 32.9165, lng: 45.0585 } } },
  { key: 'noon', hhmm: '13:15', pickup: { zoneKey: 'fidaa', pin: { lat: 32.9135, lng: 45.067 } }, dropoff: { zoneKey: 'hashimi', pin: { lat: 32.896, lng: 45.0675 } } },
];
const HOUR = 3_600_000;

export default async function register(demo) {
  const { services, CITY } = demo;
  const { orders, trips, dispatch } = services;
  const { DISPATCH_STORE } = await demo.load('modules/dispatch/dispatch.store.js');
  const { OfferOrchestrator } = await demo.load('modules/dispatch/offer.orchestrator.js');
  const { RIDE_HABITS_REPOSITORY } = await demo.load('modules/ride-habits/index.js');
  const store = demo.app.get(DISPATCH_STORE);
  const orchestrator = demo.app.get(OfferOrchestrator);
  let last = [];

  /** Opens a booked ride's evening offer now (demo only); the favourite keeps an hour to himself. */
  async function openNow(tripId) {
    const r = await store.getRequest(tripId);
    if (!r?.booked) throw new Error(`ride ${tripId} has no evening-before offer`);
    const now = Date.now();
    const favouriteUntil = r.booked.favouriteId ? Math.max(r.booked.favouriteUntil, now + HOUR) : now;
    r.booked = { ...r.booked, offerAt: Math.min(r.booked.offerAt, now), favouriteUntil };
    await store.saveRequest(r);
    await orchestrator.onTimer({ kind: 'booked_open', tripId, epoch: r.epoch, step: 0 });
  }

  demo.route('/demo/booked', async ({ res, query }) => {
    const p = demo.who(query);
    const buyer = demo.people.get('buyer').personId;
    for (const orderId of last) await orders.cancel(buyer, { orderId, reason: 'demo_reset' }).catch(() => undefined);
    last = [];
    if (!(await dispatch.presence.get(p.personId))) await demo.online(p.personId, { lat: 32.8985, lng: 45.0652 }, p.vehicle ?? 'tuktuk');
    const fav = await demo.app.get(RIDE_HABITS_REPOSITORY).addFavourite(buyer, p.personId, 'tuktuk', new Date());
    const local = new Date(Date.now() + 3 * HOUR);
    const ahead = local.getUTCHours() < 21 ? 1 : 2;
    const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + ahead)).toISOString().slice(0, 10);
    const tripIds = {};
    for (const ride of RIDES) {
      const order = await orders.place(buyer, {
        cityId: CITY,
        type: 'ride',
        rideVertical: 'tuktuk',
        pickup: ride.pickup,
        dropoff: ride.dropoff,
        paymentMethod: 'cash',
        scheduledFor: new Date(`${date}T${ride.hhmm}:00+03:00`),
        ...(ride.key === 'fav' ? { favouriteId: fav.id } : {}),
      });
      last.push(order.id);
      const trip = await trips.activeForOrder(order.id);
      await openNow(trip.id);
      tripIds[ride.key] = trip.id;
    }
    if (query.mine === '1') await dispatch.answerBookedJob(p.personId, tripIds.early, 'confirm');
    demo.json(res, 200, { tripIds });
  });
}
