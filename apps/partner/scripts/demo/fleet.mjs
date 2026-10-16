// Fleet owner seed (wave 2): a fleet org with 4 vehicles and 5 drivers, a week of earnings in the
// ledger (fares less the platform take), cash in hand, live states and expiring documents.
//
//   who=fleet   0770 111 0005  سجاد الربيعي  fleet_owner of "أسطول الربيعي"
//
//   drivers (all `driver` role, numbers 0770 111 005x):
//     حسين علي     tuktuk  واسط 40211  on a job (a tuktuk ride via the dispatcher override)
//     مصطفى كريم   saloon  واسط 52870  online, 58,000 cash (near his cap)
//     أحمد جبار    tuktuk  واسط 40398  online, over his cash cap
//     زيد ناصر     van     واسط 61104  offline, licence expires in 9 days
//     علي رزاق     —                   offline, no vehicle, insurance expired
//
//   Consent (review 2026-10-04 #2): each of them accepted the fleet's invite in his app; one more number
//   (0770 111 0057) was invited and has not answered ("بانتظار موافقة السايق" on the owner's dashboard).
//
//   who=f_invitee  0770 111 0056  حيدر سلمان, tuktuk driver, checked in: سجاد's invite waits for him
//                  (home banner + the full card on الحساب; accept/decline through fleet.respondInvite)
//   who=f_mustafa  0770 111 0052  drives with the fleet: الحساب shows "تشتغل ويا أسطول الربيعي"
//
//   GET /demo/fleet/info   → { fleetOrgId, ownerId, drivers: {key: personId}, vehicles: [...] }
//   POST /demo/fleet/live  → refreshes the online drivers' presence (it lives 90 s)
//   POST /demo/fleet/invite-reset → the invitee's invite is pending again (after an accept/decline)
import { Buffer } from 'node:buffer';

const DAY = 86_400_000;
const LOCAL = 3 * 3_600_000;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

/** Deterministic pseudo-random numbers so every demo boot looks the same. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export default async function register(demo) {
  const { services, Accounts, CITY } = demo;
  const { FleetService, FLEET_REPOSITORY } = await demo.load('modules/fleet/index.js');
  const { DriverAccountService } = await demo.load('modules/driver-account/index.js');
  const { BLOB_STORE } = await demo.load('modules/places/index.js');
  const fleet = demo.app.get(FleetService);
  const accounts = demo.app.get(DriverAccountService);
  const blobs = demo.app.get(BLOB_STORE);

  const ownerId = await demo.person({ key: 'fleet', phone: '07701110005', name: 'سجاد الربيعي' });
  const org = await services.orgs.create({
    type: 'fleet',
    name: 'أسطول الربيعي',
    cityId: CITY,
    ownerId,
  });
  await services.identity.grantRole(
    { personId: 'system:demo' },
    { personId: ownerId, kind: 'fleet_owner', orgId: org.id },
  );
  const owner = { personId: ownerId, sessionId: 'demo' };

  const specs = [
    { key: 'f_hussein', phone: '07701110051', name: 'حسين علي', vehicle: 'tuktuk', plate: 'واسط 40211', seats: 3, model: 'باجاج', colour: 'red', perDay: [7, 12], fare: [1500, 3000], state: 'on_job', at: { lat: 32.9128, lng: 45.0668 } },
    { key: 'f_mustafa', phone: '07701110052', name: 'مصطفى كريم', vehicle: 'car', plate: 'واسط 52870', seats: 4, model: 'تويوتا كورولا', colour: 'white', claimed: ['ac', 'family'], confirmed: ['ac'], perDay: [5, 9], fare: [3000, 6000], state: 'online', cash: 58_000, at: { lat: 32.9095, lng: 45.0635 } },
    { key: 'f_ahmed', phone: '07701110053', name: 'أحمد جبار', vehicle: 'tuktuk', plate: 'واسط 40398', seats: 3, perDay: [6, 10], fare: [1500, 2500], state: 'online', cash: 84_000, at: { lat: 32.9005, lng: 45.0465 } },
    { key: 'f_zaid', phone: '07701110054', name: 'زيد ناصر', vehicle: 'van', plate: 'واسط 61104', seats: 7, model: 'كيا بونغو', colour: 'grey', perDay: [2, 4], fare: [6000, 12000], state: 'offline', restToday: true },
    { key: 'f_ali', phone: '07701110055', name: 'علي رزاق', vehicle: null, perDay: [0, 3], fare: [2000, 4000], state: 'offline', restToday: true },
  ];

  // Vehicles first (the add-driver path returns rows that read them).
  const vehicles = {};
  for (const s of specs) {
    if (!s.vehicle) continue;
    vehicles[s.key] = await fleet.addVehicle(owner, { plate: s.plate, vehicleClass: s.vehicle, seats: s.seats, ...(s.model ? { model: s.model, colour: s.colour } : {}) });
  }

  const drivers = {};
  for (const s of specs) {
    const id = await demo.person({ key: s.key, phone: s.phone, name: s.name, roles: ['driver'], vehicle: s.vehicle, plate: s.plate ?? null, car: { model: s.model, colour: s.colour, confirmed: s.confirmed } });
    await fleet.addDriver(owner, { phone: s.phone });
    // He said yes in his Partner app: only then does the owner see him (and may give him a vehicle).
    await fleet.respondInvite(
      { personId: id, sessionId: 'demo' },
      { fleetOrgId: org.id, accept: true },
    );
    drivers[s.key] = id;
    if (vehicles[s.key]) await fleet.assignDriver(owner, { vehicleId: vehicles[s.key].vehicleId, driverId: id });
    // Ride step 3: what he says his car offers, and what the car check confirmed.
    if (vehicles[s.key] && s.claimed) await demo.services.fleetRepo.setFeatures(vehicles[s.key].vehicleId, { features: s.claimed, featuresConfirmed: s.confirmed ?? [] }, new Date());
  }

  // They joined weeks ago (the owner sees earnings only from the day a driver accepted): the in-memory
  // links are back-dated so the week below shows.
  const fleetRepo = demo.app.get(FLEET_REPOSITORY);
  for (const row of fleetRepo.driverRows ?? [])
    if (row.fleetOrgId === org.id && row.acceptedAt)
      row.acceptedAt = new Date(Date.now() - 45 * DAY);

  // A week of fares (Sunday → now, Baghdad calendar), 10% platform take on each.
  const now = Date.now();
  const dayStart = Math.floor((now + LOCAL) / DAY) * DAY - LOCAL;
  const dow = new Date(now + LOCAL).getUTCDay();
  const weekStart = dayStart - dow * DAY;
  const groups = [];
  specs.forEach((s, si) => {
    const r = rng(1000 + si * 77);
    for (let d = 0; d <= dow; d++) {
      if (d === dow && s.restToday) continue;
      // Friday is quieter; the busiest days are Thursday and Saturday.
      const busy = d === 5 ? 0.6 : d === 4 || d === 6 ? 1.2 : 1;
      const n = Math.round((s.perDay[0] + r() * (s.perDay[1] - s.perDay[0])) * busy);
      for (let j = 0; j < n; j++) {
        const at = weekStart + d * DAY + (10 + (j * 11) / Math.max(n, 1) + r() * 0.8) * 3_600_000;
        if (at > now - 20 * 60_000) continue;
        const fare = Math.round((s.fare[0] + r() * (s.fare[1] - s.fare[0])) / 250) * 250;
        const take = Math.round(fare * 0.1 / 250) * 250;
        const orderId = `demo-fleet-${s.key}-${d}-${j}`;
        groups.push(
          demo.group(`demo:fleet:${s.key}:${d}:${j}`, new Date(at), [
            { type: 'fare', amount: fare, fromAccount: Accounts.customer('demo-rider'), toAccount: Accounts.driver(drivers[s.key]) },
            { type: 'commission_accrued', amount: take, fromAccount: Accounts.driver(drivers[s.key]), toAccount: Accounts.platform },
          ], { orderId }),
        );
      }
    }
    if (s.cash) {
      groups.push(demo.group(`demo:fleet:${s.key}:cash`, demo.hoursAgo(1.5), [{ type: 'cash_collected', amount: s.cash, fromAccount: Accounts.cash(drivers[s.key]), toAccount: Accounts.customer('demo-rider') }]));
    }
  });
  await services.ledger.recordAll(groups);

  // Documents: زيد's licence expires in 9 days; علي's insurance has lapsed; the rest are fine.
  async function doc(personId, kind, expiresAt) {
    const ticket = await blobs.createUpload({ ownerId: personId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
    const url = new URL(ticket.uploadUrl, 'http://local');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
    const d = await accounts.uploadDocument({ personId, sessionId: 'demo' }, { kind, uploadId: ticket.uploadId, expiresAt });
    await accounts.reviewDocument({ personId: 'system:demo', sessionId: 'demo' }, { documentId: d.id, decision: 'approve', expiresAt });
  }
  for (const s of specs) {
    const id = drivers[s.key];
    await doc(id, 'licence', new Date(now + (s.key === 'f_zaid' ? 9 : 400) * DAY));
    await doc(id, 'insurance', new Date(now + (s.key === 'f_ali' ? -2 : 200) * DAY)).catch(() => undefined);
  }

  // Live states: online drivers on the map; حسين on a tuktuk ride.
  for (const s of specs) if (s.state !== 'offline') await demo.online(drivers[s.key], s.at, s.vehicle);
  try {
    const buyer = demo.people.get('buyer').personId;
    const pickup = { zoneKey: 'fidaa', pin: { lat: 32.9132, lng: 45.0671 } };
    const dropoff = { zoneKey: 'zakur', pin: { lat: 32.887, lng: 45.0765 } };
    const ride = await services.orders.place(buyer, { cityId: CITY, type: 'ride', rideVertical: 'tuktuk', pickup, dropoff });
    // Placing the ride built its trip and broadcast it (dispatch:ride-request).
    const trip = (await services.trips.activeForOrder(ride.id)) ?? await services.trips.createForOrders({
      cityId: CITY,
      vertical: 'tuktuk',
      orders: [{ orderId: ride.id }],
      stops: [
        { orderId: ride.id, type: 'pickup', zoneKey: pickup.zoneKey, target: pickup.pin },
        { orderId: ride.id, type: 'dropoff', zoneKey: dropoff.zoneKey, target: dropoff.pin },
      ],
    });
    await services.dispatch.request({ tripId: trip.id, cityId: CITY, vertical: 'tuktuk', zoneId: pickup.zoneKey, pickup: pickup.pin, dropoffZoneId: dropoff.zoneKey, cashIqd: ride.totalIqd });
    const open = await services.dispatch.openOffer(drivers.f_hussein, CITY);
    const offerId = open?.offer.id ?? (await services.dispatch.override({ personId: 'demo-dispatcher', sessionId: 'demo' }, { tripId: trip.id, driverId: drivers.f_hussein, reason: 'demo', force: true })).offerId;
    await services.dispatch.respond({ personId: drivers.f_hussein, sessionId: 'demo' }, { offerId, accept: true });
  } catch (err) {
    console.warn(`DEMO fleet: on-job ride skipped (${err?.message ?? err})`);
  }

  // Invites still waiting: a number that never answered (owner's "بانتظار موافقة السايق" row), and حيدر,
  // a tuktuk driver who sees سجاد's invite in his app.
  await fleet.addDriver(owner, { phone: '07701110057' });
  const invitee = await demo.person({
    key: 'f_invitee',
    phone: '07701110056',
    name: 'حيدر سلمان',
    roles: ['driver'],
    vehicle: 'tuktuk',
    plate: 'واسط 40777',
  });
  // f5: سجاد picked a free tuktuk for him on the same screen; it becomes his when he says yes.
  const spare = await fleet.addVehicle(owner, { plate: 'واسط 40912', vehicleClass: 'tuktuk', seats: 3, model: 'باجاج', colour: 'green' });
  vehicles.f_spare = spare;
  await fleet.addDriver(owner, { phone: '07701110056', vehicleId: spare.vehicleId });
  drivers.f_invitee = invitee;
  try {
    // Papers and today's selfie, so his home shows the invite rather than the check-in banner.
    for (const kind of ['national_id_front', 'national_id_back', 'photo'])
      await doc(invitee, kind, new Date(now + 900 * DAY));
    const challenge = await accounts.checkInChallenge({ personId: invitee, sessionId: 'demo' });
    const ticket = await blobs.createUpload({
      ownerId: invitee,
      contentType: 'image/jpeg',
      sizeBytes: JPEG.length,
    });
    const url = new URL(ticket.uploadUrl, 'http://local');
    await blobs.receive({
      id: ticket.uploadId,
      exp: url.searchParams.get('exp') ?? undefined,
      sig: url.searchParams.get('sig') ?? undefined,
      contentType: 'image/jpeg',
      bytes: JPEG,
    });
    await accounts.submitCheckIn(
      { personId: invitee, sessionId: 'demo' },
      { challengeId: challenge.challengeId, uploadId: ticket.uploadId, livenessScore: 0.97 },
    );
  } catch (err) {
    console.warn(`DEMO fleet: invitee check-in skipped (${err?.message ?? err})`);
  }

  demo.fleet = { fleetOrgId: org.id, ownerId, drivers, vehicles };
  demo.route('/demo/fleet/invite-reset', async ({ res }) => {
    await fleet
      .respondInvite(
        { personId: invitee, sessionId: 'demo' },
        { fleetOrgId: org.id, accept: false },
      )
      .catch(() => undefined);
    await fleet.addDriver(owner, { phone: '07701110056', vehicleId: spare.vehicleId });
    demo.json(res, 200, { ok: true });
  });
  demo.route('/demo/fleet/live', async ({ res }) => {
    for (const s of specs) if (s.state !== 'offline') await demo.online(drivers[s.key], s.at, s.vehicle);
    demo.json(res, 200, { ok: true });
  });
  demo.route('/demo/fleet/info', async ({ res }) => demo.json(res, 200, { fleetOrgId: org.id, ownerId, drivers, vehicles: Object.values(vehicles) }));
}
