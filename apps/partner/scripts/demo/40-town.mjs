// «المدينة حيّة» (live map home): a town with something going on around the courier.
//
// At start: kitchens cooking at three restaurants (one with food ready), a few orders placed 5–10
// minutes ago in four areas (each area shows only with 3 or more), and two groups of other couriers
// (a part of town shows a driver count only with 3 or more, from the picture before, so the counts
// appear on the second picture, 20 s after he goes online).
//
//   POST /demo/town/tick                 three new orders in الهاشمي (a «طلب جديد» ripple on the next
//                                        picture) and the next cooking kitchen turns «جاهز»
//   POST /demo/town/day?who=courier      four real deliveries done today (pickup → door), so «يومي»
//                                        draws his trail with what each one earned
const HOMES = {
  centre: { zoneKey: 'centre', pin: { lat: 32.9043, lng: 45.0612 } },
  street_30: { zoneKey: 'street_30', pin: { lat: 32.9101, lng: 45.0641 } },
  hashimi: { zoneKey: 'hashimi', pin: { lat: 32.8966, lng: 45.0682 } },
  fidaa: { zoneKey: 'fidaa', pin: { lat: 32.9131, lng: 45.0677 } },
  shukri: { zoneKey: 'shukri', pin: { lat: 32.8949, lng: 45.0551 } },
  saadouniya: { zoneKey: 'saadouniya', pin: { lat: 32.9009, lng: 45.0471 } },
  area_150: { zoneKey: 'area_150', pin: { lat: 32.9071, lng: 45.0709 } },
};

export default async function register(demo) {
  const { services, CITY } = demo;
  const { orders, trips, dispatch } = services;
  const { ORDERS_REPOSITORY } = await demo.load('modules/orders/index.js');
  const repo = demo.app.get(ORDERS_REPOSITORY);
  const buyer = () => demo.people.get('buyer').personId;
  const anyItem = (r) => {
    const ids = demo.restaurants[r].itemIds;
    return ids.get('pepsi') ?? [...ids.values()][0];
  };
  const keys = Object.keys(demo.restaurants);

  /** An order as a customer placed it `minAgo` minutes ago (the in-memory record is moved back in time). */
  async function placedAgo(r, home, minAgo) {
    const o = await orders.place(buyer(), { cityId: CITY, type: 'food', merchantOrgId: demo.restaurants[r].orgId, lines: [{ catalogItemId: anyItem(r), qty: 1 }], paymentMethod: 'cash', dropoff: home });
    const rec = repo.orders?.get(o.id);
    if (rec) rec.placedAt = new Date(Date.now() - minAgo * 60_000);
    return o;
  }

  /** A kitchen cooking: accepted `minAgo` minutes ago with `prep` minutes promised. */
  async function cooking(r, home, prep, minAgo, ready = false) {
    const o = await orders.place(buyer(), { cityId: CITY, type: 'food', merchantOrgId: demo.restaurants[r].orgId, lines: [{ catalogItemId: anyItem(r), qty: 2 }], paymentMethod: 'cash', dropoff: home });
    await orders.merchantAccept('demo-staff', { orderId: o.id, prepMinutes: prep });
    await orders.markPreparing('demo-staff', { orderId: o.id });
    const rec = repo.orders?.get(o.id);
    if (rec?.acceptedAt) {
      const back = minAgo * 60_000;
      rec.acceptedAt = new Date(rec.acceptedAt.getTime() - back);
      if (rec.promisedReadyAt) rec.promisedReadyAt = new Date(rec.promisedReadyAt.getTime() - back);
    }
    if (ready) await orders.markReady('demo-staff', { orderId: o.id });
    return o;
  }

  const [k1, k2, k3, k4] = [keys.find((k) => k === 'khalid') ?? keys[0], keys.find((k) => k === 'sham') ?? keys[1], keys.find((k) => k === 'musafir') ?? keys[2], keys.find((k) => k !== 'khalid' && k !== 'sham' && k !== 'musafir' && k !== 'haj_kareem') ?? keys[3]];
  // Kitchens: one nearly done, one halfway, one just started, one ready.
  await cooking(k1, HOMES.fidaa, 12, 8);
  await cooking(k2, HOMES.shukri, 16, 7);
  await cooking(k3, HOMES.area_150, 20, 1);
  if (k4) await cooking(k4, HOMES.saadouniya, 10, 10, true);
  else await cooking(k2, HOMES.saadouniya, 10, 10, true);

  // New orders by area, 5–10 minutes ago (the picture counts from 13 to 3 minutes back).
  const areas = [
    ['centre', 5],
    ['street_30', 4],
    ['fidaa', 3],
    ['shukri', 3],
    ['saadouniya', 2], // under 3: never shows
  ];
  let n = 0;
  for (const [zone, count] of areas) {
    for (let i = 0; i < count; i++) await placedAgo(keys[n++ % keys.length], HOMES[zone], 5 + (n % 5));
  }

  // Other couriers: four by the centre, three by الفداء (each group inside one ~300 m cell).
  const crowd = [
    ['07701110031', 'حسين جبار', { lat: 32.9041, lng: 45.0607 }],
    ['07701110032', 'أحمد صباح', { lat: 32.9044, lng: 45.0611 }],
    ['07701110033', 'منتظر كريم', { lat: 32.9047, lng: 45.0604 }],
    ['07701110034', 'ياسر عدنان', { lat: 32.9039, lng: 45.0615 }],
    ['07701110035', 'حيدر سلمان', { lat: 32.9128, lng: 45.0662 }],
    ['07701110036', 'مصطفى رعد', { lat: 32.9131, lng: 45.0668 }],
    ['07701110037', 'كرار ماجد', { lat: 32.9126, lng: 45.0671 }],
  ];
  for (const [phone, name, at] of crowd) {
    const id = await demo.person({ phone, name, roles: ['courier'], vehicle: 'bike' });
    await demo.online(id, at, 'bike');
  }

  demo.route('/demo/town/tick', async ({ res }) => {
    for (let i = 0; i < 3; i++) await placedAgo(keys[i % keys.length], HOMES.hashimi, 4);
    const next = (await repo.findMany({ cityId: CITY, states: ['preparing'] })).find((o) => o.type === 'food');
    if (next) await orders.markReady('demo-staff', { orderId: next.id });
    demo.json(res, 200, { ok: true });
  });

  demo.route('/demo/town/day', async ({ res, query }) => {
    const p = demo.who(query);
    const runs = [
      [k1, HOMES.fidaa],
      [k2, HOMES.shukri],
      [k3, HOMES.hashimi],
      [k1, HOMES.street_30],
    ];
    await dispatch.presence.online(p.personId, { cityId: CITY, at: HOMES.centre.pin, vehicle: p.vehicle ?? 'bike', tier: 'bronze' }).catch(() => undefined);
    const done = [];
    for (const [r, home] of runs) {
      const o = await orders.place(buyer(), { cityId: CITY, type: 'food', merchantOrgId: demo.restaurants[r].orgId, lines: [{ catalogItemId: anyItem(r), qty: 2 }], paymentMethod: 'cash', dropoff: home });
      await orders.merchantAccept('demo-staff', { orderId: o.id, prepMinutes: 5 });
      await orders.markPreparing('demo-staff', { orderId: o.id });
      const trip = await trips.activeForOrder(o.id);
      const { offerId } = await dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId: p.personId, reason: 'demo', force: true });
      await dispatch.respond({ personId: p.personId, sessionId: 'demo' }, { offerId, accept: true });
      const stops = (await trips.get(trip.id)).stops;
      const pickup = stops.find((s) => s.type === 'pickup');
      const drop = stops.find((s) => s.type === 'dropoff');
      await dispatch.presence.heartbeat(p.personId, pickup.target).catch(() => undefined);
      await trips.arrive(trip.id, pickup.id, p.personId, { pin: pickup.target });
      await orders.markReady('demo-staff', { orderId: o.id });
      await trips.completeStop(trip.id, pickup.id, p.personId);
      await dispatch.presence.heartbeat(p.personId, home.pin).catch(() => undefined);
      await trips.arrive(trip.id, drop.id, p.personId, { pin: home.pin });
      const view = await orders.get(o.id);
      await trips.completeStop(trip.id, drop.id, p.personId, { handover: { cashCollectedIqd: view.totalIqd } });
      done.push(trip.id);
    }
    demo.json(res, 200, { done });
  });
}
