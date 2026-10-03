import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { RoleKind } from '../auth.js';
import { DriverError } from '../errors.js';
import { appRouter } from '../router.js';
import type { RoutesPort } from '../routes-io.js';
import { t, type AppContext } from '../trpc.js';
import { INTERCITY_DRIVER_ROLES, INTERCITY_OPS_ROLES } from './routes.js';

/** Every port method answers "not found": reaching it proves the role gate let the call through. */
function port(): { port: RoutesPort; calls: string[] } {
  const calls: string[] = [];
  const p = new Proxy({} as RoutesPort, {
    get: (_t, name: string) => async () => {
      calls.push(name);
      throw new DriverError('not_found');
    },
  });
  return { port: p, calls };
}

function caller(roles: readonly RoleKind[] | null) {
  const { port: routes, calls } = port();
  const ctx = {
    auth: roles ? { sub: 'p1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    routes,
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), calls };
}

type Call = ReturnType<typeof caller>['call'];

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

const AT = new Date('2026-10-03T14:00:00Z');
const LATER = new Date('2026-10-03T14:30:00Z');

const RIDER: Array<[string, (c: Call) => Promise<unknown>]> = [
  ['network', (c) => c.routes.network()],
  ['board', (c) => c.routes.board({ garageId: 'mp_garage_bab1' })],
  [
    'holdSeat',
    (c) =>
      c.routes.holdSeat({
        departureId: 'dep_1',
        selection: { kind: 'seats', seatIds: ['front'] },
        travellingAs: 'nisa',
      }),
  ],
  ['bookSeat', (c) => c.routes.bookSeat({ bookingId: 'bk_1', payment: 'wallet' })],
  ['cancelSeat', (c) => c.routes.cancelSeat({ bookingId: 'bk_1' })],
  ['myBookings', (c) => c.routes.myBookings()],
  ['boardingPass', (c) => c.routes.boardingPass({ bookingId: 'bk_1' })],
  ['imHere', (c) => c.routes.imHere({ bookingId: 'bk_1', lat: 32.9, lng: 45.05 })],
  [
    'postDemand',
    (c) =>
      c.routes.postDemand({
        corridorId: 'aziziyah_baghdad',
        direction: 'to_aziziyah',
        windowStart: AT,
        windowEnd: LATER,
        seats: 1,
        travellingAs: 'rijal',
      }),
  ],
  ['myDemand', (c) => c.routes.myDemand()],
  ['cancelDemand', (c) => c.routes.cancelDemand({ postId: 'dm_1' })],
  [
    'requestBoard.post',
    (c) =>
      c.routes.requestBoard.post({
        from: { label: 'البوابة ١' },
        to: { label: 'الصويرة' },
        when: AT,
        seats: 2,
        travellingAs: 'aila',
      }),
  ],
  ['requestBoard.mine', (c) => c.routes.requestBoard.mine()],
  ['requestBoard.pick', (c) => c.routes.requestBoard.pick({ postId: 'rq_1', offerId: 'rqo_1' })],
  ['requestBoard.cancel', (c) => c.routes.requestBoard.cancel({ postId: 'rq_1' })],
  ['requestBoard.driverNoShow', (c) => c.routes.requestBoard.driverNoShow({ postId: 'rq_1' })],
];

const DRIVER: Array<[string, (c: Call) => Promise<unknown>]> = [
  [
    'driver.announce',
    (c) =>
      c.routes.driver.announce({
        garageId: 'mp_garage_bab1',
        corridorId: 'aziziyah_baghdad',
        departAt: AT,
        latestDepartureAt: LATER,
        vehicle: { kind: 'saloon', layout: 4, plate: 'واسط 1' },
      }),
  ],
  ['driver.mine', (c) => c.routes.driver.mine()],
  ['driver.departure', (c) => c.routes.driver.departure({ departureId: 'dep_1' })],
  [
    'driver.demand',
    (c) => c.routes.driver.demand({ corridorId: 'aziziyah_baghdad', direction: 'to_aziziyah' }),
  ],
  ['driver.selfie', (c) => c.routes.driver.selfie({ departureId: 'dep_1', selfieRef: 'blob/1' })],
  [
    'driver.position',
    (c) => c.routes.driver.position({ departureId: 'dep_1', lat: 32.9, lng: 45.05 }),
  ],
  [
    'driver.markWalkUp',
    (c) => c.routes.driver.markWalkUp({ departureId: 'dep_1', seatId: 'back_middle' }),
  ],
  ['driver.checkIn', (c) => c.routes.driver.checkIn({ departureId: 'dep_1', pin: '1234' })],
  [
    'driver.markNoShow',
    (c) => c.routes.driver.markNoShow({ departureId: 'dep_1', bookingId: 'bk_1' }),
  ],
  [
    'driver.respondPickup',
    (c) => c.routes.driver.respondPickup({ departureId: 'dep_1', bookingId: 'bk_1', accept: true }),
  ],
  ['driver.depart', (c) => c.routes.driver.depart({ departureId: 'dep_1' })],
  ['driver.arrive', (c) => c.routes.driver.arrive({ departureId: 'dep_1' })],
  ['driver.cancel', (c) => c.routes.driver.cancel({ departureId: 'dep_1', reason: 'عطل' })],
  ['requestBoard.list', (c) => c.routes.requestBoard.list({})],
  ['requestBoard.offer', (c) => c.routes.requestBoard.offer({ postId: 'rq_1', priceIqd: 25_000 })],
  [
    'requestBoard.arrived',
    (c) => c.routes.requestBoard.arrived({ postId: 'rq_1', lat: 32.9, lng: 45.05 }),
  ],
  ['requestBoard.complete', (c) => c.routes.requestBoard.complete({ postId: 'rq_1' })],
  ['requestBoard.riderNoShow', (c) => c.routes.requestBoard.riderNoShow({ postId: 'rq_1' })],
  ['requestBoard.myRides', (c) => c.routes.requestBoard.myRides()],
  ['driver.riders', (c) => c.routes.driver.riders({ departureId: 'dep_1' })],
];

const OPS: Array<[string, (c: Call) => Promise<unknown>]> = [
  ['ops.garage', (c) => c.routes.ops.garage({ garageId: 'mp_garage_bab1' })],
];

describe('routes router: role gating', () => {
  it.each([...RIDER, ...DRIVER, ...OPS])('%s needs a session', async (_n, run) => {
    expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
  });

  it.each(RIDER)('%s is open to any signed-in rider', async (_n, run) => {
    expect(await codeOf(run(caller(['customer']).call))).toBe('NOT_FOUND');
  });

  it.each(DRIVER)(
    '%s refuses riders, city drivers and couriers; intercity drivers reach the port',
    async (_n, run) => {
      expect(await codeOf(run(caller(['customer', 'driver', 'courier', 'khat_driver']).call))).toBe(
        'FORBIDDEN',
      );
      const ok = caller(INTERCITY_DRIVER_ROLES);
      expect(await codeOf(run(ok.call))).toBe('NOT_FOUND');
      expect(ok.calls).toHaveLength(1);
    },
  );

  it.each(OPS)('%s is for ops only', async (_n, run) => {
    expect(await codeOf(run(caller(['intercity_driver', 'customer', 'finance']).call))).toBe(
      'FORBIDDEN',
    );
    for (const role of INTERCITY_OPS_ROLES)
      expect(await codeOf(run(caller([role]).call))).toBe('NOT_FOUND');
  });
});

describe('routes router: input contracts', () => {
  const rider = () => caller(['customer']).call;
  const driver = () => caller(['intercity_driver']).call;

  it('the board needs a garage, or a corridor with its direction', async () => {
    expect(await codeOf(rider().routes.board({ corridorId: 'aziziyah_baghdad' }))).toBe(
      'BAD_REQUEST',
    );
    expect(
      await codeOf(
        rider().routes.board({ corridorId: 'aziziyah_baghdad', direction: 'to_aziziyah' }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('seat ids, travelling-as and PINs are closed vocabularies', async () => {
    expect(
      await codeOf(
        rider().routes.holdSeat({
          departureId: 'd',
          selection: { kind: 'seats', seatIds: ['roof' as never] },
          travellingAs: 'nisa',
        }),
      ),
    ).toBe('BAD_REQUEST');
    expect(
      await codeOf(
        rider().routes.holdSeat({
          departureId: 'd',
          selection: { kind: 'row', row: 'back' },
          travellingAs: 'someone' as never,
        }),
      ),
    ).toBe('BAD_REQUEST');
    expect(await codeOf(driver().routes.driver.checkIn({ departureId: 'd', pin: '12a4' }))).toBe(
      'BAD_REQUEST',
    );
  });

  it('announce: latest departure not before the announced time; layouts 4/6/7 only', async () => {
    const base = {
      garageId: 'g',
      corridorId: 'c',
      departAt: LATER,
      latestDepartureAt: AT,
      vehicle: { kind: 'saloon' as const, layout: 4 as const, plate: 'x 1' },
    };
    expect(await codeOf(driver().routes.driver.announce(base))).toBe('BAD_REQUEST');
    expect(
      await codeOf(
        driver().routes.driver.announce({
          ...base,
          latestDepartureAt: LATER,
          vehicle: { ...base.vehicle, layout: 5 as never },
        }),
      ),
    ).toBe('BAD_REQUEST');
  });

  it('demand windows must end after they start; offers must be positive', async () => {
    expect(
      await codeOf(
        rider().routes.postDemand({
          corridorId: 'c',
          direction: 'to_aziziyah',
          windowStart: LATER,
          windowEnd: AT,
          seats: 1,
          travellingAs: 'rijal',
        }),
      ),
    ).toBe('BAD_REQUEST');
    expect(await codeOf(driver().routes.requestBoard.offer({ postId: 'rq', priceIqd: 0 }))).toBe(
      'BAD_REQUEST',
    );
  });
});
