import { describe, expect, it } from 'vitest';
import { HoldSeatInput, type DriverError } from '@driver/contracts';
import { offsetNorth } from '../trips/index.js';
import { bookingTotal } from './model.js';
import { BAB1, NAHDHA, routesHarness } from './test-harness.js';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as DriverError).code ?? String(err);
  }
  return 'no error';
}

/** On the Baghdad road between the المدائن junction and the Diyala bridge. */
const ON_ROAD = { lat: 33.1667, lng: 44.5517 };
/** 18 km east of the road. */
const OFF_ROAD = { lat: 33.1667, lng: 44.75 };
/** A door in Baghdad, about 4 km from the النهضة garage. */
const BAGHDAD_DOOR = { lat: 33.3, lng: 44.4 };

describe('agreed trip prices (step 4a): ask → the driver prices → the rider accepts → locked on the booking', () => {
  it('a pin on the way and a door in Baghdad are priced by the driver, added to the total, and locked when booked', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const pin = await h.agreements.ask('r1', { departureId: dep.id, kind: 'pin_pickup', ...ON_ROAD, note: 'جنب السيطرة' });
    const door = await h.agreements.ask('r1', { departureId: dep.id, kind: 'door_drop', ...BAGHDAD_DOOR });
    expect(pin).toMatchObject({ state: 'asked', amountIqd: null, driverId: 'd1', note: 'جنب السيطرة' });

    await h.agreements.propose('d1', { agreementId: pin.id, amountIqd: 2_000 });
    await h.agreements.propose('d1', { agreementId: door.id, amountIqd: 0 }); // «ببلاش»
    await h.agreements.respond('r1', { agreementId: pin.id, accept: true });
    await h.agreements.respond('r1', { agreementId: door.id, accept: true });

    const held = await h.departures.hold(
      'r1',
      HoldSeatInput.parse({
        departureId: dep.id,
        selection: { kind: 'seats', seatIds: ['back_left'] },
        travellingAs: 'rijal',
        pickup: { kind: 'pin', agreementId: pin.id },
        dropoff: { agreementId: door.id },
      }),
    );
    expect(held.pickup).toMatchObject({ kind: 'pin', status: 'accepted', feeIqd: 2_000, agreementId: pin.id, note: 'جنب السيطرة' });
    expect(held.dropoff).toMatchObject({ agreementId: door.id, lat: BAGHDAD_DOOR.lat });
    expect(held.dropoffFeeIqd).toBe(0);
    expect(bookingTotal(held)).toBe(5_000 + 2_000);

    h.wallet.set('r1', 50_000);
    const booked = await h.departures.book('r1', held.id, 'wallet');
    expect(booked.state).toBe('booked');
    expect((await h.repo.getAgreement(pin.id))).toMatchObject({ state: 'used', bookingId: booked.id });
    expect((await h.repo.getAgreement(door.id))).toMatchObject({ state: 'used', bookingId: booked.id });
    expect(h.events.ofType('agreement.asked')).toHaveLength(2);
    expect(h.events.ofType('agreement.proposed')).toHaveLength(2);
    expect(h.events.ofType('agreement.accepted')).toHaveLength(2);
  });

  it('a booking cannot name a price that is not accepted, not his, or for another kind', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const pin = await h.agreements.ask('r1', { departureId: dep.id, kind: 'pin_pickup', ...ON_ROAD });
    expect(await code(h.hold('r1', dep.id, ['front'], 'rijal', { kind: 'pin', agreementId: pin.id }))).toBe('agreement_state_conflict');
    await h.agreements.propose('d1', { agreementId: pin.id, amountIqd: 1_000 });
    await h.agreements.respond('r1', { agreementId: pin.id, accept: true });
    expect(await code(h.hold('r2', dep.id, ['front'], 'rijal', { kind: 'pin', agreementId: pin.id }))).toBe('agreement_not_found');
    expect(
      await code(
        h.departures.hold(
          'r1',
          HoldSeatInput.parse({
            departureId: dep.id,
            selection: { kind: 'seats', seatIds: ['front'] },
            travellingAs: 'rijal',
            pickup: { kind: 'garage' },
            dropoff: { agreementId: pin.id },
          }),
        ),
      ),
    ).toBe('agreement_not_found');
  });
});

describe('agreement rules (a1–a4, a7)', () => {
  it('places: a pin near the road but outside the home door area; a door near the far garage', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const ask = (kind: 'pin_pickup' | 'door_drop', p: { lat: number; lng: number }) =>
      code(h.agreements.ask('r1', { departureId: dep.id, kind, ...p }));
    expect(await ask('pin_pickup', OFF_ROAD)).toBe('agreement_place_invalid');
    expect(await ask('pin_pickup', offsetNorth(BAB1, 3_000))).toBe('agreement_place_invalid'); // the door price covers home
    expect(await ask('door_drop', { lat: 33.0985, lng: 44.5802 })).toBe('agreement_place_invalid'); // المدائن, ~29 km out
    expect(await ask('door_drop', offsetNorth(NAHDHA, 20_000))).toBe('no error');
    expect(await ask('pin_pickup', ON_ROAD)).toBe('no error');
  });

  it('only the departure\'s driver prices, in whole 1,000s from 0 to 25,000; the rider cannot accept an unpriced ask', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const a = await h.agreements.ask('r1', { departureId: dep.id, kind: 'pin_pickup', ...ON_ROAD });
    expect(await code(h.agreements.respond('r1', { agreementId: a.id, accept: true }))).toBe('agreement_state_conflict');
    expect(await code(h.agreements.propose('d2', { agreementId: a.id, amountIqd: 1_000 }))).toBe('not_departure_driver');
    expect(await code(h.agreements.propose('d1', { agreementId: a.id, amountIqd: 1_500 }))).toBe('agreement_amount_invalid');
    expect(await code(h.agreements.propose('d1', { agreementId: a.id, amountIqd: 26_000 }))).toBe('agreement_amount_invalid');
    expect(await code(h.agreements.respond('r2', { agreementId: a.id, accept: true }))).toBe('agreement_not_found');
    expect(await code(h.agreements.ask('d1', { departureId: dep.id, kind: 'pin_pickup', ...ON_ROAD }))).toBe('forbidden');
    const priced = await h.agreements.propose('d1', { agreementId: a.id, amountIqd: 25_000 });
    expect(priced).toMatchObject({ state: 'proposed', amountIqd: 25_000 });
    const lower = await h.agreements.propose('d1', { agreementId: a.id, amountIqd: 3_000 });
    expect(lower.amountIqd).toBe(3_000);
    expect(await h.agreements.respond('r1', { agreementId: a.id, accept: false })).toMatchObject({ state: 'declined' });
  });

  it('one live ask per kind: a new ask withdraws the older one; six asks per departure at most', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const first = await h.agreements.ask('r1', { departureId: dep.id, kind: 'pin_pickup', ...ON_ROAD });
    await h.agreements.ask('r1', { departureId: dep.id, kind: 'pin_pickup', ...ON_ROAD });
    expect((await h.repo.getAgreement(first.id))?.state).toBe('withdrawn');
    for (let i = 0; i < 4; i++) await h.agreements.ask('r1', { departureId: dep.id, kind: 'door_drop', ...BAGHDAD_DOOR });
    expect(await code(h.agreements.ask('r1', { departureId: dep.id, kind: 'door_drop', ...BAGHDAD_DOOR }))).toBe('agreement_limit');
    const live = (await h.agreements.mine('r1', dep.id)).filter((a) => a.state === 'asked');
    expect(live.map((a) => a.kind).sort()).toEqual(['door_drop', 'pin_pickup']);
  });

  it('a7: an unanswered price expires after 30 minutes (the driver may price it again); an unpriced ask when the car must have left', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const a = await h.agreements.ask('r1', { departureId: dep.id, kind: 'pin_pickup', ...ON_ROAD });
    const b = await h.agreements.ask('r2', { departureId: dep.id, kind: 'door_drop', ...BAGHDAD_DOOR });
    await h.agreements.propose('d1', { agreementId: a.id, amountIqd: 2_000 });
    expect((await h.tickAt(29)).agreementsExpired).toBe(0);
    expect((await h.tickAt(2)).agreementsExpired).toBe(1);
    expect(await code(h.agreements.respond('r1', { agreementId: a.id, accept: true }))).toBe('agreement_state_conflict');
    expect(await h.agreements.propose('d1', { agreementId: a.id, amountIqd: 1_000 })).toMatchObject({ state: 'proposed' });
    expect((await h.repo.getAgreement(b.id))?.state).toBe('asked');
    await h.agreements.respond('r1', { agreementId: a.id, accept: true });
    await h.tickAt(150);
    expect((await h.repo.getAgreement(b.id))?.state).toBe('expired');
    expect((await h.repo.getAgreement(a.id))?.state).toBe('accepted');
  });
});

describe('a5: a price accepted after booking replaces the old one until the car leaves', () => {
  it('the new price goes on the booked seat and the old agreement is withdrawn; a prepaid seat must still be covered', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    const first = await h.agreements.ask('r1', { departureId: dep.id, kind: 'door_drop', ...BAGHDAD_DOOR });
    await h.agreements.propose('d1', { agreementId: first.id, amountIqd: 2_000 });
    await h.agreements.respond('r1', { agreementId: first.id, accept: true });
    const held = await h.departures.hold(
      'r1',
      HoldSeatInput.parse({
        departureId: dep.id,
        selection: { kind: 'seats', seatIds: ['back_left'] },
        travellingAs: 'rijal',
        pickup: { kind: 'garage' },
        dropoff: { agreementId: first.id },
      }),
    );
    h.wallet.set('r1', 9_000);
    const booked = await h.departures.book('r1', held.id, 'wallet');
    expect(bookingTotal(booked)).toBe(7_000);

    const pricier = await h.agreements.ask('r1', { departureId: dep.id, kind: 'door_drop', ...offsetNorth(NAHDHA, 15_000) });
    await h.agreements.propose('d1', { agreementId: pricier.id, amountIqd: 5_000 });
    expect(await code(h.agreements.respond('r1', { agreementId: pricier.id, accept: true }))).toBe('wallet_insufficient');
    // Nothing was written: the price is still waiting for an answer and the booking is unchanged.
    expect((await h.repo.getAgreement(pricier.id))?.state).toBe('proposed');
    expect((await h.repo.getAgreement(first.id))?.state).toBe('used');

    await h.agreements.propose('d1', { agreementId: pricier.id, amountIqd: 4_000 });
    await h.agreements.respond('r1', { agreementId: pricier.id, accept: true });
    const after = await h.departures.booking(booked.id);
    expect(after.dropoff?.agreementId).toBe(pricier.id);
    expect(bookingTotal(after)).toBe(9_000);
    expect((await h.repo.getAgreement(pricier.id))).toMatchObject({ state: 'used', bookingId: booked.id });
    expect((await h.repo.getAgreement(first.id))?.state).toBe('withdrawn');
    expect(h.events.ofType('seat.agreement_applied')).toHaveLength(1);
  });
});

describe('who sees what', () => {
  it('the rider sees only his own; the driver sees every ask on his run with the rider\'s first name (vault read logged)', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    h.riderNames.set('r1', 'علي حسين');
    const actor = (personId: string) => ({ personId, sessionId: 's', roles: [] }) as never;
    await h.rpc.askAgreement(actor('r1'), { departureId: dep.id, kind: 'pin_pickup', ...ON_ROAD });
    await h.rpc.askAgreement(actor('r2'), { departureId: dep.id, kind: 'door_drop', ...BAGHDAD_DOOR });
    const mine = await h.rpc.myAgreements(actor('r1'), { departureId: dep.id });
    expect(mine.map((a) => [a.riderId, a.riderFirstName])).toEqual([['r1', null]]);
    const all = await h.rpc.departureAgreements(actor('d1'), { departureId: dep.id });
    expect(all.map((a) => a.riderFirstName).sort()).toEqual([null, 'علي']);
    expect(h.nameReads.filter((r) => r.accessorId === 'd1' && r.purpose === 'intercity_manifest')).toHaveLength(2);
    expect(await code(h.rpc.departureAgreements(actor('d2'), { departureId: dep.id }))).toBe('not_departure_driver');
  });
});
