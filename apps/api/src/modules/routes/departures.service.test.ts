import { describe, expect, it } from 'vitest';
import { AnnounceInput, HoldSeatInput, type DriverError } from '@driver/contracts';
import { offsetNorth } from '../trips/index.js';
import type { BookingRecord } from './model.js';
import { BAB1, BAB2, NAHDHA, routesHarness } from './test-harness.js';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as DriverError).code ?? String(err);
  }
  return 'no error';
}

describe('announce (driver)', () => {
  it('a run from an Aziziyah garage goes to the far end; from النهضة it is الرجعة, priced from the corridor', async () => {
    const h = routesHarness();
    const out = await h.announce();
    expect(out).toMatchObject({
      state: 'scheduled',
      direction: 'from_aziziyah',
      fromCityId: 'aziziyah',
      toCityId: 'baghdad',
      seatPriceIqd: 10_000,
      frontPremiumIqd: 2_000,
      layout: 4,
    });
    const back = await h.announce({ driverId: 'd2', garageId: NAHDHA.id });
    expect(back).toMatchObject({
      direction: 'to_aziziyah',
      fromCityId: 'baghdad',
      toCityId: 'aziziyah',
    });
    expect(h.events.ofType('departure.scheduled')).toHaveLength(2);
  });

  it('refuses a garage off the corridor, a latest departure too far out, an overlapping run, an unknown garage', async () => {
    const h = routesHarness();
    expect(await code(h.announce({ garageId: NAHDHA.id, corridorId: 'aziziyah_kut' }))).toBe(
      'announce_invalid',
    );
    expect(await code(h.announce({ latestDepartureAt: h.at(120 + 121) }))).toBe('announce_invalid');
    expect(await code(h.announce({ departAt: h.at(-30), latestDepartureAt: h.at(0) }))).toBe(
      'announce_invalid',
    );
    expect(await code(h.announce({ garageId: 'nowhere' }))).toBe('garage_not_found');
    await h.announce();
    expect(await code(h.announce({ departAt: h.at(150), latestDepartureAt: h.at(160) }))).toBe(
      'announce_invalid',
    );
    expect(() =>
      AnnounceInput.parse({
        garageId: BAB1.id,
        corridorId: 'aziziyah_baghdad',
        departAt: h.at(60),
        latestDepartureAt: h.at(30),
        vehicle: { kind: 'saloon', layout: 4, plate: 'x 1' },
      }),
    ).toThrow();
  });
});

describe('seat state machine: held (10 min) → booked → checked_in → completed', () => {
  it('a hold is free for 10 minutes with a PIN; nobody else can take the seat meanwhile; then it lapses', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const held = await h.hold('r1', dep.id, ['back_left']);
    expect(held).toMatchObject({ state: 'held', seatIds: ['back_left'], payment: null });
    expect(held.pin).toMatch(/^\d{4}$/);
    expect(held.heldUntil?.toISOString()).toBe(h.at(10).toISOString());
    expect(await code(h.hold('r2', dep.id, ['back_left']))).toBe('seat_unavailable');
    expect(await code(h.hold('r1', dep.id, ['back_right']))).toBe('booking_state_conflict');
    await h.tickAt(10);
    expect((await h.departures.booking(held.id)).state).toBe('expired');
    expect(await code(h.departures.book('r1', held.id, 'cash'))).toBe('hold_expired');
    expect((await h.hold('r2', dep.id, ['back_left'])).state).toBe('held');
    expect(h.events.types()).toEqual(expect.arrayContaining(['seat.held', 'seat.hold_expired']));
  });

  it('wallet prepay needs the balance not already held by other prepaid seats', async () => {
    const h = routesHarness();
    const a = await h.announce();
    const b = await h.announce({ driverId: 'd2', garageId: BAB2.id });
    h.wallet.set('r1', 15_000);
    const first = await h.hold('r1', a.id, ['back_left']);
    expect((await h.departures.book('r1', first.id, 'wallet')).prepaid).toBe(true);
    const second = await h.hold('r1', b.id, ['back_left']);
    expect(await code(h.departures.book('r1', second.id, 'wallet'))).toBe('wallet_insufficient');
    expect(await h.departures.walletAvailable('r1')).toBe(5_000);
    const cash = await h.departures.book('r1', second.id, 'cash');
    expect(cash).toMatchObject({
      state: 'booked',
      prepaid: false,
      trusted: false,
      payment: 'cash',
    });
  });

  it('cash reservations: trusted after three completed seats, revoked after two cash no-shows', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const base = (await h.hold('seed', dep.id, ['front'])) as BookingRecord;
    for (let i = 0; i < 3; i += 1)
      await h.repo.saveBooking({ ...base, id: `old_${i}`, riderId: 'r1', state: 'completed' });
    const trusted = await h.departures.book(
      'r1',
      (await h.hold('r1', dep.id, ['back_left'])).id,
      'cash',
    );
    expect(trusted.trusted).toBe(true);
    for (let i = 0; i < 2; i += 1)
      await h.repo.saveBooking({
        ...base,
        id: `ns_${i}`,
        riderId: 'r2',
        state: 'no_show',
        payment: 'cash',
        prepaid: false,
      });
    const held = await h.hold('r2', dep.id, ['back_right']);
    expect(await code(h.departures.book('r2', held.id, 'cash'))).toBe('cash_reservation_revoked');
    h.wallet.set('r2', 10_000);
    expect((await h.departures.book('r2', held.id, 'wallet')).prepaid).toBe(true);
  });

  it('rider cancel: holds always; prepaid until boarding opens at T−30; cash any time before departure', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const held = await h.hold('r1', dep.id, ['back_left']);
    expect((await h.departures.cancel('r1', held.id)).state).toBe('cancelled_by_rider');
    const early = await h.book('r2', dep.id, ['back_left']);
    expect((await h.departures.cancel('r2', early.id)).state).toBe('cancelled_by_rider');
    const prepaid = await h.book('r3', dep.id, ['back_right']);
    const cash = await h.book('r4', dep.id, ['front'], { payment: 'cash' });
    h.advance(95);
    expect(await code(h.departures.cancel('r3', prepaid.id))).toBe('seat_cancel_too_late');
    expect((await h.departures.cancel('r4', cash.id)).state).toBe('cancelled_by_rider');
    expect(await code(h.departures.cancel('r9', prepaid.id))).toBe('booking_not_found');
  });

  it('PIN check-in, arrival completes every checked-in seat and emits one seat.completed per seat', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['front']);
    const b = await h.book('r2', dep.id, ['back_left', 'back_middle'], { payment: 'cash' });
    const c = await h.book('r3', dep.id, ['back_right']);
    await h.driverAt(dep.id);
    expect(await code(h.departures.checkIn('d1', dep.id, '0000'))).toBe('pin_invalid');
    for (const x of [a, b, c]) await h.checkIn(dep.id, x.id);
    expect(await code(h.departures.checkIn('d2', dep.id, a.pin))).toBe('not_departure_driver');
    await h.departures.depart('d1', dep.id); // full car: may leave before the announced time
    await h.departures.arrive('d1', dep.id);
    expect((await h.departures.bookings(dep.id)).map((x) => x.state)).toEqual([
      'completed',
      'completed',
      'completed',
    ]);
    const done = h.events.ofType('seat.completed').map((e) => e.payload);
    expect(done).toHaveLength(4);
    expect(done[0]).toMatchObject({
      seatId: `${a.id}.front`,
      customerId: 'r1',
      payment: 'wallet',
      driverId: 'd1',
      fareIqd: 10_000,
      frontPremiumIqd: 2_000,
      walkUp: false,
    });
    expect(done.filter((p) => p['customerId'] === 'r2').map((p) => p['payment'])).toEqual([
      'cash',
      'cash',
    ]);
    await h.tickAt(121);
    expect((await h.departures.departure(dep.id)).state).toBe('closed');
  });
});

describe('walk-ups (domain §2, review C-32/33)', () => {
  it('booked beats walk-up: a held or booked seat is never given to a walk-up, and a walk-up seat cannot be held', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    await h.hold('r1', dep.id, ['back_left']);
    await h.book('r2', dep.id, ['front']);
    expect(await code(h.departures.markWalkUp('d1', dep.id, { seatId: 'back_left' }))).toBe(
      'walkup_seat_taken',
    );
    expect(await code(h.departures.markWalkUp('d1', dep.id, { seatId: 'front' }))).toBe(
      'walkup_seat_taken',
    );
    await h.departures.markWalkUp('d1', dep.id, { seatId: 'back_right', travellingAs: 'rijal' });
    expect(await code(h.hold('r3', dep.id, ['back_right']))).toBe('seat_unavailable');
    expect(h.events.last('seat.walkup_marked')?.payload).toMatchObject({
      seatId: 'back_right',
      countsTowardFill: false,
    });
  });

  it('walk-ups count toward fill only after the per-run selfie', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    await h.book('r1', dep.id, ['front']);
    await h.departures.markWalkUp('d1', dep.id, { seatId: 'back_left' });
    await h.departures.markWalkUp('d1', dep.id, { seatId: 'back_right' });
    expect(await h.departures.seatsFilled(dep.id)).toBe(1);
    await h.departures.selfie('d1', dep.id, 'selfie/ref1');
    expect(await h.departures.seatsFilled(dep.id)).toBe(3);
    const card = (await h.rpc.board({ personId: 'r9', sessionId: 's' }, { garageId: BAB1.id }))
      .departures[0]!;
    expect(card.fill).toMatchObject({
      seatsTotal: 4,
      booked: 1,
      walkUps: 2,
      walkUpsCounted: 2,
      filled: 3,
      free: 1,
    });
    expect(card.seats.map((s) => s.state)).toEqual(['taken', 'walkup', 'free', 'walkup']);
    expect(card.frontSeat).toBe('taken');
  });

  it('walk-up share > 60 % over the last five departures flags a garage check', async () => {
    const h = routesHarness();
    for (let i = 0; i < 5; i += 1) {
      const dep = await h.announce({ departAt: h.at(5), latestDepartureAt: h.at(10) });
      await h.departures.selfie('d1', dep.id, `s${i}`);
      for (const seat of ['front', 'back_left', 'back_middle', 'back_right'] as const)
        await h.departures.markWalkUp('d1', dep.id, { seatId: seat });
      await h.departures.depart('d1', dep.id);
      await h.departures.arrive('d1', dep.id);
      h.advance(130);
    }
    expect(h.events.ofType('intercity.walkup_share_flagged')).toHaveLength(1);
    expect(h.events.last('intercity.walkup_share_flagged')?.payload).toMatchObject({
      driverId: 'd1',
      share: 1,
    });
  });
});

describe('travelling-as, book the row / the car, family-only (decisions §9)', () => {
  it('a lone woman cannot take back_middle between two male strangers; the board marks it for her', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    await h.book('m1', dep.id, ['back_left']);
    await h.book('m2', dep.id, ['back_right']);
    expect(await code(h.hold('w1', dep.id, ['back_middle'], 'nisa'))).toBe(
      'seat_adjacency_blocked',
    );
    expect((await h.hold('m3', dep.id, ['back_middle'], 'rijal')).state).toBe('held');
    const board = await h.rpc.board(
      { personId: 'w2', sessionId: 's' },
      { garageId: BAB1.id, travellingAs: 'nisa' },
    );
    expect(board.departures[0]!.seats.find((s) => s.id === 'front')?.blocked).toBeNull();
  });

  it('the side seat that would sandwich a booked woman is refused, to riders and to walk-ups alike', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    await h.book('w1', dep.id, ['back_middle'], { travellingAs: 'nisa' });
    await h.book('m1', dep.id, ['back_left']);
    expect(await code(h.hold('m2', dep.id, ['back_right']))).toBe('seat_adjacency_blocked');
    expect(await code(h.departures.markWalkUp('d1', dep.id, { seatId: 'back_right' }))).toBe(
      'seat_adjacency_blocked',
    );
    await h.departures.markWalkUp('d1', dep.id, { seatId: 'back_right', travellingAs: 'nisa' });
    const board = await h.rpc.board(
      { personId: 'x', sessionId: 's' },
      { garageId: BAB1.id, travellingAs: 'rijal' },
    );
    expect(board.departures[0]!.seats.map((s) => s.state)).toEqual([
      'free',
      'taken',
      'taken',
      'walkup',
    ]);
  });

  it('book the row and book the car; a family books the middle seat between its own', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const row = await h.departures.hold(
      'f1',
      HoldSeatInput.parse({
        departureId: dep.id,
        selection: { kind: 'row', row: 'back' },
        travellingAs: 'nisa',
      }),
    );
    expect(row).toMatchObject({
      seatIds: ['back_left', 'back_middle', 'back_right'],
      selection: 'row',
    });
    const van = await h.announce({
      driverId: 'd2',
      garageId: BAB2.id,
      vehicle: { kind: 'van', layout: 7, plate: 'بغداد 7' },
    });
    const car = await h.departures.hold(
      'f2',
      HoldSeatInput.parse({
        departureId: van.id,
        selection: { kind: 'car' },
        travellingAs: 'aila',
      }),
    );
    expect(car.seatIds).toHaveLength(7);
    h.wallet.set('f2', 100_000);
    const booked = await h.departures.book('f2', car.id, 'wallet');
    expect(booked.frontPremiumIqd).toBe(2_000);
    expect(
      await code(
        h.departures.hold(
          'f3',
          HoldSeatInput.parse({
            departureId: dep.id,
            selection: { kind: 'row', row: 'rear' },
            travellingAs: 'aila',
          }),
        ),
      ),
    ).toBe('invalid_input');
  });

  it('family-only departures take family bookings and family walk-ups only', async () => {
    const h = routesHarness();
    const dep = await h.announce({ familyOnly: true });
    expect(await code(h.hold('m1', dep.id, ['front'], 'rijal'))).toBe('family_only_departure');
    expect(await code(h.departures.markWalkUp('d1', dep.id, { seatId: 'front' }))).toBe(
      'family_only_departure',
    );
    expect((await h.hold('f1', dep.id, ['front'], 'aila')).state).toBe('held');
    const board = await h.rpc.board(
      { personId: 'x', sessionId: 's' },
      { garageId: BAB1.id, travellingAs: 'nisa' },
    );
    expect(board.departures[0]!.seats.find((s) => s.id === 'back_left')?.blocked).toBe(
      'family_only',
    );
  });
});

describe('pickups: garage, on-the-way meeting point, door (review C-36/37)', () => {
  it('a meeting point of the corridor adds its fee; one off the corridor is refused', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const b = await h.hold('r1', dep.id, ['back_left'], 'rijal', {
      kind: 'meeting_point',
      meetingPointId: 'mp_ic_madain_junction',
    });
    expect(b.pickup).toMatchObject({ kind: 'meeting_point', feeIqd: 2_000, status: 'accepted' });
    const view = await h.rpc.myBookings({ personId: 'r1', sessionId: 's' });
    expect(view[0]!.totalIqd).toBe(12_000);
    expect(
      await code(
        h.hold('r2', dep.id, ['back_right'], 'rijal', {
          kind: 'meeting_point',
          meetingPointId: 'mp_garage_souq',
        }),
      ),
    ).toBe('pickup_invalid');
  });

  it('door pickups wait for the driver, cost by distance, max two per run within 15 min of detour; declined → garage', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const near = offsetNorth(BAB1, 1_000);
    const a = await h.hold('r1', dep.id, ['front'], 'rijal', { kind: 'door', ...near });
    expect(a.pickup).toMatchObject({
      kind: 'door',
      status: 'pending',
      feeIqd: 1_000,
      detourMin: 6,
    });
    const far = offsetNorth(BAB1, 4_000);
    expect(await code(h.hold('r2', dep.id, ['back_left'], 'rijal', { kind: 'door', ...far }))).toBe(
      'door_pickup_limit',
    );
    const b = await h.hold('r2', dep.id, ['back_left'], 'rijal', {
      kind: 'door',
      ...offsetNorth(BAB1, 1_500),
    });
    expect(b.pickup.feeIqd).toBe(1_000);
    expect(
      await code(h.hold('r3', dep.id, ['back_right'], 'rijal', { kind: 'door', ...near })),
    ).toBe('door_pickup_limit');
    expect(
      await code(
        h.hold('r3', dep.id, ['back_right'], 'rijal', {
          kind: 'door',
          ...offsetNorth(BAB1, 20_000),
        }),
      ),
    ).toBe('pickup_invalid');
    await h.departures.respondPickup('d1', dep.id, b.id, false);
    const declined = await h.departures.booking(b.id);
    expect(declined.pickup).toMatchObject({ kind: 'garage', status: 'accepted', feeIqd: 0 });
    expect(declined.pickupFeeIqd).toBe(0);
    expect(h.events.types()).toContain('pickup.declined');
  });

  it('a pending door pickup blocks departure until the driver answers', async () => {
    const h = routesHarness();
    const dep = await h.announce({ departAt: h.at(5), latestDepartureAt: h.at(30) });
    const a = await h.hold('r1', dep.id, ['front'], 'rijal', {
      kind: 'door',
      ...offsetNorth(BAB1, 800),
    });
    h.wallet.set('r1', 50_000);
    await h.departures.book('r1', a.id, 'wallet');
    h.advance(6);
    const view = await h.rpc.driverDeparture(
      { personId: 'd1', sessionId: 's' },
      { departureId: dep.id },
    );
    expect(view.departBlockers).toEqual([{ bookingId: a.id, reason: 'pickup_pending' }]);
    expect(await code(h.departures.depart('d1', dep.id))).toBe('depart_blocked');
  });

  it("rider at a meeting point > 300 m off is warned (and the driver told); a garage rider's tap inside the geofence is recorded", async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const mp = await h.book('r1', dep.id, ['back_left'], {
      pickup: { kind: 'meeting_point', meetingPointId: 'mp_ic_madain_junction' },
    });
    const out = await h.departures.imHere('r1', mp.id, { lat: 33.11, lng: 44.5802 });
    expect(out.warning).toBe('meeting_point_mismatch');
    expect(h.events.types()).toContain('pickup.mismatch');
    const g = await h.book('r2', dep.id, ['back_right']);
    expect((await h.departures.imHere('r2', g.id, offsetNorth(BAB1, 400))).atGarage).toBe(false);
    expect((await h.departures.imHere('r2', g.id, offsetNorth(BAB1, 100))).atGarage).toBe(true);
    expect((await h.departures.booking(g.id)).atGarageAt).not.toBeNull();
  });
});

describe('depart guard (review C-31/32)', () => {
  it('every booked garage seat must be checked in or a no-show; a rider who tapped أني بالكراج cannot be no-showed', async () => {
    const h = routesHarness();
    const dep = await h.announce({ departAt: h.at(30), latestDepartureAt: h.at(60) });
    const a = await h.book('r1', dep.id, ['front']);
    const b = await h.book('r2', dep.id, ['back_left'], { payment: 'cash' });
    const c = await h.book('r3', dep.id, ['back_right'], { payment: 'cash' });
    await h.driverAt(dep.id);
    await h.checkIn(dep.id, a.id);
    h.advance(31);
    expect(await code(h.departures.depart('d1', dep.id))).toBe('depart_blocked');
    await h.departures.imHere('r2', b.id, BAB1);
    expect(await code(h.departures.markNoShow('d1', dep.id, b.id))).toBe('no_show_not_allowed');
    h.advance(3);
    await h.departures.markNoShow('d1', dep.id, c.id); // cash: 3-minute grace, no meter
    expect(h.events.last('seat.reservation_no_show')?.payload).toMatchObject({
      riderId: 'r3',
      cashStrikes: 1,
      revoked: false,
    });
    expect(await code(h.departures.depart('d1', dep.id))).toBe('depart_blocked');
    await h.checkIn(dep.id, b.id);
    const out = await h.departures.depart('d1', dep.id);
    expect(out.state).toBe('departed');
    expect(h.events.ofType('seat.no_show')).toHaveLength(0);
  });

  it('before the announced time only a full car may leave', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const a = await h.book('r1', dep.id, ['front']);
    await h.driverAt(dep.id);
    await h.checkIn(dep.id, a.id);
    expect(await code(h.departures.depart('d1', dep.id))).toBe('depart_blocked');
    for (const s of ['back_left', 'back_middle', 'back_right'] as const)
      await h.departures.markWalkUp('d1', dep.id, { seatId: s });
    expect((await h.departures.depart('d1', dep.id)).state).toBe('departed');
  });

  it('a prepaid rider with no meter running (alone in the car) can be no-showed only after the hard latest departure', async () => {
    const h = routesHarness();
    const dep = await h.announce({ departAt: h.at(10), latestDepartureAt: h.at(40) });
    const a = await h.book('r1', dep.id, ['front']);
    await h.driverAt(dep.id);
    h.advance(25);
    expect(await code(h.departures.markNoShow('d1', dep.id, a.id))).toBe('no_show_not_allowed');
    h.advance(15);
    await h.departures.markNoShow('d1', dep.id, a.id);
    expect(h.events.last('seat.no_show')?.payload).toMatchObject({
      customerId: 'r1',
      payment: 'wallet',
      fareIqd: 10_000,
      frontPremiumIqd: 2_000,
    });
  });

  it('meeting-point riders board after departure; arrival is blocked until each is checked in or a no-show at the point', async () => {
    const h = routesHarness();
    const dep = await h.announce({ departAt: h.at(5), latestDepartureAt: h.at(30) });
    const g = await h.book('r1', dep.id, ['front']);
    const m = await h.book('r2', dep.id, ['back_left'], {
      pickup: { kind: 'meeting_point', meetingPointId: 'mp_ic_madain_junction' },
    });
    await h.driverAt(dep.id);
    await h.checkIn(dep.id, g.id);
    h.advance(6);
    await h.departures.depart('d1', dep.id);
    expect(await code(h.departures.arrive('d1', dep.id))).toBe('depart_blocked');
    expect(await code(h.departures.markNoShow('d1', dep.id, m.id))).toBe('no_show_not_allowed');
    await h.departures.driverPosition('d1', dep.id, { lat: 33.0986, lng: 44.5803 });
    await h.checkIn(dep.id, m.id);
    expect((await h.departures.arrive('d1', dep.id)).state).toBe('arrived');
  });
});

describe('driver cancel inside 2 h (domain §2, review C-46/48)', () => {
  it('riders move to the next departure in the same seat class; 2,000 per rider credited from the driver', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const next = await h.announce({
      driverId: 'd2',
      garageId: BAB2.id,
      departAt: h.at(150),
      latestDepartureAt: h.at(170),
    });
    const a = await h.book('r1', dep.id, ['front']);
    const b = await h.book('r2', dep.id, ['back_left'], { payment: 'cash' });
    h.advance(30);
    const held = await h.hold('r3', dep.id, ['back_right']);
    await h.departures.cancelByDriver('d1', dep.id, 'سيارتي عطلت');
    expect((await h.departures.departure(dep.id)).state).toBe('cancelled_by_driver');
    const moved = await h.departures.bookings(next.id);
    expect(moved.map((x) => [x.riderId, x.seatIds, x.state, x.origin, x.payment])).toEqual([
      ['r1', ['front'], 'booked', 'moved', 'wallet'],
      ['r2', ['back_left'], 'booked', 'moved', 'cash'],
    ]);
    expect((await h.departures.booking(a.id)).movedToBookingId).toBe(moved[0]!.id);
    expect((await h.departures.booking(held.id)).state).toBe('cancelled');
    expect(h.events.last('departure.cancelled')?.payload).toMatchObject({
      cancelledBy: 'driver',
      feeIqd: 4_000,
      riderIds: ['r1', 'r2'],
      driverId: 'd1',
    });
    expect(h.events.ofType('seat.moved').map((e) => e.payload['refundIqd'])).toEqual([0, 0]);
    expect(h.events.types()).toContain('departure.driver_cancelled_late');
    expect(b.id).not.toBe(moved[1]!.id);
  });

  it('a moved rider never pays more: front taken on the next car → another seat, premium dropped', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const next = await h.announce({
      driverId: 'd2',
      garageId: BAB2.id,
      departAt: h.at(150),
      latestDepartureAt: h.at(170),
    });
    await h.book('x1', next.id, ['front']);
    const a = await h.book('r1', dep.id, ['front']);
    await h.departures.cancelByDriver('d1', dep.id, 'reason');
    const moved = (await h.departures.bookings(next.id)).find((x) => x.riderId === 'r1')!;
    expect(moved.seatIds).not.toContain('front');
    expect(moved.frontPremiumIqd).toBe(0);
    expect(h.events.last('seat.moved')?.payload).toMatchObject({
      bookingId: a.id,
      refundIqd: 2_000,
    });
  });

  it('the fee doubles for departures from 18:00, is zero outside 2 h; no car within 2 h strands the rider onto the request board', async () => {
    const h = routesHarness({ start: '2026-10-03T14:00:00Z' }); // 17:00 Baghdad; departs 19:00
    const dep = await h.announce();
    await h.book('r1', dep.id, ['back_left']);
    await h.departures.cancelByDriver('d1', dep.id, 'reason');
    expect(h.events.last('departure.cancelled')?.payload).toMatchObject({
      feeIqd: 4_000,
      riderIds: ['r1'],
    });
    expect(h.events.last('intercity.rider_stranded')?.payload).toMatchObject({ riderId: 'r1' });
    const posts = await h.requests.mine('r1');
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      origin: 'stranded',
      priceCapIqd: 10_000,
      privateCar: true,
      state: 'open',
    });

    const far = await h.announce({
      driverId: 'd3',
      departAt: h.at(400),
      latestDepartureAt: h.at(420),
    });
    await h.book('r2', far.id, ['back_left']);
    await h.departures.cancelByDriver('d3', far.id, 'reason');
    expect(h.events.last('departure.cancelled')?.payload).toMatchObject({ feeIqd: 0 });
  });
});

describe('low fill at T−30 (domain §2; this module owns the rule)', () => {
  it('fewer than 3 seats (walk-ups counted after the selfie) → cancelled_low_fill and riders moved; otherwise boarding', async () => {
    const h = routesHarness();
    const thin = await h.announce();
    const full = await h.announce({ driverId: 'd2', garageId: BAB2.id });
    const later = await h.announce({
      driverId: 'd3',
      garageId: 'mp_garage_souq',
      departAt: h.at(160),
      latestDepartureAt: h.at(170),
    });
    const a = await h.book('r1', thin.id, ['back_left']);
    await h.book('r2', thin.id, ['back_right'], { payment: 'cash' });
    await h.departures.markWalkUp('d1', thin.id, { seatId: 'front' }); // no selfie: does not count
    await h.book('r3', full.id, ['front']);
    await h.departures.markWalkUp('d2', full.id, { seatId: 'back_left' });
    await h.departures.markWalkUp('d2', full.id, { seatId: 'back_right' });
    await h.departures.selfie('d2', full.id, 'selfie');
    await h.book('r4', later.id, ['front']);
    await h.book('r5', later.id, ['back_left']);
    await h.tickAt(89);
    expect((await h.departures.departure(thin.id)).state).toBe('scheduled');
    const t = await h.tickAt(1);
    expect(t).toMatchObject({ lowFill: 1, boarding: 1 });
    expect((await h.departures.departure(thin.id)).state).toBe('cancelled_low_fill');
    expect((await h.departures.departure(full.id)).state).toBe('boarding');
    expect((await h.departures.booking(a.id)).state).toBe('moved');
    // earliest compatible car first: r1 takes the free middle seat of the full run, r2 goes to the later one
    expect(
      (await h.departures.bookings(full.id))
        .filter((b) => b.state === 'booked')
        .map((b) => [b.riderId, b.seatIds]),
    ).toEqual([
      ['r3', ['front']],
      ['r1', ['back_middle']],
    ]);
    expect((await h.departures.bookings(later.id)).map((b) => b.riderId).sort()).toEqual([
      'r2',
      'r4',
      'r5',
    ]);
    expect(h.events.last('departure.cancelled')?.payload).toMatchObject({
      cancelledBy: 'low_fill',
      feeIqd: 0,
    });
    // the later run's own T−30 check reads the moved riders
    await h.tickAt(40);
    expect((await h.departures.departure(later.id)).state).toBe('boarding');
  });

  it("dispatch's port reads the real fill and its cancel re-applies the rule (refused at or above the minimum)", async () => {
    const h = routesHarness();
    const { RoutesDeparturesPort } = await import('./departures.port.js');
    const port = new RoutesDeparturesPort(h.departures);
    const dep = await h.announce();
    for (const [r, s] of [
      ['r1', 'front'],
      ['r2', 'back_left'],
      ['r3', 'back_right'],
    ] as const)
      await h.book(r, dep.id, [s]);
    expect(await port.seatsFilled(dep.id)).toBe(3);
    expect(await port.seatsFilled('nope')).toBeNull();
    await port.cancelLowFill(dep.id);
    expect((await h.departures.departure(dep.id)).state).toBe('scheduled');
    const thin = await h.announce({ driverId: 'd2', garageId: BAB2.id });
    await h.book('r9', thin.id, ['front']);
    await port.cancelLowFill(thin.id);
    expect((await h.departures.departure(thin.id)).state).toBe('cancelled_low_fill');
  });
});
