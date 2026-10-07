// Ride step 4 (ideas x1 cold car in summer, x5 «عندي غراض»): a taxi driver whose car's AC ops
// confirmed, the weather the shift question reads, and rides whose rider carries shopping.
//
//   who=taxi   0770 111 0017  سيف علي  driver, car — a white تويوتا كورولا, AC and «عوائل» confirmed
//
//   POST /demo/weather?at=hot|cold|real    the AC / heating question's clock: a July (January) day from
//                                          13:00 Baghdad on, moving with real time; `real` = today's
//                                          weather (October: nothing is asked). Only the shift question
//                                          moves; dispatch keeps the real clock.
//   POST /demo/souq-offer?who=tuktuk|taxi  a ride for him whose rider said «عندي غراض» (bags and a gas
//                                          cylinder): the offer card reads «عنده غراض: …»
//   POST /demo/souq-job?who=tuktuk|taxi    the same ride accepted, on his way to the rider
import { Buffer } from 'node:buffer';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PICKUP = { zoneKey: 'hashimi', pin: { lat: 32.8968, lng: 45.0662 } };
const DROPOFF = { zoneKey: 'mahdood_2', pin: { lat: 32.9165, lng: 45.0585 } };
const NEAR_PICKUP = { lat: 32.8985, lng: 45.0652 };
// 14 July 2026 13:00 and 14 January 2026 13:00, Baghdad (UTC+3).
const WEATHER = { hot: Date.UTC(2026, 6, 14, 10), cold: Date.UTC(2026, 0, 14, 10) };

export default async function register(demo) {
  const { services, CITY } = demo;
  const { orders, trips, dispatch } = services;
  const dispatcher = { personId: 'demo-dispatcher', sessionId: 'demo' };
  const buyer = () => demo.people.get('buyer').personId;

  // He waits offline (checked in today): going online on a hot (cold) shift brings the question.
  const taxi = await demo.person({ key: 'taxi', phone: '07701110017', name: 'سيف علي', roles: ['driver'], vehicle: 'car', plate: 'واسط 61840', car: { model: 'تويوتا كورولا', colour: 'white', claimed: ['ac', 'family'], confirmed: ['ac', 'family'] } });

  const { DriverAccountService } = await demo.load('modules/driver-account/index.js');
  const { BLOB_STORE } = await demo.load('modules/places/index.js');
  const account = demo.app.get(DriverAccountService);
  const blobs = demo.app.get(BLOB_STORE);
  const selfie = await blobs.createUpload({ ownerId: taxi, contentType: 'image/jpeg', sizeBytes: JPEG.length });
  const u = new URL(selfie.uploadUrl, 'http://x');
  await blobs.receive({ id: selfie.uploadId, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig'), contentType: 'image/jpeg', bytes: JPEG });
  const challenge = await account.checkInChallenge({ personId: taxi, sessionId: 'demo' });
  await account.submitCheckIn({ personId: taxi, sessionId: 'demo' }, { challengeId: challenge.challengeId, uploadId: selfie.uploadId, livenessScore: 0.97 });

  const { ClimateChecks } = await demo.load('modules/dispatch/index.js');
  const climate = demo.app.get(ClimateChecks);
  const realClock = climate.clock;

  demo.route('/demo/weather', async ({ res, query }) => {
    const at = query.at ?? 'real';
    if (at === 'real') climate.clock = realClock;
    else {
      if (!(at in WEATHER)) throw new Error(`at=hot|cold|real, not ${at}`);
      const from = Date.now();
      climate.clock = { now: () => new Date(WEATHER[at] + (Date.now() - from)) };
    }
    demo.json(res, 200, { at, now: climate.clock.now().toISOString() });
  });

  async function clear(personId) {
    for (let i = 0, open = await dispatch.openOffer(personId, CITY); open && i < 5; i++, open = await dispatch.openOffer(personId, CITY)) {
      await dispatch.respond({ personId, sessionId: 'demo' }, { offerId: open.offer.id, accept: false }).catch(() => undefined);
    }
    for (const t of await trips.forDriver(personId)) await trips.cancel(t.id, 'platform', 'demo-dispatcher', 'demo_reset').catch(() => undefined);
  }

  /** A ride for him from الهاشمي to المحدود 2 whose rider carries bags and a gas cylinder; his open offer. */
  async function souqOffer(p) {
    await clear(p.personId);
    if (!(await dispatch.presence.get(p.personId))) await demo.online(p.personId, NEAR_PICKUP, p.vehicle);
    const vertical = p.vehicle === 'tuktuk' ? 'tuktuk' : 'taxi';
    const ride = await orders.place(buyer(), { cityId: CITY, type: 'ride', rideVertical: vertical, pickup: PICKUP, dropoff: DROPOFF, rideCargo: ['bags', 'gas'] });
    // Placing the ride built its trip and broadcast it (dispatch:ride-request); he is the nearest.
    const trip = await trips.activeForOrder(ride.id);
    if (!trip) throw new Error(`no trip for ${ride.id}`);
    const open = await dispatch.openOffer(p.personId, CITY);
    const offerId = open?.offer.id ?? (await dispatch.override(dispatcher, { tripId: trip.id, driverId: p.personId, reason: 'demo', force: true })).offerId;
    return { offerId, tripId: trip.id, orderId: ride.id };
  }

  demo.route('/demo/souq-offer', async ({ res, query }) => {
    demo.json(res, 200, await souqOffer(demo.who(query)));
  });

  demo.route('/demo/souq-job', async ({ res, query }) => {
    const p = demo.who(query);
    const made = await souqOffer(p);
    await dispatch.respond({ personId: p.personId, sessionId: 'demo' }, { offerId: made.offerId, accept: true });
    demo.json(res, 200, made);
  });
}
