import { describe, expect, it } from 'vitest';
import {
  PostDemandInput,
  type DriverError,
  type PostDemandInput as PostDemand,
} from '@driver/contracts';
import { BAB1, NAHDHA, routesHarness, type RoutesHarness } from './test-harness.js';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as DriverError).code ?? String(err);
  }
  return 'no error';
}

/** "أريد أرجع": Baghdad → Aziziyah, a window 17:00–18:00 Baghdad (14:00–15:00Z) from النهضة. */
function post(h: RoutesHarness, riderId: string, over: Partial<PostDemand> = {}) {
  return h.demand.post(
    riderId,
    PostDemandInput.parse({
      corridorId: 'aziziyah_baghdad',
      direction: 'to_aziziyah',
      windowStart: new Date('2026-10-03T14:00:00Z'),
      windowEnd: new Date('2026-10-03T15:00:00Z'),
      seats: 2,
      travellingAs: 'nisa',
      pickup: { kind: 'garage', garageId: NAHDHA.id },
      ...over,
    }),
  );
}

const fromNahdha = (h: RoutesHarness, minutes: number, driverId = 'd1') =>
  h.announce({
    driverId,
    garageId: NAHDHA.id,
    departAt: h.at(minutes),
    latestDepartureAt: h.at(minutes + 20),
  });

describe('demand board — أريد أرجع (customer spec §2, review C-34)', () => {
  it('drivers see posted seats per garage and window', async () => {
    const h = routesHarness();
    await post(h, 'r1');
    await post(h, 'r2', { seats: 1, travellingAs: 'rijal' });
    await post(h, 'r3', { seats: 1, pickup: { kind: 'garage' } });
    const board = await h.demand.board({
      corridorId: 'aziziyah_baghdad',
      direction: 'to_aziziyah',
    });
    expect(board).toEqual([
      expect.objectContaining({ garageId: null, postedSeats: 1, claimedSeats: 0, posts: 1 }),
      expect.objectContaining({ garageId: NAHDHA.id, postedSeats: 3, claimedSeats: 0, posts: 2 }),
    ]);
  });

  it("a driver's announcement inside the window converts the post into a 10-minute hold (away from the front); drivers then see claimed vs posted", async () => {
    const h = routesHarness();
    const p = await post(h, 'r1');
    const dep = await fromNahdha(h, 150); // 14:30Z
    const claimed = (await h.demand.mine('r1'))[0]!;
    expect(claimed).toMatchObject({ id: p.id, state: 'claimed' });
    const hold = await h.departures.booking(claimed.bookingId!);
    expect(hold).toMatchObject({
      departureId: dep.id,
      state: 'held',
      origin: 'demand_claim',
      travellingAs: 'nisa',
      demandPostId: p.id,
    });
    expect(hold.seatIds).toHaveLength(2);
    expect(hold.seatIds).not.toContain('front');
    expect(hold.heldUntil?.toISOString()).toBe(h.at(10).toISOString());
    expect(h.events.last('demand.claimed')?.payload).toMatchObject({
      riderId: 'r1',
      departureId: dep.id,
      bookingId: hold.id,
    });
    const board = await h.demand.board({
      corridorId: 'aziziyah_baghdad',
      direction: 'to_aziziyah',
    });
    expect(board).toEqual([
      expect.objectContaining({ garageId: NAHDHA.id, postedSeats: 0, claimedSeats: 2 }),
    ]);
    // the normal rules follow: book within 10 minutes
    h.wallet.set('r1', 20_000);
    expect((await h.departures.book('r1', hold.id, 'wallet')).state).toBe('booked');
  });

  it('only matching runs claim: in the window, same direction, the chosen garage (or any garage in the city)', async () => {
    const h = routesHarness();
    await post(h, 'r1');
    const any = await post(h, 'r2', {
      seats: 1,
      travellingAs: 'rijal',
      pickup: { kind: 'garage' },
    });
    await fromNahdha(h, 60); // 13:00Z: before the window
    await h.announce({
      driverId: 'd2',
      garageId: BAB1.id,
      departAt: h.at(150),
      latestDepartureAt: h.at(160),
    }); // wrong direction
    expect((await h.demand.mine('r1'))[0]!.state).toBe('open');
    expect((await h.demand.mine('r2'))[0]!.state).toBe('open');
    await fromNahdha(h, 170, 'd3');
    expect((await h.demand.mine('r1'))[0]!.state).toBe('claimed');
    expect((await h.demand.mine('r2'))[0]).toMatchObject({ id: any.id, state: 'claimed' });
  });

  it('a lapsed claim counts against cash reservation rights (two lapses → prepay only)', async () => {
    const h = routesHarness();
    await post(h, 'r1', { seats: 1 });
    await fromNahdha(h, 130);
    await h.tickAt(10);
    expect((await h.demand.mine('r1'))[0]!.state).toBe('lapsed');
    await post(h, 'r1', {
      seats: 1,
      windowStart: new Date('2026-10-03T15:00:00Z'),
      windowEnd: new Date('2026-10-03T16:00:00Z'),
    });
    await fromNahdha(h, 200, 'd2');
    await h.tickAt(10);
    expect((await h.demand.mine('r1')).map((p) => p.state)).toEqual(['lapsed', 'lapsed']);
    expect(await h.repo.riderStats('r1')).toEqual({ completedBookings: 0, cashStrikes: 2 });
    const dep = await fromNahdha(h, 260, 'd3');
    const held = await h.hold('r1', dep.id, ['back_left'], 'nisa');
    expect(await code(h.departures.book('r1', held.id, 'cash'))).toBe('cash_reservation_revoked');
  });

  it('posts expire at the end of their window; an unserved post escalates to the dispatcher once', async () => {
    const h = routesHarness();
    await post(h, 'r1');
    await h.tickAt(119);
    expect(h.events.ofType('demand.unserved')).toHaveLength(0);
    await h.tickAt(1); // 14:00Z: the window starts with no car
    await h.tickAt(30);
    expect(h.events.ofType('demand.unserved')).toHaveLength(1);
    expect(h.events.last('demand.unserved')?.payload).toMatchObject({
      riderId: 'r1',
      seats: 2,
      garageId: NAHDHA.id,
    });
    await h.tickAt(30);
    expect((await h.demand.mine('r1'))[0]!.state).toBe('expired');
    expect(
      await h.demand.board({ corridorId: 'aziziyah_baghdad', direction: 'to_aziziyah' }),
    ).toEqual([]);
  });

  it('validation: a garage in the wrong city, an unknown meeting point, an overlapping open post, a past window', async () => {
    const h = routesHarness();
    expect(await code(post(h, 'r1', { pickup: { kind: 'garage', garageId: BAB1.id } }))).toBe(
      'pickup_invalid',
    );
    expect(
      await code(post(h, 'r1', { pickup: { kind: 'meeting_point', meetingPointId: 'nope' } })),
    ).toBe('pickup_invalid');
    await post(h, 'r1');
    expect(
      await code(
        post(h, 'r1', {
          windowStart: new Date('2026-10-03T14:30:00Z'),
          windowEnd: new Date('2026-10-03T15:30:00Z'),
        }),
      ),
    ).toBe('demand_state_conflict');
    expect(
      await code(
        post(h, 'r2', {
          windowStart: new Date('2026-10-03T10:00:00Z'),
          windowEnd: new Date('2026-10-03T11:00:00Z'),
        }),
      ),
    ).toBe('invalid_input');
    const [p] = await h.demand.mine('r1');
    expect((await h.demand.cancel('r1', p!.id)).state).toBe('cancelled');
    expect(await code(h.demand.cancel('r1', p!.id))).toBe('demand_state_conflict');
  });
});
