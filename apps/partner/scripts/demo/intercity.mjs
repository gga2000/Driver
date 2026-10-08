// الرجعة, driver side (wave 2): the intercity persona's garage board, seeded through the real routes
// module. Re-seed any time with POST /demo/intercity/seed (closes his old runs, clears demand/requests).
//
//   who=intercity  0770 111 0003  مصطفى جاسم
//
//   Run A  van (7) · كراج البوابة ١ → بغداد · announced time 12 min ago, boarding; selfie done, he is
//          checked in at the garage. Seats: front زهراء (checked in), middle-left حسين (prepaid, late:
//          the meter runs), middle-middle free, middle-right a walk-up, rear-left+middle مريم's family
//          (door pickup, accepted), rear-right أحمد (cash, past his 3-minute grace: no-show allowed).
//   Run B  Elantra (4, his painted car) · كراج النهضة → العزيزية · in 4.5 h: نور (front, prepaid), سجاد (door pickup
//          waiting for his answer), علي (on-the-way: جسر ديالى), ياسر holding back-middle. Step 4 prices:
//          نور agreed her spot on the road (2,000) and her door (free); سارة asks about her spot;
//          هدى has his 3,000 for her door and hasn't answered.
//   Demand from Aziziyah: 12 seats in the next-hour window, 5 in the one after, 2 at البوابة ٢ later;
//          3 seats from Baghdad tonight.
//   Request board: a family to الحلة (private car), a ziyara to النجف tomorrow, a stranded rider at
//          her seat price, and a ride to الصويرة where the rider already picked his offer.
//
//   POST /demo/intercity/seed?who=intercity   → { runA, runB, rideId, waitRides, fetchRide, cashRide, posts, pins }
//   GET  /demo/intercity/pins                  → { name: pin } for run A's riders still to check in
import { PostRequestInput } from '@driver/contracts';
const MIN = 60_000;
const BAB1 = { lat: 32.9032, lng: 45.0578 };
const HASHIMI_DOOR = { lat: 32.8968, lng: 45.0662 };
const BAGHDAD_DOOR = { lat: 33.3195, lng: 44.4302 };
// Step 4: spots on the Baghdad road (outside both garages' door areas) and a door in Aziziyah.
const ROAD_PIN = { lat: 33.1667, lng: 44.5517 };
const ROAD_PIN_2 = { lat: 33.06, lng: 44.66 };
const AZIZIYAH_DOOR = { lat: 32.912, lng: 45.071 };

const RIDERS = [
  ['zahraa', '07803330101', 'زهراء علي'],
  ['hussein', '07803330102', 'حسين كريم'],
  ['maryam', '07803330103', 'مريم جبار'],
  ['ahmed', '07803330104', 'أحمد ستار'],
  ['noor', '07803330105', 'نور الهدى صالح'],
  ['sajjad', '07803330106', 'سجاد ناظم'],
  ['ali', '07803330107', 'علي رحيم'],
  ['yasir', '07803330108', 'ياسر محمد'],
  ['sara', '07803330109', 'سارة حميد'],
  ['huda', '07803330110', 'هدى قاسم'],
  ['rusul', '07803330111', 'رسل عباس'],
  ['batool', '07803330112', 'بتول حسن'],
];
// Demand posters (one window each per corridor/direction).
const POSTERS = Array.from({ length: 9 }, (_, i) => [`poster${i}`, `0780333020${i}`, `راكب ${i + 1}`]);

export default async function register(demo) {
  const { services, Accounts } = demo;
  const routes = await demo.load('modules/routes/index.js');
  const rpc = demo.app.get(routes.RoutesRpc);
  const repo = demo.app.get(routes.ROUTES_REPOSITORY);
  const people = {};
  for (const [key, phone, name] of [...RIDERS, ...POSTERS]) {
    people[key] = await demo.person({ phone, name });
    await services.ledger.recordAll(
      demo.group(`demo:ic:topup:${key}:${Date.now()}`, demo.hoursAgo(48), [{ type: 'credit_issued', amount: 200_000, fromAccount: Accounts.bank, toAccount: Accounts.customer(people[key]) }]),
    );
  }
  const actor = (key) => ({ personId: people[key], sessionId: 'demo' });
  // Through the contract, as tRPC would: the defaults (trip details) are filled in.
  const postRequest = (who, input) => rpc.postRequest(who, PostRequestInput.parse(input));
  const state = { runA: null, runB: null, pins: {} };

  /** Baghdad wall-clock hour boundary `h` hours after now's hour. */
  function hourFromNow(h) {
    const local = new Date(Date.now() + 180 * MIN);
    local.setUTCMinutes(0, 0, 0);
    return new Date(local.getTime() - 180 * MIN + h * 3600_000);
  }

  async function reset(driverId) {
    const now = new Date();
    for (const d of await repo.listDepartures({ driverId })) {
      for (const b of await repo.bookingsFor(d.id)) {
        if (['held', 'booked', 'checked_in'].includes(b.state)) await repo.saveBooking({ ...b, state: 'cancelled' });
      }
      if (['scheduled', 'boarding', 'departed', 'arrived'].includes(d.state)) await repo.saveDeparture({ ...d, state: 'closed', closedAt: now });
    }
    for (const p of await repo.listDemand({ states: ['open', 'claimed'] })) await repo.saveDemand({ ...p, state: 'cancelled' });
    for (const r of await repo.listRequests({ states: ['open', 'matched', 'driver_arrived'] })) await repo.saveRequest({ ...r, state: 'expired', closedAt: now });
  }

  async function book(key, departureId, seatIds, travellingAs, payment, pickup = { kind: 'garage' }, largeBags = false, extra = {}) {
    const held = await rpc.holdSeat(actor(key), { departureId, selection: { kind: 'seats', seatIds }, travellingAs, pickup, largeBags, ...extra });
    if (!payment) return held;
    return rpc.bookSeat(actor(key), { bookingId: held.id, payment });
  }

  async function seed(query) {
    const p = demo.who({ who: query.who ?? 'intercity' });
    const driver = { personId: p.personId, sessionId: 'demo' };
    await reset(p.personId);
    const now = Date.now();

    // ── Run A: announced for a minute from now, then moved 12 minutes into the past (boarding, meter running).
    const a = await rpc.announce(driver, {
      garageId: 'mp_garage_bab1',
      corridorId: 'aziziyah_baghdad',
      departAt: new Date(now + MIN),
      latestDepartureAt: new Date(now + 50 * MIN),
      vehicle: { kind: 'van', layout: 7, plate: 'بغداد 88412', modelKey: 'gmc', color: 'أبيض' },
      familyOnly: false,
    });
    const zahraa = await book('zahraa', a.id, ['front'], 'nisa', 'wallet');
    const hussein = await book('hussein', a.id, ['middle_left'], 'rijal', 'wallet', { kind: 'garage' }, true);
    const maryam = await book('maryam', a.id, ['rear_left', 'rear_middle'], 'aila', 'wallet', { kind: 'door', ...HASHIMI_DOOR, note: 'بيت باب أسود، مقابل جامع الهاشمي' });
    const ahmed = await book('ahmed', a.id, ['rear_right'], 'rijal', 'cash');
    await rpc.respondPickup(driver, { departureId: a.id, bookingId: maryam.id, accept: true });
    await rpc.selfie(driver, { departureId: a.id, selfieRef: 'demo:selfie' });
    await rpc.markWalkUp(driver, { departureId: a.id, seatId: 'middle_right', travellingAs: 'rijal' });
    await rpc.driverPosition(driver, { departureId: a.id, ...BAB1 });
    await rpc.checkIn(driver, { departureId: a.id, pin: zahraa.pin });
    const depA = await repo.getDeparture(a.id);
    const at = (m) => new Date(now + m * MIN);
    await repo.saveDeparture({
      ...depA,
      departAt: at(-12),
      latestDepartureAt: at(38),
      announcedAt: at(-90),
      createdAt: at(-90),
      selfieAt: at(-20),
      driverCheckIn: { ...BAB1, at: at(-16) },
      lastPosition: { ...BAB1, at: at(-1) },
      trail: [{ ...BAB1, at: at(-16) }],
    });
    const zb = await repo.getBooking(zahraa.id);
    await repo.saveBooking({ ...zb, checkedInAt: at(-14), atGarageAt: at(-15) });

    // ── Run B: tonight from Baghdad back to Aziziyah.
    const b = await rpc.announce(driver, {
      garageId: 'mp_garage_nahdha',
      corridorId: 'aziziyah_baghdad',
      departAt: new Date(Math.ceil((now + 270 * MIN) / (15 * MIN)) * 15 * MIN),
      latestDepartureAt: new Date(Math.ceil((now + 270 * MIN) / (15 * MIN)) * 15 * MIN + 30 * MIN),
      vehicle: { kind: 'saloon', layout: 4, plate: 'بغداد 88412', modelKey: 'elantra', color: 'بيضة' },
      familyOnly: false,
    });
    // Step 4 agreed prices: نور agreed a pickup at her spot on the road (2,000) and a door drop at home
    // (free) before booking; سارة asked about her spot and waits for his price; هدى has his price (3,000)
    // and hasn't answered yet.
    const agree = async (key, kind, place, amountIqd, accept) => {
      const ask = await rpc.askAgreement(actor(key), { departureId: b.id, kind, ...place });
      if (amountIqd === null) return ask;
      await rpc.proposeAgreement(driver, { agreementId: ask.id, amountIqd });
      return accept ? rpc.respondAgreement(actor(key), { agreementId: ask.id, accept: true }) : ask;
    };
    const noorPin = await agree('noor', 'pin_pickup', { ...ROAD_PIN, note: 'سيطرة المدائن، صوب الكازية' }, 2_000, true);
    const noorDoor = await agree('noor', 'door_drop', { ...HASHIMI_DOOR, note: 'بيت باب أسود، مقابل جامع الهاشمي' }, 0, true);
    await book('noor', b.id, ['front'], 'nisa', 'wallet', { kind: 'pin', agreementId: noorPin.id }, false, { dropoff: { agreementId: noorDoor.id } });
    await agree('sara', 'pin_pickup', { ...ROAD_PIN_2, note: 'مفرق الجسر الحديدي' }, null, false);
    await agree('huda', 'door_drop', { ...AZIZIYAH_DOOR, note: 'حي العسكري، الشارع الثاني' }, 3_000, false);
    await book('sajjad', b.id, ['back_left'], 'rijal', 'wallet', { kind: 'door', ...BAGHDAD_DOOR, note: 'زيونة، قرب أسواق الحمراء' });
    await book('ali', b.id, ['back_right'], 'rijal', 'cash', { kind: 'meeting_point', meetingPointId: 'mp_ic_diyala_bridge' });
    await book('yasir', b.id, ['back_middle'], 'rijal', null);

    // ── Demand (riders waiting, by window).
    const w1 = [hourFromNow(1), hourFromNow(2)];
    const w2 = [hourFromNow(2), hourFromNow(3)];
    const w3 = [hourFromNow(5), hourFromNow(6)];
    const posts = [
      ['poster0', w1, 4, 'aila'],
      ['poster1', w1, 3, 'rijal'],
      ['poster2', w1, 3, 'nisa'],
      ['poster3', w1, 2, 'rijal'],
      ['poster4', w2, 3, 'aila'],
      ['poster5', w2, 2, 'rijal'],
      ['poster6', w3, 2, 'nisa', 'mp_garage_bab2'],
    ];
    for (const [key, [start, end], seats, ta, garageId] of posts) {
      await rpc.postDemand(actor(key), { corridorId: 'aziziyah_baghdad', direction: 'from_aziziyah', windowStart: start, windowEnd: end, seats, travellingAs: ta, pickup: { kind: 'garage', ...(garageId ? { garageId } : {}) } });
    }
    await rpc.postDemand(actor('poster7'), { corridorId: 'aziziyah_baghdad', direction: 'to_aziziyah', windowStart: hourFromNow(2), windowEnd: hourFromNow(3), seats: 3, travellingAs: 'rijal', pickup: { kind: 'garage', garageId: 'mp_garage_nahdha' } });
    await rpc.postDemand(actor('poster8'), { corridorId: 'aziziyah_kut', direction: 'from_aziziyah', windowStart: hourFromNow(1), windowEnd: hourFromNow(2), seats: 2, travellingAs: 'nisa', pickup: { kind: 'garage' } });

    // ── Request board.
    const hilla = await postRequest(actor('sara'), { from: { label: 'كراج البوابة ١', garageId: 'mp_garage_bab1' }, to: { label: 'الحلة' }, when: new Date(now + 180 * MIN), seats: 3, privateCar: true, travellingAs: 'aila', note: 'عدنا جنطتين كبار وعربانة طفل' });
    // p1/p2: six finished Najaf trips (there and back, 4 hours' wait) give that trip a usual range.
    for (const [i, price] of [50_000, 55_000, 55_000, 58_000, 60_000, 65_000].entries()) {
      const done = await postRequest(actor(`poster${i}`), { from: { label: 'العزيزية' }, to: { label: 'النجف', placeId: 'najaf' }, when: new Date(now + 20 * MIN), seats: 3, privateCar: true, travellingAs: 'aila', details: { trip: 'wait_return', waitHours: 4 } });
      const o = await rpc.offerOnRequest(driver, { postId: done.id, priceIqd: price, wait: { includedHours: 4, extraHourIqd: 5_000 } });
      await rpc.pickOffer(actor(`poster${i}`), { postId: done.id, offerId: o.offers.at(-1).id });
      await rpc.requestCompleted(driver, { postId: done.id });
    }
    const najaf = await postRequest(actor('huda'), { from: { label: 'العزيزية، حي الهاشمي' }, to: { label: 'النجف', placeId: 'najaf' }, when: new Date(hourFromNow(30).getTime()), seats: 4, privateCar: true, travellingAs: 'aila', details: { trip: 'wait_return', waitHours: 4 } });
    const stranded = await postRequest(actor('batool'), { from: { label: 'كراج البوابة ٢', garageId: 'mp_garage_bab2' }, to: { label: 'بغداد، كراج النهضة' }, when: new Date(now + 45 * MIN), seats: 1, privateCar: true, travellingAs: 'nisa' });
    const sr = await repo.getRequest(stranded.id);
    await repo.saveRequest({ ...sr, origin: 'stranded', priceCapIqd: 10_000 });
    const suwaira = await postRequest(actor('rusul'), { from: { label: 'كراج البوابة ٢', garageId: 'mp_garage_bab2' }, to: { label: 'الصويرة' }, when: new Date(now + 40 * MIN), seats: 2, privateCar: true, travellingAs: 'nisa' });
    const offered = await rpc.offerOnRequest(driver, { postId: suwaira.id, priceIqd: 25_000 });
    await rpc.pickOffer(actor('rusul'), { postId: suwaira.id, offerId: offered.offers[0].id });
    // w2: two «يستناك وترجع» rides to Karbala picked by this driver: one he just reached (the start
    // button), one where he has waited 3 h 51 min of the 4 included hours (the 10-minute reminder).
    const waitRide = async (who, waitedMin) => {
      const r = await postRequest(actor(who), { from: { label: 'العزيزية، حي الزهراء' }, to: { label: 'كربلاء', placeId: 'karbala' }, when: new Date(now + 10 * MIN), seats: 2, privateCar: true, travellingAs: 'aila', details: { trip: 'wait_return', waitHours: 4 } });
      const o = await rpc.offerOnRequest(driver, { postId: r.id, priceIqd: 70_000, wait: { includedHours: 4, extraHourIqd: 5_000 } });
      await rpc.pickOffer(actor(who), { postId: r.id, offerId: o.offers.at(-1).id });
      await rpc.requestArrived(driver, { postId: r.id, lat: 32.9105, lng: 45.0611 });
      if (waitedMin !== null) {
        await rpc.requestWaitStart(driver, { postId: r.id });
        const w = await repo.getRequest(r.id);
        await repo.saveRequest({ ...w, waitStartedAt: new Date(now - waitedMin * MIN) });
      }
      return r.id;
    };
    const waitReady = await waitRide('poster6', null);
    const waiting = await waitRide('poster7', 231);
    // k1–k4 «جيب واحد»: poster8 sends the car to Baghdad airport for his mother, back home to Aziziyah.
    const fetchPost = await postRequest(actor('poster8'), { from: { label: 'مطار بغداد', placeId: 'baghdad_airport' }, to: { label: 'العزيزية · البيت' }, when: new Date(now + 90 * MIN), seats: 1, privateCar: true, travellingAs: 'aila', details: { trip: 'fetch', bigBags: 2 }, rider: { from: 'typed', name: 'ماما', phone: '07701239876' } });
    const fetchOffer = await rpc.offerOnRequest(driver, { postId: fetchPost.id, priceIqd: 75_000 });
    await rpc.pickOffer(actor('poster8'), { postId: fetchPost.id, offerId: fetchOffer.offers.at(-1).id });
    // Step 4b a6 «احجز وادفع كاش», switched on for this demo only (the launch rule stays off): علي asks
    // this driver on his Kufa trip and waits for the answer; ياسر's Kut ride was booked on his yes.
    const board = demo.app.get(routes.RequestBoardService);
    board.moneyRules = { ...board.moneyRules, requestCashReservation: { enabled: true } };
    const kufa = await postRequest(actor('ali'), { from: { label: 'العزيزية، حي العسكري' }, to: { label: 'الكوفة' }, when: new Date(hourFromNow(5).getTime()), seats: 2, privateCar: true, travellingAs: 'rijal' });
    const kufaOffer = (await rpc.offerOnRequest(driver, { postId: kufa.id, priceIqd: 45_000 })).offers.at(-1);
    await rpc.askCash(actor('ali'), { postId: kufa.id, offerId: kufaOffer.id });
    const kut = await postRequest(actor('yasir'), { from: { label: 'كراج البوابة ١', garageId: 'mp_garage_bab1' }, to: { label: 'الكوت، المستشفى' }, when: new Date(now + 50 * MIN), seats: 1, privateCar: true, travellingAs: 'rijal' });
    const kutOffer = (await rpc.offerOnRequest(driver, { postId: kut.id, priceIqd: 20_000 })).offers.at(-1);
    await rpc.askCash(actor('yasir'), { postId: kut.id, offerId: kutOffer.id });
    await rpc.answerCash(driver, { postId: kut.id, offerId: kutOffer.id, accept: true });
    await rpc.pickOffer(actor('yasir'), { postId: kut.id, offerId: kutOffer.id, cash: true });

    state.runA = a.id;
    state.runB = b.id;
    state.pins = { hussein: hussein.pin, maryam: maryam.pin, ahmed: ahmed.pin };
    state.bookings = { hussein: hussein.id, maryam: maryam.id, ahmed: ahmed.id };
    return { runA: a.id, runB: b.id, rideId: suwaira.id, waitRides: { ready: waitReady, waiting }, fetchRide: fetchPost.id, cashRide: kut.id, posts: { hilla: hilla.id, najaf: najaf.id, stranded: stranded.id, cashAsk: kufa.id }, pins: state.pins, bookings: state.bookings };
  }

  await seed({ who: 'intercity' });

  demo.route('/demo/intercity/seed', async ({ res, query }) => demo.json(res, 200, await seed(query)));
  demo.route('/demo/intercity/pins', async ({ res }) => demo.json(res, 200, state.pins));
}
