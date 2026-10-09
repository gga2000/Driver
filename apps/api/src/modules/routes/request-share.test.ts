import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, PostRequestInput, sharePlaceIqd, type DriverError } from '@driver/contracts';
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

const ON = { ...AZIZIYAH_MONEY_RULES, requestSharing: { enabled: true, closeBeforeMin: 120 } };

/** r1 posts a private car for 4 people in 10 h; d1 offers 110,000 and r1 picks it (deposit 22,000). */
async function sharedCar(opts: { on?: boolean; seats?: number } = {}) {
  const h = routesHarness();
  if (opts.on !== false) h.requests.moneyRules = ON;
  const r = await h.requests.post(
    'r1',
    PostRequestInput.parse({
      from: { label: 'كراج البوابة 1', garageId: BAB1.id },
      to: { label: 'بغداد · مستشفى ابن النفيس' },
      when: h.at(600),
      seats: opts.seats ?? 4,
      privateCar: true,
      travellingAs: 'aila',
    }),
  );
  const offer = (await h.requests.offer('d1', r.id, 110_000)).offers.at(-1)!;
  h.wallet.set('r1', 50_000);
  await h.requests.pick('r1', r.id, offer.id);
  return { h, r };
}

async function open(h: RoutesHarness, postId: string, bookerPlaces = 1) {
  const r = await h.requests.openShare('r1', postId, bookerPlaces);
  return r.share!.code;
}

describe('step 6: sharing a private car by link (Ali item 56, s1–s4; switch requestSharing)', () => {
  it('splits the price evenly over the people, each place rounded down to 250', () => {
    expect(sharePlaceIqd(110_000, 4)).toBe(27_500);
    expect(sharePlaceIqd(100_000, 3)).toBe(33_250);
    expect(sharePlaceIqd(95_000, 7)).toBe(13_500);
  });

  it('off (as shipped): no link can be opened and no code is found', async () => {
    const { h, r } = await sharedCar({ on: false });
    expect(AZIZIYAH_MONEY_RULES.requestSharing.enabled).toBe(false);
    expect(await code(h.requests.openShare('r1', r.id, 1))).toBe('forbidden');
    expect(h.requests.shareable((await h.requests.get(r.id))!)).toBe(false);
    expect(await code(h.requests.joinShare('f1', 'ABCDEFGH', 1))).toBe('share_not_found');
  });

  it('the booker opens it once picked; the price per place is fixed then; he can change his own places', async () => {
    const { h, r } = await sharedCar();
    expect(h.requests.shareable((await h.requests.get(r.id))!)).toBe(true);
    const c = await open(h, r.id);
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const after = (await h.requests.get(r.id))!;
    expect(after.share).toMatchObject({ bookerPlaces: 1, placeIqd: 27_500, members: [] });
    expect(h.requests.shareView(after, {})).toMatchObject({ path: `/rajaa/join/${c}`, people: 4, placesLeft: 3, open: true, friendsIqd: 0, cashIqd: 88_000 });
    // Him and his wife: two places are his.
    expect((await h.requests.openShare('r1', r.id, 2)).share).toMatchObject({ code: c, bookerPlaces: 2 });
    expect(await code(h.requests.openShare('r1', r.id, 4))).toBe('invalid_input');
    expect(h.events.ofType('request.share_opened')).toHaveLength(2);
  });

  it('needs a picked private car for 2 people or more, and closes 2 hours before the trip', async () => {
    const one = await sharedCar({ seats: 1 });
    expect(await code(one.h.requests.openShare('r1', one.r.id, 1))).toBe('request_state_conflict');
    const { h, r } = await sharedCar();
    expect(await code(h.requests.openShare('r2', r.id, 1))).toBe('request_not_found');
    h.advance(481);
    expect(await code(h.requests.openShare('r1', r.id, 1))).toBe('share_closed');
  });

  it('a friend joins from his wallet; the places are held so he cannot spend them twice', async () => {
    const { h, r } = await sharedCar();
    const c = await open(h, r.id);
    h.wallet.set('f1', 60_000);
    expect(await code(h.requests.joinShare('r1', c, 1))).toBe('forbidden');
    expect(await code(h.requests.joinShare('d1', c, 1))).toBe('forbidden');
    const joined = await h.requests.joinShare('f1', c, 2);
    expect(joined.share!.members).toEqual([expect.objectContaining({ personId: 'f1', places: 2, amountIqd: 55_000, state: 'joined' })]);
    // Joining again with the same places is a no-op; other places need a leave first.
    expect((await h.requests.joinShare('f1', c, 2)).share!.members).toHaveLength(1);
    expect(await code(h.requests.joinShare('f1', c, 1))).toBe('request_state_conflict');
    // 60,000 − 55,000 held = 5,000: not enough for another friend's car.
    const other = await sharedCar();
    const c2 = await open(other.h, other.r.id);
    other.h.wallet.set('f1', 5_000);
    expect(await code(other.h.requests.joinShare('f1', c2, 1))).toBe('wallet_insufficient');
    // Money his wallet food order already holds is not his to share either (SEC-07, as `pick`).
    other.h.wallet.set('f1', 60_000);
    other.h.wallet.elsewhere.set('f1', 40_000);
    expect(await code(other.h.requests.joinShare('f1', c2, 1))).toBe('wallet_insufficient');
    expect(h.events.ofType('request.share_joined')[0]?.payload).toMatchObject({ personId: 'f1', places: 2, amountIqd: 55_000, riderId: 'r1', driverId: 'd1' });
  });

  it('places run out; a friend can leave before it closes, not after', async () => {
    const { h, r } = await sharedCar();
    const c = await open(h, r.id);
    for (const f of ['f1', 'f2', 'f3', 'f4']) h.wallet.set(f, 100_000);
    await h.requests.joinShare('f1', c, 2);
    expect(await code(h.requests.joinShare('f2', c, 2))).toBe('share_full');
    await h.requests.joinShare('f2', c, 1);
    expect(await code(h.requests.joinShare('f3', c, 1))).toBe('share_full');
    // He cannot take the friends' places back for himself.
    expect(await code(h.requests.openShare('r1', r.id, 2))).toBe('share_full');
    await h.requests.leaveShare('f2', c);
    expect(h.requests.shareView((await h.requests.get(r.id))!, {})).toMatchObject({ placesLeft: 1, friendsIqd: 55_000 });
    await h.requests.joinShare('f3', c, 1);
    h.advance(481);
    expect(await code(h.requests.leaveShare('f3', c))).toBe('share_closed');
    expect(await code(h.requests.joinShare('f4', c, 1))).toBe('share_closed');
  });

  it('the trip completes: friends pay their places from their wallets, the booker pays the rest (deposit, then cash)', async () => {
    const { h, r } = await sharedCar();
    const c = await open(h, r.id);
    h.wallet.set('f1', 100_000);
    h.wallet.set('f2', 100_000);
    await h.requests.joinShare('f1', c, 1);
    await h.requests.joinShare('f2', c, 1);
    // One place nobody took: it stays r1's, in cash (s3).
    h.advance(600);
    await h.requests.arrived('d1', r.id, { lat: BAB1.lat, lng: BAB1.lng });
    const done = await h.requests.complete('d1', r.id);
    expect(done.share!.members.map((m) => m.state)).toEqual(['paid', 'paid']);
    const closed = h.events.ofType('order.closed')[0]!.payload as { ride: Record<string, unknown> };
    expect(closed.ride).toMatchObject({
      customerId: 'r1',
      fareIqd: 110_000,
      cashCollectedIqd: 110_000 - 55_000 - 22_000,
      sharedBy: [
        { customerId: 'f1', amountIqd: 27_500 },
        { customerId: 'f2', amountIqd: 27_500 },
      ],
    });
    // In the ledger: the driver earns the whole fare less the 8 % take; each wallet pays its part.
    const l = ledgerHarness();
    for (const e of h.events.events as readonly RecordedRoutesEvent[]) {
      if (!LEDGER_SUBSCRIBED_EVENTS.includes(e.type)) continue;
      await l.bus.publish(e.type, JSON.parse(JSON.stringify({ actorId: e.actorId, occurredAt: e.occurredAt, ...e.payload })) as Record<string, unknown>);
    }
    const bal = async (a: string) => (await l.ledger.balance(a)).amount;
    expect(await bal('driver:d1')).toBe(110_000 - 8_800);
    expect(await bal('cash:d1')).toBe(-33_000);
    expect(await bal('customer:f1')).toBe(-27_500);
    expect(await bal('customer:f2')).toBe(-27_500);
    expect(await bal('customer:r1')).toBe(-22_000);
    expect((await l.ledger.checkInvariant()).ok).toBe(true);
  });

  it('friends covering more than the booker owes past his deposit: no cash, and his wallet pays only his part', async () => {
    const { h, r } = await sharedCar({ seats: 7 });
    const c = await open(h, r.id);
    for (let i = 1; i <= 6; i += 1) {
      h.wallet.set(`f${i}`, 100_000);
      await h.requests.joinShare(`f${i}`, c, 1);
    }
    // 6 × 15,500 = 93,000 from friends; r1's part is 17,000, less than his 22,000 deposit.
    h.advance(600);
    await h.requests.arrived('d1', r.id, { lat: BAB1.lat, lng: BAB1.lng });
    await h.requests.complete('d1', r.id);
    const closed = h.events.ofType('order.closed')[0]!.payload as { ride: { cashCollectedIqd: number } };
    expect(closed.ride.cashCollectedIqd).toBe(0);
  });

  it('cancelled or failed trips release every friend (s4); only the booker’s deposit follows the usual rules', async () => {
    for (const end of ['cancel', 'late_cancel', 'driver_no_show', 'rider_no_show'] as const) {
      const { h, r } = await sharedCar();
      const c = await open(h, r.id);
      h.wallet.set('f1', 100_000);
      await h.requests.joinShare('f1', c, 1);
      if (end === 'cancel') await h.requests.cancel('r1', r.id);
      if (end === 'late_cancel') {
        h.advance(560);
        await h.requests.cancel('r1', r.id);
      }
      if (end === 'driver_no_show') {
        h.advance(600 + 60);
        await h.requests.driverNoShow('r1', r.id);
      }
      if (end === 'rider_no_show') {
        h.advance(600);
        await h.requests.arrived('d1', r.id, { lat: BAB1.lat, lng: BAB1.lng });
        h.advance(60);
        await h.requests.riderNoShow('d1', r.id);
      }
      const after = (await h.requests.get(r.id))!;
      expect(after.share!.members[0]?.state, end).toBe('released');
      expect(h.events.ofType('request.shares_released')[0]?.payload, end).toMatchObject({ personIds: ['f1'] });
      // Nothing of f1's is held any more, and nothing was charged.
      expect(await h.requests.sharedWith('f1')).toEqual([]);
      expect(h.events.ofType('order.closed')).toHaveLength(0);
    }
  });
});

describe('step 6: who sees what', () => {
  const as = (personId: string, roles: string[] = ['customer']) => ({ personId, roles }) as never;

  it('the booker sees the link and his friends by first name; the driver sees the cash and no link (names only on his ride)', async () => {
    const { h, r } = await sharedCar();
    h.riderNames.set('f1', 'كرار حسن');
    h.riderNames.set('r1', 'أحمد علي');
    const c = await open(h, r.id);
    h.wallet.set('f1', 100_000);
    await h.requests.joinShare('f1', c, 1);
    const mine = (await h.rpc.myRequests(as('r1')))[0]!;
    expect(mine.share).toMatchObject({ path: `/rajaa/join/${c}`, members: [{ firstName: 'كرار', places: 1, amountIqd: 27_500, state: 'joined' }], cashIqd: 110_000 - 27_500 - 22_000 });
    expect(mine.shareable).toBe(true);
    expect(h.nameReads).toContainEqual({ personId: 'f1', accessorId: 'r1', purpose: 'request_share_member' });
    const [ride] = await h.rpc.myRequestRides(as('d1', ['intercity_driver']));
    // Way C: the picked driver sees who is coming by first name while the trip is live, never the link.
    expect(ride).toMatchObject({ priceIqd: 110_000, cashToCollectIqd: 60_500, share: { path: null, members: [{ firstName: 'كرار', boardedBy: null }] } });
    expect(h.nameReads).toContainEqual({ personId: 'f1', accessorId: 'd1', purpose: 'request_share_driver' });
    const dv = await h.rpc.requestSeen(as('d1', ['intercity_driver']), { postId: r.id });
    expect(dv.share).toMatchObject({ path: null, members: [{ firstName: null }], cashIqd: 60_500 });
    expect(dv.shareable).toBe(false);
  });

  it('a friend with the link sees the trip, the driver card, the booker’s first name and only his own places', async () => {
    const { h, r } = await sharedCar();
    h.riderNames.set('r1', 'أحمد علي');
    const c = await open(h, r.id);
    h.wallet.set('f1', 100_000);
    h.wallet.set('f2', 100_000);
    const before = await h.rpc.shareInvite(as('f1'), { code: c });
    expect(before).toMatchObject({ postId: r.id, bookerName: 'أحمد', people: 4, placeIqd: 27_500, placesLeft: 3, open: true, myPlaces: 0, myState: null });
    expect(before.driver).not.toBeNull();
    await h.rpc.joinShare(as('f2'), { code: c, places: 1 });
    const joined = await h.rpc.joinShare(as('f1'), { code: c, places: 2 });
    expect(joined).toMatchObject({ myPlaces: 2, myAmountIqd: 55_000, myState: 'joined', placesLeft: 0 });
    expect(JSON.stringify(joined)).not.toContain('f2');
    expect((await h.rpc.sharedWithMe(as('f1'))).map((v) => v.postId)).toEqual([r.id]);
    expect(await code(h.rpc.shareInvite(as('r1'), { code: c }))).toBe('forbidden');
    // After the trip, only those who joined can still open the link.
    h.advance(600);
    await h.requests.arrived('d1', r.id, { lat: BAB1.lat, lng: BAB1.lng });
    await h.requests.complete('d1', r.id);
    expect((await h.rpc.shareInvite(as('f1'), { code: c })).myState).toBe('paid');
    expect(await code(h.rpc.shareInvite(as('f9'), { code: c }))).toBe('share_not_found');
    expect(await h.rpc.sharedWithMe(as('f1'))).toEqual([]);
  });
});

describe('way C (Ali 2026-10-09: "c"): each friend taps «صعدت» next to the car', () => {
  const as = (personId: string, roles: string[] = ['customer']) => ({ personId, roles }) as never;
  const AT_CAR = { lat: BAB1.lat, lng: BAB1.lng };
  // About 1.1 km north of the garage.
  const FAR = { lat: BAB1.lat + 0.01, lng: BAB1.lng };

  async function boardingCar() {
    const { h, r } = await sharedCar();
    h.riderNames.set('f1', 'كرار حسن');
    h.riderNames.set('f2', 'زينب علي');
    const c = await open(h, r.id);
    h.wallet.set('f1', 100_000);
    h.wallet.set('f2', 100_000);
    await h.requests.joinShare('f1', c, 1);
    await h.requests.joinShare('f2', c, 1);
    return { h, r, c };
  }

  it('«صعدت» only once the driver arrived, and only next to where he pressed «وصلت»; twice is a no-op', async () => {
    const { h, r, c } = await boardingCar();
    expect(await code(h.rpc.shareBoard(as('f1'), { code: c, ...AT_CAR }))).toBe('request_state_conflict');
    h.advance(600);
    await h.requests.arrived('d1', r.id, AT_CAR);
    expect(await code(h.rpc.shareBoard(as('f1'), { code: c, ...FAR }))).toBe('share_board_far');
    const v = await h.rpc.shareBoard(as('f1'), { code: c, ...AT_CAR });
    expect(v).toMatchObject({ myState: 'joined', myBoardedBy: 'self', boardNearM: 300 });
    await h.rpc.shareBoard(as('f1'), { code: c, ...AT_CAR });
    expect(h.events.ofType('request.share_boarded').map((e) => e.payload)).toEqual([expect.objectContaining({ personId: 'f1', by: 'self', riderId: 'r1', driverId: 'd1' })]);
    // Someone without places, and the booker: not his to say.
    expect(await code(h.rpc.shareBoard(as('f9'), { code: c, ...AT_CAR }))).toBe('share_not_found');
    expect(await code(h.rpc.shareBoard(as('r1'), { code: c, ...AT_CAR }))).toBe('share_not_found');
    // The booker and the driver see who got in.
    expect((await h.rpc.myRequests(as('r1')))[0]!.share!.members.map((m) => [m.firstName, m.boardedBy])).toEqual([['كرار', 'self'], ['زينب', null]]);
    const [ride] = await h.rpc.myRequestRides(as('d1', ['intercity_driver']));
    expect(ride!.share!.members.map((m) => [m.firstName, m.boardedBy])).toEqual([['كرار', 'self'], ['زينب', null]]);
  });

  it('the driver taps «صعد» for a friend whose phone can\'t; she can answer «ما صعدت», which clears it and is logged', async () => {
    const { h, r, c } = await boardingCar();
    const driver = as('d1', ['intercity_driver']);
    const zainab = (await h.requests.get(r.id))!.share!.members.find((m) => m.personId === 'f2')!;
    expect(await code(h.rpc.shareBoardFor(driver, { postId: r.id, memberId: zainab.id }))).toBe('request_state_conflict');
    h.advance(600);
    await h.requests.arrived('d1', r.id, AT_CAR);
    expect(await code(h.rpc.shareBoardFor(as('d2', ['intercity_driver']), { postId: r.id, memberId: zainab.id }))).toBe('forbidden');
    expect(await code(h.rpc.shareBoardFor(driver, { postId: r.id, memberId: 'rqs_missing' }))).toBe('share_not_found');
    const view = await h.rpc.shareBoardFor(driver, { postId: r.id, memberId: zainab.id });
    expect(view.share!.members.find((m) => m.id === zainab.id)).toMatchObject({ firstName: 'زينب', boardedBy: 'driver' });
    expect(h.events.ofType('request.share_boarded').at(-1)!.payload).toMatchObject({ memberId: zainab.id, personId: 'f2', by: 'driver' });
    expect((await h.rpc.shareInvite(as('f2'), { code: c })).myBoardedBy).toBe('driver');

    // Her own «صعدت» can't be taken back; only the driver's tap can be answered.
    expect(await code(h.rpc.shareNotBoarded(as('f1'), { code: c }))).toBe('request_state_conflict');
    const denied = await h.rpc.shareNotBoarded(as('f2'), { code: c });
    expect(denied.myBoardedBy).toBeNull();
    expect(h.events.ofType('request.share_board_denied')[0]!.payload).toMatchObject({ memberId: zainab.id, personId: 'f2', riderId: 'r1', driverId: 'd1' });

    // A record only: what each friend pays is unchanged, both still pay their places at the end.
    const done = await h.requests.complete('d1', r.id);
    expect(done.share!.members.map((m) => [m.personId, m.state])).toEqual([['f1', 'paid'], ['f2', 'paid']]);
  });
});
