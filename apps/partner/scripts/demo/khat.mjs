// خطوط, driver side (wave 2): today's run for the khat persona, through the real trips/khat modules.
//
//   who=khat  0770 111 0004  كرار عادل
//
//   Run: 3 pickup places × 2 children, then the school (المركز). At seed: الهاشمي done (زينب and حسن
//   on board), الشكري current (مريم waiting; علي reported absent: the guardian told him), زاكور next
//   (فاطمة، محمد). Plus a substitute offer: another driver's run (السعدونية → المركز) needs cover.
//
//   POST /demo/khat/seed?who=khat     → { tripId, substituteOfferId }
//   POST /demo/khat/finish?who=khat   → taps every remaining child in and out (the summary screen)
const MIN = 60_000;
const PLACES = {
  hashimi: [{ lat: 32.8962, lng: 45.0671 }, { lat: 32.8957, lng: 45.0682 }],
  shukri: [{ lat: 32.8946, lng: 45.0548 }, { lat: 32.8941, lng: 45.0539 }],
  zakur: [{ lat: 32.8872, lng: 45.0763 }, { lat: 32.8866, lng: 45.0771 }],
  school: { lat: 32.905, lng: 45.06 },
  saadouniya: [{ lat: 32.9006, lng: 45.0464 }, { lat: 32.9011, lng: 45.0471 }],
};
const CHILDREN = [
  ['hashimi', 0, 'زينب علي حسين'],
  ['hashimi', 1, 'حسن جاسم'],
  ['shukri', 0, 'مريم عادل'],
  ['shukri', 1, 'علي فاضل'],
  ['zakur', 0, 'فاطمة كاظم'],
  ['zakur', 1, 'محمد رضا'],
];

export default async function register(demo) {
  const { services, CITY } = demo;
  const { KhatService } = await demo.load('modules/khat/index.js');
  const khat = demo.app.get(KhatService);
  const guardian = await demo.person({ key: 'guardian', phone: '07803330301', name: 'أم زينب' });
  const otherDriver = await demo.person({ phone: '07803330302', name: 'رعد سلمان', roles: ['khat_driver'], vehicle: 'van' });
  const dispatcher = { personId: 'demo-dispatcher', sessionId: 'demo' };
  const state = { tripId: null };

  async function child(name) {
    return (await services.identity.registerChild({ personId: guardian }, { name })).childRef;
  }

  async function clearRuns(personId) {
    for (const t of await services.trips.forDriver(personId)) {
      if (t.vertical === 'khat') await services.trips.cancel(t.id, 'platform', 'demo-dispatcher', 'demo_reset').catch(() => undefined);
    }
    // A finished run whose car was never checked stays on his list (and opens first): check it off.
    for (const t of await services.trips.completedForDriver(personId, new Date(Date.now() - 24 * 60 * MIN))) {
      if (t.vertical === 'khat') await khat.confirmEmptyCar({ personId, sessionId: 'demo' }, { tripId: t.id }).catch(() => undefined);
    }
  }

  async function seed(query) {
    const p = demo.who({ who: query.who ?? 'khat' });
    const driver = { personId: p.personId, sessionId: 'demo' };
    await clearRuns(p.personId);
    const now = Date.now();
    const w = (m) => new Date(now + m * MIN);
    const refs = [];
    for (const [, , name] of CHILDREN) refs.push(await child(name));
    const offsets = { hashimi: -25, shukri: -3, zakur: 12 };
    const stops = CHILDREN.map(([place, i], k) => ({ type: 'pickup', zoneKey: place, target: PLACES[place][i], childRef: refs[k], windowStart: w(offsets[place]), windowEnd: w(offsets[place] + 5) }));
    for (const ref of refs) stops.push({ type: 'dropoff', zoneKey: 'centre', target: PLACES.school, childRef: ref, windowStart: w(30), windowEnd: w(40) });
    const trip = await services.trips.createForOrders({ cityId: CITY, vertical: 'khat', orders: [], stops });
    await services.dispatch.setPolicy(dispatcher, { cityId: CITY, vertical: 'khat', suggestOnly: true }).catch(() => undefined);
    await demo.online(p.personId, PLACES.hashimi[0], 'van');
    await services.dispatch.request({ tripId: trip.id, cityId: CITY, vertical: 'khat', zoneId: 'hashimi', pickup: PLACES.hashimi[0], dropoffZoneId: 'centre' });
    const { offerId } = await services.dispatch.override(dispatcher, { tripId: trip.id, driverId: p.personId, reason: 'demo: his route', force: true });
    await services.dispatch.respond(driver, { offerId, accept: true });
    const s = (await services.trips.get(trip.id)).stops;
    await khat.tapIn(driver, { tripId: trip.id, stopId: s[0].id, pin: PLACES.hashimi[0] });
    await khat.tapIn(driver, { tripId: trip.id, stopId: s[1].id, pin: PLACES.hashimi[1] });
    await khat.reportAbsence(driver, { tripId: trip.id, childRef: refs[3], reason: 'guardian_notice' });
    state.tripId = trip.id;

    // Another driver's run today needs a substitute: offered to him (dispatcher override).
    const subRefs = [];
    for (const name of ['سجى أحمد', 'يوسف حيدر', 'رقية سالم', 'أمير كريم']) subRefs.push(await child(name));
    const subStops = subRefs.map((ref, k) => ({ type: 'pickup', zoneKey: 'saadouniya', target: PLACES.saadouniya[k % 2], childRef: ref, windowStart: w(50 + k), windowEnd: w(55 + k) }));
    for (const ref of subRefs) subStops.push({ type: 'dropoff', zoneKey: 'centre', target: PLACES.school, childRef: ref, windowStart: w(75), windowEnd: w(85) });
    const sub = await services.trips.createForOrders({ cityId: CITY, vertical: 'khat', orders: [], stops: subStops });
    let substituteOfferId = null;
    try {
      await services.dispatch.request({ tripId: sub.id, cityId: CITY, vertical: 'khat', zoneId: 'saadouniya', pickup: PLACES.saadouniya[0], dropoffZoneId: 'centre', routeDriverId: otherDriver, departureAt: w(50), eligibleDriverIds: [p.personId] });
      substituteOfferId = (await services.dispatch.override(dispatcher, { tripId: sub.id, driverId: p.personId, reason: 'demo: substitute', force: true })).offerId;
      // Offline again: the substitute offer waits on the run screen (khat.substituteOffers), not as a ring.
      await services.dispatch.presence.offline(p.personId);
    } catch (err) {
      console.log(`DEMO khat substitute offer not created: ${err?.message ?? err}`);
    }
    return { tripId: trip.id, substituteOfferId };
  }

  async function finish(query) {
    const p = demo.who({ who: query.who ?? 'khat' });
    const driver = { personId: p.personId, sessionId: 'demo' };
    const run = (await khat.todayRun(driver, {})).trips.find((t) => t.tripId === state.tripId);
    if (!run) return { finished: false };
    for (const s of run.stops.filter((x) => x.type === 'pickup' && x.child && !x.absent && !x.tappedInAt)) await khat.tapIn(driver, { tripId: run.tripId, stopId: s.stopId });
    for (const s of run.stops.filter((x) => x.type === 'dropoff' && x.child && !x.absent && !x.tappedOutAt)) await khat.tapOut(driver, { tripId: run.tripId, stopId: s.stopId, pin: PLACES.school });
    return { finished: true };
  }

  await seed({ who: 'khat' }).catch((err) => console.log(`DEMO khat seed failed: ${err?.stack ?? err}`));

  demo.route('/demo/khat/seed', async ({ res, query }) => demo.json(res, 200, await seed(query)));
  demo.route('/demo/khat/finish', async ({ res, query }) => demo.json(res, 200, await finish(query)));
}
