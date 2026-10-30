// Customer paths on the real database (CRIT2-04, plan W0 "customer paths script").
//
// More flows for scripts/e2e/realdb-core.mjs: the same harness runs them (its own request-id prefix
// per flow, the same log / outbox / notification attribution and the known-failures ratchet), so they
// run in the CI job `e2e-postgres` next to the five core flows. Each flow signs in new people and
// drives the tRPC procedures the apps call, signed in as the person who taps the button; roles and
// dispatch come from the seeded admin, as ops would do them.
//
//   delivery   food from a seeded kitchen: accept → ready → courier → pickup → chat on the way →
//              wallet top-up handed to the courier at the door → cash → rating (double tap) → tip →
//              compliment → complaint (missing item)
//   cancels    food cancelled free while placed (preview, then cancel), and one the kitchen rejects
//   ridelife   a taxi with its quote id: driver → pickup (night start code) → drop-off (cash) →
//              rating → compliment → history → «نسيت غرض» chat
//   sosend     SOS on a ride with no emergency contact, a position fix, the alarm cancelled
//   household  payer + orderer with a 1,000 budget: an order over it waits for the payer, approved;
//              a second one declined and cancelled
//   seats      الرجعة: a car announced, found on the board, a seat held and let go, the front seat
//              booked (cash), «وصلت», PIN check-in, walk-ups, depart, arrive, rating
//   board      the request board: wallet top-up (field agent), post → offer → pick (20 % deposit) →
//              arrived → complete; a second picked inside the last hour and cancelled (deposit kept)
//   profile    trusted contacts (and keeping one), push device on/off, notification settings,
//              a child for خطوط, sign-out
//   places     zone of a pin, save home (and work), rename, list, remove
//   browse     restaurants, search, a menu, follow a dish, an invitation code claimed by a friend,
//              top-up options, wallet history
//   later      a scheduled order (cancelled), a gift paid from the wallet, a الرجعة seat wish
//   doubletap  two identical taps at once (follow, save a place, profile, top-up): never a 5xx
//
// `customerPaths(h)` takes the harness helpers and returns the flows by name.

/** A seeded kitchen open all day for the run, its owner signed in, and one orderable dish. */
async function openKitchen(h, f, a, orgId = 'org_aziziyah_khalid') {
  const owner = await h.signIn(f, h.newPhone(), 'صاحب المطعم');
  if (!owner) return null;
  await f.call('identity.grantRole(merchant_owner)', () =>
    a.api.identity.grantRole.mutate({ personId: owner.personId, kind: 'merchant_owner', orgId }),
  );
  const days = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
    dow,
    shifts: [{ start: '00:00', end: '23:59' }],
  }));
  await f.call('merchant.setHours', () =>
    owner.api.merchant.setHours.mutate({ merchantOrgId: orgId, days, holidays: [] }),
  );
  return { owner, orgId };
}

/** A cash food order for two of one dish, as the app places it. */
async function placeFood(h, f, customer, orgId, tag, extra = {}) {
  const menu = await f.call('catalog.menu', () =>
    customer.api.catalog.menu.query({ merchantId: orgId, dropoff: h.HOME }),
  );
  const dish = menu?.categories
    .flatMap((c) => c.items)
    .find((i) => i.available && i.priceIqd >= 1000 && !i.modifierGroups.some((g) => g.required));
  if (!f.check(dish, 'the seeded menu has an orderable dish')) return null;
  const input = {
    cityId: h.CITY,
    type: 'food',
    merchantOrgId: orgId,
    lines: [
      {
        catalogItemId: dish.id,
        qty: 2,
        unitPriceIqd: dish.priceIqd,
        modifiers: [],
        merchantOrgId: orgId,
      },
    ],
    participants: [],
    tipIqd: 0,
    options: { streetHandover: false },
    paymentMethod: 'cash',
    dropoff: h.HOME,
    ...extra,
  };
  const order = await f.call(`orders.place(food ${tag})`, () =>
    customer.api.orders.place.mutate({ ...input, clientRequestId: `${f.name}_${tag}_${h.RUN}` }),
  );
  if (!f.check(order?.id, `food order placed (${tag})`, order?.state)) return null;
  f.subject(order.id, order.tripId);
  return order;
}

/** A new person with a role the admin grants (courier, driver, …). */
async function staffMember(h, f, a, kind, name) {
  const p = await h.signIn(f, h.newPhone(), name);
  if (!p) return null;
  const g = await f.call(`identity.grantRole(${kind})`, () =>
    a.api.identity.grantRole.mutate({ personId: p.personId, kind }),
  );
  return g === undefined ? null : p;
}

/** The order's trip id, once dispatch has made one. */
async function tripOf(h, f, customer, orderId) {
  for (let i = 0; i < 20; i++) {
    const t = await f.call('orders.track(trip)', () =>
      customer.api.orders.track.query({ orderId }),
    );
    if (t?.trip?.id) {
      f.subject(t.trip.id);
      return t.trip.id;
    }
    await h.sleep(300);
  }
  f.check(false, 'the order has a trip (orders.track)');
  return null;
}

/** The dispatcher forces the trip on `driver` (offline, no check-in), he accepts: his active job. */
async function assign(f, a, driver, tripId) {
  const ov = await f.call('dispatch.override', () =>
    a.api.dispatch.override.mutate({
      tripId,
      driverId: driver.personId,
      force: true,
      reason: 'e2e: assign',
    }),
  );
  if (!f.check(ov?.offerId, 'dispatch.override sends him the job', ov)) return null;
  const resp = await f.call('dispatch.respond(accept)', () =>
    driver.api.dispatch.respond.mutate({ offerId: ov.offerId, accept: true }),
  );
  if (!f.check(resp?.outcome === 'assigned', 'he accepts: assigned', resp)) return null;
  const job = await f.call('partner.activeJob', () => driver.api.partner.activeJob.query());
  f.check(job?.tripId === tripId, 'his active job is this trip', job?.tripId);
  return job;
}

/** Arrive at and complete one stop of the active job. */
async function doStop(f, driver, job, type, handover = {}, startCode) {
  const stop = job.stops.find((s) => s.type === type);
  if (!f.check(stop, `the job has a ${type} stop`)) return false;
  const pin = stop.pin ?? { lat: 32.89, lng: 45.07 };
  await f.call(`trips.reportPosition(${type})`, () =>
    driver.api.trips.reportPosition.mutate({ pin, at: new Date(), speedKmh: 0 }),
  );
  const ar = await f.call(`trips.arrive(${type})`, () =>
    driver.api.trips.arrive.mutate({
      tripId: job.tripId,
      stopId: stop.stopId,
      pin,
      occurredAt: new Date(),
    }),
  );
  if (ar === undefined) return false;
  const done = await f.call(`trips.completeStop(${type})`, () =>
    driver.api.trips.completeStop.mutate({
      tripId: job.tripId,
      stopId: stop.stopId,
      handover,
      ...(startCode ? { startCode } : {}),
      occurredAt: new Date(),
    }),
  );
  return done !== undefined;
}

/** Waits for `fn()` to return a truthy value (polled), else null. */
async function until(h, fn, { tries = 20, everyMs = 300 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await h.sleep(everyMs);
  }
  return null;
}

/** Cash handed to a field agent (the admin here): the customer's wallet is credited `amountIqd`. */
async function topUp(f, a, customer, amountIqd) {
  const tu = await f.call('wallet.requestTopUp', () =>
    customer.api.wallet.requestTopUp.mutate({ amountIqd }),
  );
  if (!f.check(tu?.code, 'top-up request has a code', tu)) return false;
  f.subject(tu.topUpId);
  const conf = await f.call('ops.confirmTopUp', () =>
    a.api.ops.confirmTopUp.mutate({
      code: tu.code,
      amountIqd,
      idempotencyKey: `tu_${f.name}_${tu.code}`,
    }),
  );
  return f.check(conf?.topUpId === tu.topUpId, 'the agent confirms the top-up', conf);
}

export function customerPaths(h) {
  return {
    async delivery(f) {
      const a = await h.admin(f);
      const customer = await h.signIn(f, h.newPhone(), 'زبون التوصيل');
      if (!a || !customer) return;
      const kitchen = await openKitchen(h, f, a);
      const courier = await staffMember(h, f, a, 'courier', 'حيدر');
      if (!kitchen || !courier) return;
      const order = await placeFood(h, f, customer, kitchen.orgId, 'delivery');
      if (!order) return;
      const acc = await f.call('orders.merchant.accept', () =>
        kitchen.owner.api.orders.merchant.accept.mutate({ orderId: order.id, prepMinutes: 15 }),
      );
      f.check(acc?.state === 'merchant_accepted', 'kitchen accepted', acc?.state);
      const ready = await f.call('orders.merchant.ready', () =>
        kitchen.owner.api.orders.merchant.ready.mutate({ orderId: order.id }),
      );
      f.check(ready, 'kitchen marked it ready');
      const tripId = await tripOf(h, f, customer, order.id);
      if (!tripId) return;
      let job = await assign(f, a, courier, tripId);
      if (!job) return;
      if (!(await doStop(f, courier, job, 'pickup'))) return;
      job = await f.call('partner.activeJob', () => courier.api.partner.activeJob.query());
      if (!f.check(job, 'still his job after pickup')) return;
      // On the way: the customer writes to his courier, the courier answers, both read.
      const sent = await f.call('chat.send(customer)', () =>
        customer.api.chat.send.mutate({
          orderId: order.id,
          kind: 'customer_courier',
          clientId: `chat_c_${h.RUN}`,
          text: 'البيت الثاني يم الجامع',
        }),
      );
      f.check(sent, 'customer message sent');
      const seen = await f.call('chat.thread(courier)', () =>
        courier.api.chat.thread.query({ orderId: order.id, kind: 'customer_courier' }),
      );
      f.check(JSON.stringify(seen ?? '').includes('يم الجامع'), 'the courier reads it');
      await f.call('chat.send(courier)', () =>
        courier.api.chat.send.mutate({
          orderId: order.id,
          kind: 'customer_courier',
          clientId: `chat_d_${h.RUN}`,
          text: 'وصلت',
        }),
      );
      const mine = await f.call('chat.threads(customer)', () =>
        customer.api.chat.threads.query({ orderId: order.id }),
      );
      f.check(mine, 'customer sees the threads');
      const back = await f.call('chat.thread(customer)', () =>
        customer.api.chat.thread.query({ orderId: order.id, kind: 'customer_courier' }),
      );
      const last = Math.max(0, ...(back?.messages ?? []).map((m) => m.seq ?? 0));
      const read = await f.call('chat.markRead', () =>
        customer.api.chat.markRead.mutate({
          orderId: order.id,
          kind: 'customer_courier',
          seq: last,
        }),
      );
      f.check(read?.unread === 0, 'customer read everything', read);

      // At the door: a wallet top-up handed to his courier in cash (only the courier carrying his order may).
      const tu = await f.call('wallet.requestTopUp', () =>
        customer.api.wallet.requestTopUp.mutate({ amountIqd: 5000 }),
      );
      if (!f.check(tu?.code, 'top-up request has a code', tu)) return;
      f.subject(tu.topUpId);
      const look = await f.call('partner.topUpLookup', () =>
        courier.api.partner.topUpLookup.query({ code: tu.code }),
      );
      f.check(look?.amountIqd === 5000, 'courier sees the requested amount', look);
      const conf = await f.call('partner.confirmTopUp', () =>
        courier.api.partner.confirmTopUp.mutate({
          code: tu.code,
          amountIqd: 5000,
          idempotencyKey: `tu_${h.RUN}_${tu.code}`,
        }),
      );
      f.check(conf?.topUpId === tu.topUpId, 'courier confirms the top-up', conf);
      const bal = await f.call('wallet.balance', () => customer.api.wallet.balance.query());
      f.check(bal?.moneyIqd === 5000, 'wallet holds the top-up', bal);

      if (!(await doStop(f, courier, job, 'dropoff', { cashCollectedIqd: order.totalIqd }))) return;
      const t = await until(h, async () => {
        const x = await f.call('orders.track(delivered)', () =>
          customer.api.orders.track.query({ orderId: order.id }),
        );
        return x?.order?.state === 'delivered' ? x : null;
      });
      if (!f.check(t, 'customer sees it delivered')) return;

      // Rated with a double tap (RDB-04): both land or one loses politely, never a 500.
      const rates = await Promise.allSettled(
        [0, 1].map(() =>
          customer.api.orders.rate.mutate({ orderId: order.id, delivery: 5, food: 5 }),
        ),
      );
      for (const r of rates)
        if (r.status === 'rejected' && (r.reason?.data?.httpStatus ?? 0) >= 500)
          f.http5xx.push(`orders.rate ×2: ${r.reason.message}`);
      f.check(
        rates.some((r) => r.status === 'fulfilled'),
        'rated 5 / 5',
        rates.map((r) => r.status),
      );

      const offer = await f.call('orders.tipOptions', () =>
        customer.api.orders.tipOptions.query({ orderId: order.id }),
      );
      if (
        f.check(
          offer?.offered && offer.amountsIqd.length > 0,
          'a tip is offered after 5 stars',
          offer,
        )
      ) {
        const tip = await f.call('orders.tip', () =>
          customer.api.orders.tip.mutate({ orderId: order.id, amountIqd: offer.amountsIqd[0] }),
        );
        f.check(tip?.walletIqd === 5000 - offer.amountsIqd[0], 'tip comes off his wallet', tip);
      }
      const co = await f.call('orders.complimentOptions', () =>
        customer.api.orders.complimentOptions.query({ orderId: order.id }),
      );
      if (f.check(co?.offered && co.keys.length > 0, 'compliments are offered', co)) {
        const c = await f.call('orders.compliment', () =>
          customer.api.orders.compliment.mutate({ orderId: order.id, keys: [co.keys[0]] }),
        );
        f.check(c?.keys?.length === 1, 'compliment sent', c);
      }
      // Later he finds a dish missing from the bag (the 2-hour complaint window).
      const d = await f.call('orders.openDispute', () =>
        customer.api.orders.openDispute.mutate({
          orderId: order.id,
          kind: 'missing_item',
          note: 'نقص صمونة',
        }),
      );
      f.check(d, 'complaint opened', d?.state);
    },

    async cancels(f) {
      const a = await h.admin(f);
      const customer = await h.signIn(f, h.newPhone(), 'زبون الإلغاء');
      if (!a || !customer) return;
      const kitchen = await openKitchen(h, f, a);
      if (!kitchen) return;
      const first = await placeFood(h, f, customer, kitchen.orgId, 'cancel');
      if (!first) return;
      const prev = await f.call('orders.cancellationPreview', () =>
        customer.api.orders.cancellationPreview.query({ orderId: first.id }),
      );
      f.check(
        prev?.allowed && prev.free && prev.amountIqd === 0,
        'cancelling while placed is free',
        prev,
      );
      const c = await f.call('orders.cancel', () =>
        customer.api.orders.cancel.mutate({ orderId: first.id, reason: 'e2e' }),
      );
      f.check(c?.state === 'customer_cancelled', 'customer cancelled', c?.state);
      const second = await placeFood(h, f, customer, kitchen.orgId, 'reject');
      if (!second) return;
      const rej = await f.call('orders.merchant.reject', () =>
        kitchen.owner.api.orders.merchant.reject.mutate({
          orderId: second.id,
          reason: 'out_of_stock',
        }),
      );
      f.check(rej, 'kitchen rejected', rej?.state);
      const t = await f.call('orders.track(rejected)', () =>
        customer.api.orders.track.query({ orderId: second.id }),
      );
      f.check(t?.order && t.order.state !== 'placed', 'customer sees it ended', t?.order?.state);
    },
    async ridelife(f) {
      const a = await h.admin(f);
      const customer = await h.signIn(f, h.newPhone(), 'زبون المشوار');
      if (!a || !customer) return;
      const driver = await staffMember(h, f, a, 'driver', 'عباس');
      if (!driver) return;
      const placed = await h.placeRide(f, customer, { withQuoteId: true });
      if (!placed) return;
      const tripId = await tripOf(h, f, customer, placed.ride.id);
      if (!tripId) return;
      let job = await assign(f, a, driver, tripId);
      if (!job) return;
      // At night the rider reads out the 4-digit start code from his live screen (s1).
      const live = await f.call('orders.track(start code)', () =>
        customer.api.orders.track.query({ orderId: placed.ride.id }),
      );
      if (!(await doStop(f, driver, job, 'pickup', {}, live?.trip?.startCode ?? undefined))) return;
      job = await f.call('partner.activeJob', () => driver.api.partner.activeJob.query());
      if (!f.check(job, 'still his job after pickup')) return;
      if (!(await doStop(f, driver, job, 'dropoff', { cashCollectedIqd: placed.ride.totalIqd })))
        return;
      const t = await until(h, async () => {
        const x = await f.call('orders.track(done)', () =>
          customer.api.orders.track.query({ orderId: placed.ride.id }),
        );
        return ['completed', 'delivered'].includes(x?.order?.state) ? x : null;
      });
      if (!f.check(t, 'customer sees the ride done')) return;
      const rated = await f.call('orders.rate', () =>
        customer.api.orders.rate.mutate({ orderId: placed.ride.id, delivery: 5 }),
      );
      f.check(rated, 'rated 5');
      const co = await f.call('orders.complimentOptions', () =>
        customer.api.orders.complimentOptions.query({ orderId: placed.ride.id }),
      );
      if (f.check(co?.offered && co.keys.length > 0, 'compliments are offered', co)) {
        const c = await f.call('orders.compliment', () =>
          customer.api.orders.compliment.mutate({ orderId: placed.ride.id, keys: [co.keys[0]] }),
        );
        f.check(c?.keys?.length === 1, 'compliment sent', c);
      }
      const hist = await f.call('orders.history', () => customer.api.orders.history.query({}));
      f.check(hist, 'history answers');
      // «نسيت غرض»: the chat with the driver reopens after the ride.
      const lost = await f.call('chat.lostItem', () =>
        customer.api.chat.lostItem.mutate({ orderId: placed.ride.id }),
      );
      f.check(lost, 'the lost-item chat opens');
    },

    async sosend(f) {
      const customer = await h.signIn(f, h.newPhone(), 'زبون طوارئ ٢');
      if (!customer) return;
      const placed = await h.placeRide(f, customer, { withQuoteId: true });
      if (!placed) return;
      const sos = await f.call('safety.sos', () =>
        customer.api.safety.sos.mutate({
          subject: { kind: 'order', id: placed.ride.id },
          position: { ...h.PICKUP.pin, accuracyM: 10, at: new Date() },
          clientId: `sos_${f.name}_${h.RUN}`,
        }),
      );
      const incidentId = sos?.incidentId ?? sos?.id;
      if (!f.check(incidentId, 'safety.sos opens an incident (no emergency contact set)', sos))
        return;
      f.subject(incidentId);
      await f.call('safety.position', () =>
        customer.api.safety.position.mutate({
          incidentId,
          position: { ...h.PICKUP.pin, accuracyM: 8, at: new Date() },
        }),
      );
      const c = await f.call('safety.cancel', () =>
        customer.api.safety.cancel.mutate({ incidentId }),
      );
      f.check(c, 'he cancels the alarm', c?.state);
    },

    async household(f) {
      const a = await h.admin(f);
      const payer = await h.signIn(f, h.newPhone(), 'أبو علي');
      const memberPhone = h.newPhone();
      const member = await h.signIn(f, memberPhone, 'علي');
      if (!a || !payer || !member) return;
      const kitchen = await openKitchen(h, f, a);
      if (!kitchen) return;
      const home = await f.call('household.create', () =>
        payer.api.household.create.mutate({ name: 'بيت أبو علي' }),
      );
      if (!f.check(home?.id, 'household created', home)) return;
      f.subject(home.id);
      await f.call('household.inviteMember', () =>
        payer.api.household.inviteMember.mutate({
          householdId: home.id,
          phone: memberPhone,
          role: 'orderer',
        }),
      );
      await f.call('household.setBudget', () =>
        payer.api.household.setBudget.mutate({
          householdId: home.id,
          personId: member.personId,
          monthlyBudgetIqd: 1000,
        }),
      );
      const mine = await f.call('household.mine(member)', () => member.api.household.mine.query());
      f.check(mine?.id === home.id, 'the member sees the household', mine?.id);
      for (const answer of ['approve', 'decline']) {
        const order = await placeFood(h, f, member, kitchen.orgId, answer, {
          householdOrgId: home.id,
        });
        if (!order) return;
        const req = await until(h, async () => {
          const list = await f.call('household.approvals', () =>
            payer.api.household.approvals.query({ householdId: home.id }),
          );
          return list?.find?.((r) => r.orderId === order.id && r.state === 'pending') ?? null;
        });
        if (!f.check(req, `the payer is asked (${answer})`)) return;
        const r = await f.call(`household.${answer}`, () =>
          payer.api.household[answer].mutate({ requestId: req.id }),
        );
        f.check(r, `payer ${answer}s`, r);
        const t = await until(h, async () => {
          const x = await f.call('orders.track', () =>
            member.api.orders.track.query({ orderId: order.id }),
          );
          const moved =
            answer === 'approve'
              ? x?.order && !x.order.heldForPayer
              : x?.order?.state?.endsWith('cancelled');
          return moved ? x : null;
        });
        f.check(
          t,
          answer === 'approve' ? 'the order goes on to the kitchen' : 'the order is cancelled',
        );
      }
    },

    async seats(f) {
      const a = await h.admin(f);
      const customer = await h.signIn(f, h.newPhone(), 'زبون الرجعة');
      if (!a || !customer) return;
      const driver = await staffMember(h, f, a, 'intercity_driver', 'جاسم');
      if (!driver) return;
      const CORRIDOR = 'aziziyah_baghdad';
      const departAt = new Date(Math.ceil((Date.now() + 45 * 60_000) / 900_000) * 900_000);
      const dep = await f.call('routes.driver.announce', () =>
        driver.api.routes.driver.announce.mutate({
          garageId: 'mp_garage_nahdha',
          corridorId: CORRIDOR,
          departAt,
          latestDepartureAt: new Date(departAt.getTime() + 40 * 60_000),
          vehicle: {
            kind: 'saloon',
            layout: 4,
            plate: '12345 بغداد',
            model: 'كامري',
            color: 'بيضاء',
          },
        }),
      );
      if (!f.check(dep?.id, 'departure announced', dep)) return;
      f.subject(dep.id);
      const board = await f.call('routes.board', () =>
        customer.api.routes.board.query({
          corridorId: CORRIDOR,
          direction: 'to_aziziyah',
          travellingAs: 'rijal',
        }),
      );
      f.check(JSON.stringify(board ?? '').includes(dep.id), 'the car is on the board');
      const spare = await f.call('routes.holdSeat(back)', () =>
        customer.api.routes.holdSeat.mutate({
          departureId: dep.id,
          selection: { kind: 'seats', seatIds: ['back_left'] },
          travellingAs: 'rijal',
        }),
      );
      if (spare?.id) {
        f.subject(spare.id);
        const c = await f.call('routes.cancelSeat', () =>
          customer.api.routes.cancelSeat.mutate({ bookingId: spare.id }),
        );
        f.check(c, 'a held seat is let go');
      }
      const hold = await f.call('routes.holdSeat(front)', () =>
        customer.api.routes.holdSeat.mutate({
          departureId: dep.id,
          selection: { kind: 'seats', seatIds: ['front'] },
          travellingAs: 'rijal',
        }),
      );
      if (!f.check(hold?.id, 'front seat held', hold)) return;
      f.subject(hold.id);
      const booked = await f.call('routes.bookSeat', () =>
        customer.api.routes.bookSeat.mutate({ bookingId: hold.id, payment: 'cash' }),
      );
      f.check(booked, 'seat booked (cash)', booked?.state);
      const pass = await f.call('routes.boardingPass', () =>
        customer.api.routes.boardingPass.query({ bookingId: hold.id }),
      );
      if (!f.check(pass?.pin, 'boarding pass has a PIN')) return;
      const dv = await f.call('routes.driver.departure', () =>
        driver.api.routes.driver.departure.query({ departureId: dep.id }),
      );
      f.check(
        dv?.bookings?.some((b) => b.bookingId === hold.id),
        'the driver sees the booking',
      );
      await f.call('routes.imHere', () =>
        customer.api.routes.imHere.mutate({ bookingId: hold.id, lat: 33.3344, lng: 44.4165 }),
      );
      const ci = await f.call('routes.driver.checkIn', () =>
        driver.api.routes.driver.checkIn.mutate({ departureId: dep.id, pin: pass.pin }),
      );
      f.check(
        ci?.bookings?.find((b) => b.bookingId === hold.id)?.state === 'checked_in',
        'PIN check-in',
      );
      // Three walk-ups at the garage fill the car (a car leaves early only when full).
      for (const seatId of ['back_left', 'back_middle', 'back_right'])
        await f.call(`routes.driver.markWalkUp(${seatId})`, () =>
          driver.api.routes.driver.markWalkUp.mutate({
            departureId: dep.id,
            seatId,
            travellingAs: 'rijal',
          }),
        );
      const gone = await f.call('routes.driver.depart', () =>
        driver.api.routes.driver.depart.mutate({ departureId: dep.id }),
      );
      f.check(gone, 'car departs');
      const there = await f.call('routes.driver.arrive', () =>
        driver.api.routes.driver.arrive.mutate({ departureId: dep.id }),
      );
      f.check(there, 'car arrives');
      const r = await f.call('routes.rateBooking', () =>
        customer.api.routes.rateBooking.mutate({ bookingId: hold.id, stars: 5 }),
      );
      f.check(r, 'rider rates the trip');
    },

    async board(f) {
      const a = await h.admin(f);
      const rider = await h.signIn(f, h.newPhone(), 'زبون الطلبات');
      if (!a || !rider) return;
      const driver = await staffMember(h, f, a, 'intercity_driver', 'كريم');
      if (!driver) return;
      if (!(await topUp(f, a, rider, 20_000))) return;
      const post = async (minutes, tag) => {
        const r = await f.call(`routes.requestBoard.post(${tag})`, () =>
          rider.api.routes.requestBoard.post.mutate({
            from: { label: 'البوابة ١', garageId: 'mp_garage_bab1' },
            to: { label: 'الصويرة' },
            when: new Date(Date.now() + minutes * 60_000),
            seats: 1,
            travellingAs: 'aila',
          }),
        );
        if (!f.check(r?.id, `request posted (${tag})`, r)) return null;
        f.subject(r.id);
        const o = await f.call(`routes.requestBoard.offer(${tag})`, () =>
          driver.api.routes.requestBoard.offer.mutate({ postId: r.id, priceIqd: 25_000 }),
        );
        const offerId = o?.offers?.at(-1)?.id;
        if (!f.check(offerId, `driver offers (${tag})`, o)) return null;
        const p = await f.call(`routes.requestBoard.pick(${tag})`, () =>
          rider.api.routes.requestBoard.pick.mutate({ postId: r.id, offerId }),
        );
        return f.check(p?.state === 'matched', `rider picks him (${tag})`, p?.state) ? r : null;
      };
      const done = await post(200, 'ride');
      if (!done) return;
      await f.call('routes.requestBoard.arrived', () =>
        driver.api.routes.requestBoard.arrived.mutate({ postId: done.id, lat: 32.9, lng: 45.07 }),
      );
      const c = await f.call('routes.requestBoard.complete', () =>
        driver.api.routes.requestBoard.complete.mutate({ postId: done.id }),
      );
      f.check(c?.state === 'completed', 'driver completes the ride', c?.state);
      // The wallet carries the 20 % deposit: 5,000 of the 25,000 comes off it once the ride is done …
      const wallet = (want, what) =>
        until(h, async () => {
          const b = await f.call('wallet.balance', () => rider.api.wallet.balance.query());
          return b?.moneyIqd === want ? b : null;
        }).then((b) => f.check(b, what, { want }));
      await wallet(15_000, 'the deposit pays part of the done ride');
      // … and goes to the driver when the rider cancels inside the last hour.
      const late = await post(30, 'late cancel');
      if (!late) return;
      const x = await f.call('routes.requestBoard.cancel', () =>
        rider.api.routes.requestBoard.cancel.mutate({ postId: late.id }),
      );
      f.check(x?.state === 'cancelled', 'rider cancels inside the last hour', x?.state);
      await wallet(10_000, 'the deposit goes to the driver');
    },
    async profile(f) {
      const p = await h.signIn(f, h.newPhone(), 'زبون الملف');
      if (!p) return;
      const me = await f.call('identity.updateProfile(trusted contacts)', () =>
        p.api.identity.updateProfile.mutate({
          trustedContacts: [
            { name: 'أمي', phone: h.newPhone(), relation: 'mother' },
            { name: 'أخوي', phone: h.newPhone(), relation: 'sibling' },
          ],
        }),
      );
      f.check(
        me?.emergencyContact,
        'the first trusted person is the emergency contact',
        me?.emergencyContact,
      );
      const kept = await f.call('identity.updateProfile(keep one)', () =>
        p.api.identity.updateProfile.mutate({ trustedContacts: [{ keep: 1 }] }),
      );
      f.check(
        kept?.emergencyContact?.name === 'أخوي',
        'keeping one contact keeps his number',
        kept?.emergencyContact,
      );
      const token = `ExponentPushToken[e2e-${h.RUN}-${f.name}]`;
      const reg = await f.call('notify.registerDevice', () =>
        p.api.notify.registerDevice.mutate({
          token,
          app: 'customer',
          platform: 'android',
          appVersion: '1.0.0',
        }),
      );
      f.check(reg !== undefined, 'device registered');
      const prefs = await f.call('notify.preferences', () => p.api.notify.preferences.query());
      if (f.check(prefs, 'notification settings read')) {
        const set = await f.call('notify.setPreferences', () =>
          p.api.notify.setPreferences.mutate(prefs),
        );
        f.check(set, 'notification settings saved');
      }
      const un = await f.call('notify.unregisterDevice', () =>
        p.api.notify.unregisterDevice.mutate({ token }),
      );
      f.check(un !== undefined, 'device unregistered');
      const kid = await f.call('identity.registerChild', () =>
        p.api.identity.registerChild.mutate({ name: 'زينب' }),
      );
      f.check(kid?.childRef, 'a child added for خطوط', kid);
      const kids = await f.call('identity.myChildren', () => p.api.identity.myChildren.query());
      f.check(
        kids?.some?.((k) => k.childRef === kid?.childRef),
        'the child is listed',
        kids,
      );
      const out = await f.call('identity.logout', () => p.api.identity.logout.mutate({}));
      f.check(out !== undefined, 'signed out');
    },

    async places(f) {
      const p = await h.signIn(f, h.newPhone(), 'زبون الأماكن');
      if (!p) return;
      const zone = await f.call('places.zoneFor', () =>
        p.api.places.zoneFor.query({ cityId: h.CITY, pin: h.HOME.pin }),
      );
      f.check(zone, 'the pin falls in a zone', zone);
      const saved = await f.call('places.save', () =>
        p.api.places.save.mutate({
          label: 'home',
          name: 'البيت',
          pin: h.HOME.pin,
          note: 'باب أخضر',
        }),
      );
      const id = saved?.id ?? saved?.placeId;
      if (!f.check(id, 'home saved', saved)) return;
      f.subject(id);
      const up = await f.call('places.update', () =>
        p.api.places.update.mutate({ placeId: id, name: 'بيت أهلي' }),
      );
      f.check(up, 'renamed');
      const again = await f.call('places.save(double tap)', () =>
        p.api.places.save.mutate({ label: 'work', name: 'الدائرة', pin: h.DROPOFF.pin }),
      );
      f.check(again, 'work saved');
      const mine = await f.call('places.mine', () => p.api.places.mine.query());
      f.check(JSON.stringify(mine ?? '').includes('بيت أهلي'), 'his places list the new name');
      const rm = await f.call('places.remove', () => p.api.places.remove.mutate({ placeId: id }));
      f.check(rm !== undefined, 'removed');
    },

    async browse(f) {
      const p = await h.signIn(f, h.newPhone(), 'زبون التصفح');
      if (!p) return;
      const list = await f.call('catalog.restaurants', () =>
        p.api.catalog.restaurants.query({ cityId: h.CITY, dropoff: h.HOME }),
      );
      if (!f.check(list?.length > 0, 'restaurants listed', list?.length)) return;
      const found = await f.call('catalog.search', () =>
        p.api.catalog.search.query({ cityId: h.CITY, query: 'كص', dropoff: h.HOME }),
      );
      f.check(found, 'search answers');
      const menu = await f.call('catalog.menu', () =>
        p.api.catalog.menu.query({ merchantId: list[0].id ?? list[0].merchantId, dropoff: h.HOME }),
      );
      const item = menu?.categories?.flatMap((c) => c.items)[0];
      if (f.check(item, 'a menu with a dish')) {
        const on = await f.call('catalog.followDish', () =>
          p.api.catalog.followDish.mutate({
            merchantOrgId: list[0].id ?? list[0].merchantId,
            itemId: item.id,
            on: true,
          }),
        );
        f.check(on !== undefined, 'dish followed');
        const follows = await f.call('catalog.dishFollows', () =>
          p.api.catalog.dishFollows.query(),
        );
        f.check(follows?.itemIds?.includes(item.id), 'the follow is kept', follows);
      }
      const inv = await f.call('referral.mine', () => p.api.referral.mine.query());
      if (f.check(inv?.code, 'his invitation code', inv)) {
        const friend = await h.signIn(f, h.newPhone(), 'صديق');
        const pre = await f.call('referral.preview', () =>
          f.client().referral.preview.query({ code: inv.code }),
        );
        f.check(pre?.valid, 'the invitation page reads it', pre);
        if (friend) {
          const cl = await f.call('referral.claim', () =>
            friend.api.referral.claim.mutate({ code: inv.code }),
          );
          f.check(cl?.ok, 'the friend accepts the invitation', cl);
        }
      }
      const opts = await f.call('wallet.topupOptions', () => p.api.wallet.topupOptions.query());
      f.check(opts, 'top-up options');
      const tx = await f.call('wallet.transactions', () => p.api.wallet.transactions.query({}));
      f.check(tx, 'wallet history');
    },

    async later(f) {
      const a = await h.admin(f);
      const customer = await h.signIn(f, h.newPhone(), 'زبون العزيمة');
      if (!a || !customer) return;
      const kitchen = await openKitchen(h, f, a);
      if (!kitchen) return;
      const at = new Date(Math.ceil((Date.now() + 2 * 3600_000) / 900_000) * 900_000);
      const sched = await placeFood(h, f, customer, kitchen.orgId, 'scheduled', {
        scheduledFor: at,
      });
      if (sched) {
        f.check(
          new Date(sched.scheduledFor).getTime() === at.getTime(),
          'the order keeps its time',
          sched.scheduledFor,
        );
        const c = await f.call('orders.cancel(scheduled)', () =>
          customer.api.orders.cancel.mutate({ orderId: sched.id }),
        );
        f.check(c?.state === 'customer_cancelled', 'a scheduled order cancels free', c?.state);
      }
      if (!(await topUp(f, a, customer, 20_000))) return;
      const friendPhone = h.newPhone();
      const gift = await placeFood(h, f, customer, kitchen.orgId, 'gift', {
        gift: { hidePrices: true },
        participants: [{ ref: 'friend', role: 'recipient', phone: friendPhone, label: 'حسن' }],
        paymentMethod: 'wallet',
      });
      if (gift) f.check(gift.gift?.hidePrices === true, 'a gift with the prices hidden', gift.gift);
      const demand = await f.call('routes.postDemand', () =>
        customer.api.routes.postDemand.mutate({
          corridorId: 'aziziyah_baghdad',
          direction: 'from_aziziyah',
          windowStart: new Date(Date.now() + 3 * 3600_000),
          windowEnd: new Date(Date.now() + 5 * 3600_000),
          seats: 2,
          travellingAs: 'aila',
        }),
      );
      const postId = demand?.id ?? demand?.postId;
      if (f.check(postId, 'a seat wish posted for الرجعة', demand)) {
        f.subject(postId);
        const mine = await f.call('routes.myDemand', () => customer.api.routes.myDemand.query());
        f.check(JSON.stringify(mine ?? '').includes(postId), 'he sees his wish');
        const x = await f.call('routes.cancelDemand', () =>
          customer.api.routes.cancelDemand.mutate({ postId }),
        );
        f.check(x !== undefined, 'wish withdrawn');
      }
    },
    async doubletap(f) {
      // Two taps that land together (RDB-04): either may lose politely (4xx), neither may crash (5xx).
      const p = await h.signIn(f, h.newPhone(), 'زبون مستعجل');
      if (!p) return;
      const menu = await f.call('catalog.menu', () =>
        p.api.catalog.menu.query({ merchantId: 'org_aziziyah_khalid', dropoff: h.HOME }),
      );
      const item = menu?.categories?.flatMap((c) => c.items)[0];
      if (!f.check(item, 'a dish to follow')) return;
      const twice = async (what, fn) => {
        const out = await Promise.allSettled([fn(), fn()]);
        for (const r of out) {
          const status =
            r.status === 'rejected'
              ? (r.reason?.data?.httpStatus ?? r.reason?.meta?.response?.status)
              : 200;
          if (typeof status === 'number' && status >= 500)
            f.http5xx.push(`${what}: ${status} ${r.reason?.message}`);
        }
        f.check(
          out.some((r) => r.status === 'fulfilled'),
          `${what}: one of the two taps lands`,
          out.map((r) => r.status),
        );
      };
      await twice('catalog.followDish ×2', () =>
        p.api.catalog.followDish.mutate({
          merchantOrgId: 'org_aziziyah_khalid',
          itemId: item.id,
          on: true,
        }),
      );
      await twice('places.save ×2', () =>
        p.api.places.save.mutate({ label: 'home', name: 'البيت', pin: h.HOME.pin }),
      );
      await twice('identity.updateProfile ×2', () =>
        p.api.identity.updateProfile.mutate({ name: 'زبون مستعجل' }),
      );
      await twice('wallet.requestTopUp ×2', () =>
        p.api.wallet.requestTopUp.mutate({ amountIqd: 5000 }),
      );
    },
  };
}
