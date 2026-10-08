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

/** A finished private trip of `rider` to Karbala at `price` (picked, arrived, completed). */
async function finishedTrip(h: RoutesHarness, rider: string, price: number, opts: { trip?: 'one_way' | 'wait_return'; placeId?: 'karbala' | 'najaf' } = {}) {
  const trip = opts.trip ?? 'one_way';
  const r = await h.requests.post(
    rider,
    PostRequestInput.parse({
      from: { label: 'كراج البوابة ١', garageId: BAB1.id },
      to: { label: 'كربلاء', placeId: opts.placeId ?? 'karbala' },
      when: h.at(30),
      seats: 2,
      travellingAs: 'aila',
      details: trip === 'wait_return' ? { trip, waitHours: 3 } : { trip },
    }),
  );
  const wait = trip === 'wait_return' ? { includedHours: 3, extraHourIqd: 5_000 } : undefined;
  const o = (await h.requests.offer('d1', r.id, price, wait)).offers.at(-1)!;
  h.wallet.set(rider, 100_000);
  await h.requests.pick(rider, r.id, o.id);
  await h.requests.complete('d1', r.id);
  return r;
}

describe('private car round 2: waiting terms in the offer (w1), the usual price range (p1–p3)', () => {
  it('a «يستناك وترجع» offer must carry its waiting terms; other trips refuse them; the extra hour is in 1,000s', async () => {
    const h = routesHarness();
    const wait = await h.requests.post(
      'r1',
      PostRequestInput.parse({ from: { label: 'العزيزية' }, to: { label: 'الكوت', placeId: 'kut' }, when: h.at(120), seats: 1, travellingAs: 'rijal', details: { trip: 'wait_return', waitHours: 4 } }),
    );
    expect(await code(h.requests.offer('d1', wait.id, 40_000))).toBe('offer_wait_terms_invalid');
    expect(await code(h.requests.offer('d1', wait.id, 40_000, { includedHours: 4, extraHourIqd: 2_500 }))).toBe('offer_wait_terms_invalid');
    expect(await code(h.requests.offer('d1', wait.id, 40_000, { includedHours: 4, extraHourIqd: -5_000 }))).toBe('offer_wait_terms_invalid');
    await h.requests.offer('d1', wait.id, 40_000, { includedHours: 3, extraHourIqd: 5_000 });
    await h.requests.offer('d2', wait.id, 45_000, { includedHours: 4, extraHourIqd: 0 });
    const [mine] = await h.rpc.myRequests({ personId: 'r1', sessionId: 's' });
    expect(mine!.offers.map((o) => [o.driverId, o.wait])).toEqual([
      ['d1', { includedHours: 3, extraHourIqd: 5_000 }],
      ['d2', { includedHours: 4, extraHourIqd: 0 }],
    ]);
    const oneWay = await postRequest(h, 'r2');
    expect(await code(h.requests.offer('d1', oneWay.id, 30_000, { includedHours: 2, extraHourIqd: 1_000 }))).toBe('offer_wait_terms_invalid');
    expect((await h.requests.offer('d1', oneWay.id, 30_000)).offers.at(-1)!.wait).toBeNull();
  });

  it('the range shows only from 5 finished trips in 90 days to that place and kind, the middle of what was paid', async () => {
    const h = routesHarness();
    const prices = [30_000, 35_000, 36_000, 38_000];
    for (const [i, p] of prices.entries()) await finishedTrip(h, `r${i}`, p);
    expect(await h.requests.usualRange('karbala', 'one_way')).toBeNull();
    await finishedTrip(h, 'r9', 60_000);
    // Nearest rank: 20th percentile = 30,000, 80th = 38,000 of [30, 35, 36, 38, 60].
    expect(await h.requests.usualRange('karbala', 'one_way')).toEqual({ lowIqd: 30_000, highIqd: 38_000, trips: 5 });
    // Another kind of trip, or another place, has no range of its own yet.
    await finishedTrip(h, 'r10', 70_000, { trip: 'wait_return' });
    await finishedTrip(h, 'r11', 20_000, { placeId: 'najaf' });
    expect(await h.requests.usualRange('karbala', 'wait_return')).toBeNull();
    expect(await h.requests.usualRange('najaf', 'one_way')).toBeNull();
    expect((await h.requests.usualRange('karbala', 'one_way'))!.trips).toBe(5);
    // 91 days later they have all aged out.
    h.advance(91 * 24 * 60);
    expect(await h.requests.usualRange('karbala', 'one_way')).toBeNull();
  });

  it('the rider and the drivers offering see the same range on a post to that place; a typed place has none', async () => {
    const h = routesHarness();
    for (const [i, p] of [30_000, 32_000, 34_000, 36_000, 38_000].entries()) await finishedTrip(h, `r${i}`, p);
    const r = await h.requests.post(
      'rx',
      PostRequestInput.parse({ from: { label: 'العزيزية' }, to: { label: 'كربلاء', placeId: 'karbala' }, when: h.at(120), seats: 2, travellingAs: 'aila' }),
    );
    const typed = await postRequest(h, 'ry');
    const range = { lowIqd: 30_000, highIqd: 36_000, trips: 5 };
    expect((await h.rpc.myRequests({ personId: 'rx', sessionId: 's' }))[0]!.usualRange).toEqual(range);
    const forD2 = await h.rpc.openRequests({ personId: 'd2', sessionId: 's' }, {});
    expect(forD2.find((p) => p.id === r.id)!.usualRange).toEqual(range);
    expect(forD2.find((p) => p.id === typed.id)!.usualRange).toBeNull();
    expect(await h.rpc.usualRange({ personId: 'rx', sessionId: 's' }, { placeId: 'karbala', trip: 'one_way' })).toEqual(range);
  });

  it("a stranded rider's capped trip is not counted in the range", async () => {
    const h = routesHarness();
    for (const [i, p] of [30_000, 32_000, 34_000, 36_000].entries()) await finishedTrip(h, `r${i}`, p);
    const r = await finishedTrip(h, 'r8', 38_000);
    const stored = (await h.requests.get(r.id))!;
    await h.repo.saveRequest({ ...stored, origin: 'stranded' });
    expect(await h.requests.usualRange('karbala', 'one_way')).toBeNull();
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
      requestId: r.id,
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
      requestId: r.id,
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
        requestId: r.id,
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

describe('private car round 2: the waiting clock (w2) and the fair extra-hour count (w4)', () => {
  async function waitTrip(h: RoutesHarness) {
    const r = await h.requests.post(
      'r1',
      PostRequestInput.parse({ from: { label: 'العزيزية' }, to: { label: 'النجف', placeId: 'najaf' }, when: h.at(60), seats: 1, travellingAs: 'rijal', details: { trip: 'wait_return', waitHours: 4 } }),
    );
    const o = (await h.requests.offer('d1', r.id, 60_000, { includedHours: 4, extraHourIqd: 5_000 })).offers.at(-1)!;
    h.wallet.set('r1', 100_000);
    await h.requests.pick('r1', r.id, o.id);
    h.advance(60);
    await h.requests.arrived('d1', r.id, BAB1);
    h.advance(150);
    await h.requests.waitStart('d1', r.id);
    return r;
  }

  it('only the picked driver starts it, once, on a «يستناك وترجع» trip; both see the same clock', async () => {
    const h = routesHarness();
    const oneWay = await matched(h);
    expect(await code(h.requests.waitStart('d1', oneWay.id))).toBe('request_state_conflict');
    const r = await waitTrip(h);
    expect(await code(h.requests.waitStart('d1', r.id))).toBe('request_state_conflict');
    expect(await code(h.requests.waitStart('d2', r.id))).not.toBe('no error');
    const [mine] = (await h.rpc.myRequests({ personId: 'r1', sessionId: 's' })).filter((x) => x.id === r.id);
    expect(mine!.waitClock).toMatchObject({ endedAt: null, includedHours: 4, extraHourIqd: 5_000, freeMin: 15, charged: false });
    h.advance(250);
    await h.requests.waitEnd('d1', r.id);
    expect(await code(h.requests.waitEnd('d1', r.id))).toBe('request_state_conflict');
  });

  it('switched off: the clock runs past the included hours and nothing is added', async () => {
    const h = routesHarness();
    const r = await waitTrip(h);
    h.advance(5 * 60 + 40);
    await h.requests.complete('d1', r.id);
    expect(h.events.last('order.closed')?.payload).toMatchObject({ totalIqd: 60_000, ride: { fareIqd: 60_000, cashCollectedIqd: 48_000 } });
  });

  it('switched on: 15 minutes past the included hours are free, then each started hour is the driver’s own price', async () => {
    const cases: Array<[number, number]> = [
      [4 * 60, 0],
      [4 * 60 + 15, 0],
      [5 * 60 + 10, 5_000],
      [5 * 60 + 15, 5_000],
      [5 * 60 + 20, 10_000],
    ];
    for (const [waited, extra] of cases) {
      const h = routesHarness();
      h.requests.moneyRules = { requestWaitExtra: { enabled: true, freeMin: 15 } };
      const r = await waitTrip(h);
      h.advance(waited);
      await h.requests.waitEnd('d1', r.id);
      // Time after the rider is back in the car never counts.
      h.advance(90);
      await h.requests.complete('d1', r.id);
      expect(h.events.last('order.closed')?.payload, `${waited} min`).toMatchObject({
        totalIqd: 60_000 + extra,
        ride: { fareIqd: 60_000 + extra, cashCollectedIqd: 48_000 + extra },
      });
    }
  });

  it('a clock still running stops at completion; the extra is cash and the 8 % private take covers it', async () => {
    const h = routesHarness();
    h.requests.moneyRules = { requestWaitExtra: { enabled: true, freeMin: 15 } };
    const r = await waitTrip(h);
    h.advance(6 * 60);
    // Both apps read the same switch the money uses.
    const [mine] = (await h.rpc.myRequests({ personId: 'r1', sessionId: 's' })).filter((x) => x.id === r.id);
    expect(mine!.waitClock).toMatchObject({ charged: true, endedAt: null });
    await h.requests.complete('d1', r.id);
    expect((await h.requests.get(r.id))!.waitEndedAt).not.toBeNull();
    expect(h.events.last('order.closed')?.payload).toMatchObject({ ride: { fareIqd: 70_000, cashCollectedIqd: 58_000 } });
    const l = await deliverToLedger(h.events.events);
    expect(await bal(l, 'platform')).toBe(5_600);
  });
});

describe('private car round 2: «جيب واحد» (k1–k4), the car fetches someone else', () => {
  const fetchInput = (h: RoutesHarness, rider: unknown = { from: 'typed', name: 'ماما', phone: '07701234567' }) =>
    PostRequestInput.parse({
      from: { label: 'مطار بغداد', placeId: 'baghdad_airport' },
      // k4: brought to another place, not home.
      to: { label: 'مستشفى الكوت' },
      when: h.at(120),
      seats: 1,
      travellingAs: 'aila',
      details: { trip: 'fetch' },
      rider,
    });

  it('a «جيب واحد» request needs who to fetch, and only that kind takes one', () => {
    const base = { from: { label: 'بغداد' }, to: { label: 'العزيزية' }, when: new Date('2026-10-04T08:00:00Z'), seats: 1, travellingAs: 'aila' };
    expect(PostRequestInput.safeParse({ ...base, details: { trip: 'fetch' } }).error?.issues[0]?.message).toBe('rider_needed');
    expect(PostRequestInput.safeParse({ ...base, rider: { from: 'typed', name: 'ماما', phone: '07701234567' } }).error?.issues[0]?.message).toBe('rider_only_on_fetch');
    expect(PostRequestInput.safeParse({ ...base, details: { trip: 'fetch' }, rider: { from: 'typed', name: ' ', phone: '07701234567' } }).success).toBe(false);
  });

  it('keeps only the person id on the request; the poster and the picked driver see the name, nobody else', async () => {
    const h = routesHarness();
    const r = await h.requests.post('r1', fetchInput(h));
    expect(r.fetchPersonId).toBe('p_fetch_07701234567');
    expect(r.to).toEqual({ label: 'مستشفى الكوت' });
    const [mine] = await h.rpc.myRequests({ personId: 'r1', sessionId: 's' });
    expect(mine!.rider).toEqual({ name: 'ماما' });
    // Drivers on the board see the trip kind, never the name.
    const [board] = (await h.rpc.openRequests({ personId: 'd1', sessionId: 's' }, {})).filter((x) => x.id === r.id);
    expect(board!.details.trip).toBe('fetch');
    expect(board!.rider).toBeNull();
    const o = (await h.requests.offer('d1', r.id, 90_000)).offers.at(-1)!;
    await h.requests.offer('d2', r.id, 95_000);
    h.wallet.set('r1', 100_000);
    await h.requests.pick('r1', r.id, o.id);
    // lane D's `request_for_rider` message starts from this event: the person id, never a phone or name.
    const matched = h.events.last('request.matched')?.payload;
    expect(matched).toMatchObject({ requestId: r.id, driverId: 'd1', fetchPersonId: 'p_fetch_07701234567' });
    expect(JSON.stringify({ ...matched, fetchPersonId: null })).not.toMatch(/0770|ماما/);
    const [ride] = await h.rpc.myRequestRides({ personId: 'd1', sessionId: 's' });
    expect(ride!.rider).toEqual({ name: 'ماما' });
    expect(await h.rpc.myRequestRides({ personId: 'd2', sessionId: 's' })).toEqual([]);
    expect(h.riders.reads.map((x) => [x.accessorId, x.purpose])).toEqual([
      ['r1', 'request_rider_name'],
      ['d1', 'partner_request_rider'],
    ]);
  });

  it('refuses the poster’s own number and a rider on another kind', async () => {
    const h = routesHarness();
    expect(await code(h.requests.post('p_rider', fetchInput(h, { from: 'typed', name: 'أني', phone: '07701000001' })))).toBe('ride_rider_is_you');
    const oneWay = { ...fetchInput(h), details: { ...fetchInput(h).details, trip: 'one_way' as const } };
    expect(await code(h.requests.post('r1', oneWay))).toBe('invalid_input');
  });

  it('the picked driver’s call rings the person fetched, only while the trip is live', async () => {
    const h = routesHarness();
    const r = await h.requests.post('r1', fetchInput(h));
    expect(await code(h.requests.callee('d1', r.id, 'call_1'))).toBe('request_state_conflict');
    const o = (await h.requests.offer('d1', r.id, 90_000)).offers.at(-1)!;
    h.wallet.set('r1', 100_000);
    await h.requests.pick('r1', r.id, o.id);
    expect(await code(h.requests.callee('d2', r.id, 'call_2'))).toBe('request_state_conflict');
    expect((await h.requests.callee('d1', r.id, 'call_3')).calleeId).toBe('p_fetch_07701234567');
    expect(h.events.last('request.call_requested')?.payload).toMatchObject({ requestId: r.id, calleeId: 'p_fetch_07701234567', callId: 'call_3' });
    // Any other kind: the call rings the poster.
    const h2 = routesHarness();
    const plain = await matched(h2);
    expect((await h2.requests.callee('d1', plain.id, 'call_4')).calleeId).toBe('r1');
  });

  it('settles like any private trip: the poster pays, the deposit counts, the 8 % take applies', async () => {
    const h = routesHarness();
    const r = await h.requests.post('r1', fetchInput(h));
    const o = (await h.requests.offer('d1', r.id, 90_000)).offers.at(-1)!;
    h.wallet.set('r1', 100_000);
    await h.requests.pick('r1', r.id, o.id);
    h.advance(120);
    await h.requests.arrived('d1', r.id, BAB1);
    await h.requests.complete('d1', r.id);
    expect(h.events.last('order.closed')?.payload).toMatchObject({ totalIqd: 90_000, ride: { fareIqd: 90_000, cashCollectedIqd: 72_000 } });
    const l = await deliverToLedger(h.events.events);
    expect(await bal(l, 'platform')).toBe(7_200);
  });
});
