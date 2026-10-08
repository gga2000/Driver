import { describe, expect, it } from 'vitest';
import { PostRequestInput, type DriverError } from '@driver/contracts';
import { LEDGER_SUBSCRIBED_EVENTS } from '../ledger/index.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import type { RecordedRoutesEvent } from './events.adapter.js';
import { BAB1, routesHarness, type RoutesHarness } from './test-harness.js';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as DriverError).code ?? String(err);
  }
  return 'no error';
}

/** What the ledger's bus delivers: the envelope merged under the payload, JSON round-tripped. */
async function deliverToLedger(events: readonly RecordedRoutesEvent[], l = ledgerHarness()) {
  for (const e of events) {
    if (!LEDGER_SUBSCRIBED_EVENTS.includes(e.type)) continue;
    await l.bus.publish(
      e.type,
      JSON.parse(
        JSON.stringify({ actorId: e.actorId, occurredAt: e.occurredAt, ...e.payload }),
      ) as Record<string, unknown>,
    );
  }
  return l;
}

const bal = async (l: ReturnType<typeof ledgerHarness>, account: string) =>
  (await l.ledger.balance(account)).amount;

function postRequest(h: RoutesHarness, riderId = 'r1') {
  return h.requests.post(
    riderId,
    PostRequestInput.parse({
      from: { label: 'كراج البوابة ١', garageId: BAB1.id },
      to: { label: 'الصويرة' },
      when: h.at(120),
      seats: 3,
      privateCar: true,
      travellingAs: 'aila',
    }),
  );
}

/** r1 posts; d1 and d2 offer; r1 picks d1's 28,000 (deposit 6,000). */
async function matched(h: RoutesHarness) {
  const r = await postRequest(h);
  const o1 = (await h.requests.offer('d1', r.id, 28_000)).offers.at(-1)!;
  await h.requests.offer('d2', r.id, 40_000);
  h.wallet.set('r1', 20_000);
  await h.requests.pick('r1', r.id, o1.id);
  return r;
}

describe('request board: offers, pick, 20 % deposit (customer spec §2, review C-50)', () => {
  it("offers come in multiples of 1,000; a new offer replaces the same driver's previous one; drivers see only their own price", async () => {
    const h = routesHarness();
    const r = await postRequest(h);
    expect(await code(h.requests.offer('d1', r.id, 25_500))).toBe('offer_price_invalid');
    await h.requests.offer('d1', r.id, 30_000);
    await h.requests.offer('d1', r.id, 28_000);
    await h.requests.offer('d2', r.id, 40_000);
    const mine = await h.requests.mine('r1');
    expect(mine[0]!.offers.map((o) => [o.driverId, o.priceIqd, o.state])).toEqual([
      ['d1', 30_000, 'withdrawn'],
      ['d1', 28_000, 'open'],
      ['d2', 40_000, 'open'],
    ]);
    const forD2 = await h.rpc.openRequests({ personId: 'd2', sessionId: 's' }, {});
    expect(forD2[0]!.offers.map((o) => o.driverId)).toEqual(['d2']);
    expect(await code(h.requests.offer('r1', r.id, 10_000))).toBe('forbidden');
  });

  it('deposit: 20 % rounded up to 500, at least 5,000, never above the price', () => {
    const h = routesHarness();
    expect(h.requests.depositFor(28_000)).toBe(6_000);
    expect(h.requests.depositFor(40_000)).toBe(8_000);
    expect(h.requests.depositFor(15_000)).toBe(5_000);
    expect(h.requests.depositFor(4_000)).toBe(4_000);
  });

  it('pick holds the deposit on the wallet (refused when it does not fit) and closes the other offers', async () => {
    const h = routesHarness();
    const r = await postRequest(h);
    const o = (await h.requests.offer('d1', r.id, 28_000)).offers.at(-1)!;
    await h.requests.offer('d2', r.id, 40_000);
    h.wallet.set('r1', 5_000);
    expect(await code(h.requests.pick('r1', r.id, o.id))).toBe('wallet_insufficient');
    // SEC-07: an open wallet order elsewhere on the platform leaves too little for the 6,000 deposit.
    h.wallet.set('r1', 20_000);
    h.wallet.elsewhere.set('r1', 15_000);
    expect(await code(h.requests.pick('r1', r.id, o.id))).toBe('wallet_insufficient');
    h.wallet.elsewhere.delete('r1');
    const m = await h.requests.pick('r1', r.id, o.id);
    expect(m).toMatchObject({ state: 'matched', depositIqd: 6_000, pickedOfferId: o.id });
    expect(m.offers.map((x) => x.state)).toEqual(['picked', 'lost']);
    expect(await h.departures.walletAvailable('r1')).toBe(14_000);
    expect(await code(h.requests.offer('d3', r.id, 20_000))).toBe('request_state_conflict');
  });

  it("a stranded rider's post is capped at the seat price", async () => {
    const h = routesHarness();
    const r = await h.writer.run((tx) =>
      h.requests.openForStranded(tx, {
        riderId: 'w1',
        garageId: BAB1.id,
        toLabel: 'بغداد',
        seats: 1,
        travellingAs: 'nisa',
        priceCapIqd: 10_000,
        bookingId: 'bk_x',
      }),
    );
    expect(await code(h.requests.offer('d1', r.id, 11_000))).toBe('offer_price_invalid');
    expect((await h.requests.offer('d1', r.id, 10_000)).offers).toHaveLength(1);
  });
});

describe('request board: the detailed request (y1), «شافوا طلبك» (y4), private trips (y5)', () => {
  const base = { from: { label: 'العزيزية' }, to: { label: 'النجف' }, seats: 2, travellingAs: 'aila' as const };

  it('details default to one way, and must hold together: hours for a wait, a return day within the week', () => {
    const h = routesHarness();
    const when = h.at(120);
    expect(PostRequestInput.parse({ ...base, when }).details).toEqual({ trip: 'one_way', waitHours: null, returnAt: null, bigBags: 0, carKind: null, ac: false });
    expect(PostRequestInput.safeParse({ ...base, when, details: { trip: 'wait_return' } }).success).toBe(false);
    expect(PostRequestInput.safeParse({ ...base, when, details: { trip: 'two_days' } }).success).toBe(false);
    expect(PostRequestInput.safeParse({ ...base, when, details: { trip: 'two_days', returnAt: new Date(when.getTime() + 30 * 60_000) } }).success).toBe(false);
    expect(PostRequestInput.safeParse({ ...base, when, details: { trip: 'two_days', returnAt: new Date(when.getTime() + 8 * 86_400_000) } }).success).toBe(false);
    expect(PostRequestInput.safeParse({ ...base, when, details: { trip: 'two_days', returnAt: new Date(when.getTime() + 2 * 86_400_000) } }).success).toBe(true);
  });

  it('a driver is counted once when he opens it or offers; not after it is matched', async () => {
    const h = routesHarness();
    const r = await postRequest(h);
    await h.requests.seen('d1', r.id);
    await h.requests.seen('d1', r.id);
    await h.requests.offer('d2', r.id, 30_000);
    expect((await h.requests.get(r.id))!.seenDriverIds).toEqual(['d1', 'd2']);
    expect(await code(h.requests.seen('r1', r.id))).toBe('forbidden');
    const o = (await h.requests.get(r.id))!.offers[0]!;
    h.wallet.set('r1', 20_000);
    await h.requests.pick('r1', r.id, o.id);
    // Once matched, a driver who never offered can't read it; one who offered still can, and isn't recounted.
    expect(await code(h.requests.seen('d3', r.id))).toBe('request_not_found');
    expect((await h.requests.seen('d2', r.id)).state).toBe('matched');
    expect((await h.requests.get(r.id))!.seenDriverIds).toEqual(['d1', 'd2']);
  });

  it('private trips count only completed rides whose offer was picked', async () => {
    const h = routesHarness();
    const r = await matched(h);
    expect(await h.repo.privateTripCounts(['d1', 'd2'])).toEqual({ d1: 0, d2: 0 });
    h.advance(118);
    await h.requests.arrived('d1', r.id, BAB1);
    await h.requests.complete('d1', r.id);
    expect(await h.repo.privateTripCounts(['d1', 'd2', 'd9'])).toEqual({ d1: 1, d2: 0, d9: 0 });
  });
});

describe('request board no-shows and settlement through the ledger', () => {
  it('driver no-show: 2× the deposit from the driver to the rider, after 20 minutes', async () => {
    const h = routesHarness();
    const r = await matched(h);
    h.advance(139);
    expect(await code(h.requests.driverNoShow('r1', r.id))).toBe('no_show_not_allowed');
    h.advance(1);
    expect((await h.requests.driverNoShow('r1', r.id)).state).toBe('driver_no_show');
    expect(h.events.last('departure.cancelled')?.payload).toMatchObject({
      departureId: r.id,
      cancelledBy: 'driver',
      driverId: 'd1',
      feeIqd: 12_000,
      riderIds: ['r1'],
    });
    const l = await deliverToLedger(h.events.events);
    expect(await bal(l, 'customer:r1')).toBe(12_000);
    expect(await bal(l, 'driver:d1')).toBe(-12_000);
    expect(await h.departures.walletAvailable('r1')).toBe(20_000);
    expect((await l.ledger.checkInvariant()).ok).toBe(true);
  });

  it('rider no-show: the deposit goes to the driver after a 10-minute wait at the pickup', async () => {
    const h = routesHarness();
    const r = await matched(h);
    h.advance(118);
    await h.requests.arrived('d1', r.id, BAB1);
    h.advance(11);
    expect(await code(h.requests.riderNoShow('d1', r.id))).toBe('no_show_not_allowed');
    h.advance(1);
    expect((await h.requests.riderNoShow('d1', r.id)).state).toBe('rider_no_show');
    const l = await deliverToLedger(h.events.events);
    expect(await bal(l, 'driver:d1')).toBe(6_000);
    expect(await bal(l, 'customer:r1')).toBe(-6_000);
    expect(await bal(l, 'platform')).toBe(0);
  });

  it('a late rider cancel (inside the last hour) forfeits the deposit; earlier it is free', async () => {
    const h = routesHarness();
    const r = await matched(h);
    h.advance(61);
    await h.requests.cancel('r1', r.id);
    expect(await bal(await deliverToLedger(h.events.events), 'driver:d1')).toBe(6_000);
    expect(h.events.last('order.cancelled')?.payload).toMatchObject({
      orderId: r.id,
      feeIqd: 6_000,
      beneficiaries: [{ kind: 'driver', id: 'd1', amountIqd: 6_000 }],
    });
    const h2 = routesHarness();
    const r2 = await matched(h2);
    expect((await h2.requests.cancel('r1', r2.id)).state).toBe('cancelled');
    expect(h2.events.ofType('order.cancelled')).toHaveLength(0);
  });

  it('completed: a private intercity ride (8 % take); the deposit was paid from the wallet, the rest in cash', async () => {
    const h = routesHarness();
    const r = await matched(h);
    h.advance(118);
    await h.requests.arrived('d1', r.id, BAB1);
    await h.requests.complete('d1', r.id);
    expect(h.events.last('order.closed')?.payload).toMatchObject({
      kind: 'ride',
      ride: {
        tripId: r.id,
        takeClass: 'intercity_private',
        fareIqd: 28_000,
        cashCollectedIqd: 22_000,
        payment: 'cash',
      },
    });
    const l = await deliverToLedger(h.events.events);
    expect(await bal(l, 'platform')).toBe(2_240);
    expect(await bal(l, 'driver:d1')).toBe(28_000 - 2_240);
    expect(await bal(l, 'cash:d1')).toBe(-22_000);
    expect(await bal(l, 'customer:r1')).toBe(-6_000);
    expect((await l.ledger.checkInvariant()).ok).toBe(true);
    expect(await h.departures.walletAvailable('r1')).toBe(20_000);
  });
});
