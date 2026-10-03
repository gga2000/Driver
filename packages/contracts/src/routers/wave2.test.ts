import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { RoleKind } from '../auth.js';
import { DriverError } from '../errors.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';

/** Every port method answers "not found": reaching it proves the role gate let the call through. */
function proxyPort(calls: string[], prefix: string): unknown {
  return new Proxy(
    {},
    {
      get: (_t, name: string) => async () => {
        calls.push(`${prefix}.${name}`);
        throw new DriverError('not_found');
      },
    },
  );
}

function caller(roles: readonly RoleKind[] | null) {
  const calls: string[] = [];
  const ctx = {
    auth: roles ? { sub: 'p1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    driverAccount: proxyPort(calls, 'driverAccount'),
    khat: proxyPort(calls, 'khat'),
    fleet: proxyPort(calls, 'fleet'),
    ops: proxyPort(calls, 'ops'),
    merchantAdmin: proxyPort(calls, 'merchantAdmin'),
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

const M = { merchantOrgId: 'org_1' };
const SCHEDULE = { startsAt: new Date('2026-10-04T00:00:00Z'), endsAt: new Date('2026-10-10T00:00:00Z') };

/** [procedure, call, a role that may call it, a role that may not]. */
const CASES: Array<[string, (c: Call) => Promise<unknown>, RoleKind, RoleKind]> = [
  ['driverAccount.earnings', (c) => c.driverAccount.earnings({ period: 'week' }), 'courier', 'customer'],
  ['driverAccount.scorecard', (c) => c.driverAccount.scorecard({}), 'driver', 'merchant_owner'],
  ['driverAccount.documents', (c) => c.driverAccount.documents({}), 'khat_driver', 'customer'],
  ['driverAccount.uploadDocument', (c) => c.driverAccount.uploadDocument({ kind: 'licence', uploadId: 'up_1' }), 'driver', 'support'],
  ['driverAccount.reviewDocument', (c) => c.driverAccount.reviewDocument({ documentId: 'd1', decision: 'approve' }), 'field_ops', 'courier'],
  ['driverAccount.checkInChallenge', (c) => c.driverAccount.checkInChallenge(), 'courier', 'customer'],
  ['driverAccount.submitCheckIn', (c) => c.driverAccount.submitCheckIn({ challengeId: 'c1', uploadId: 'up_1' }), 'courier', 'customer'],
  ['driverAccount.checkInStatus', (c) => c.driverAccount.checkInStatus(), 'intercity_driver', 'customer'],
  ['driverAccount.onlineGate', (c) => c.driverAccount.onlineGate(), 'courier', 'customer'],
  ['driverAccount.handoverCode', (c) => c.driverAccount.handoverCode(), 'courier', 'field_ops'],
  ['khat.todayRun', (c) => c.khat.todayRun({}), 'khat_driver', 'driver'],
  ['khat.tapIn', (c) => c.khat.tapIn({ tripId: 't1', stopId: 's1' }), 'khat_driver', 'courier'],
  ['khat.tapOut', (c) => c.khat.tapOut({ tripId: 't1', stopId: 's1' }), 'khat_driver', 'courier'],
  ['khat.reportAbsence', (c) => c.khat.reportAbsence({ tripId: 't1', childRef: 'ch1', reason: 'sick' }), 'khat_driver', 'guardian'],
  ['khat.substituteOffers', (c) => c.khat.substituteOffers({ cityId: 'aziziyah' }), 'khat_driver', 'driver'],
  ['khat.acceptSubstitute', (c) => c.khat.acceptSubstitute({ offerId: 'o1' }), 'khat_driver', 'driver'],
  ['fleet.overview', (c) => c.fleet.overview({}), 'fleet_owner', 'driver'],
  ['fleet.vehicles', (c) => c.fleet.vehicles({}), 'fleet_owner', 'driver'],
  ['fleet.drivers', (c) => c.fleet.drivers({}), 'fleet_owner', 'admin'],
  ['fleet.driverEarnings', (c) => c.fleet.driverEarnings({ driverId: 'd1' }), 'fleet_owner', 'driver'],
  ['fleet.assignDriver', (c) => c.fleet.assignDriver({ vehicleId: 'v1', driverId: null }), 'fleet_owner', 'driver'],
  ['fleet.addVehicle', (c) => c.fleet.addVehicle({ plate: 'واسط 1', vehicleClass: 'car' }), 'fleet_owner', 'driver'],
  ['fleet.addVehicle', (c) => c.fleet.addVehicle({ plate: 'واسط 2', vehicleClass: 'van', seats: 11 }), 'fleet_owner', 'courier'],
  ['fleet.addDriver', (c) => c.fleet.addDriver({ phone: '07700000001' }), 'fleet_owner', 'driver'],
  ['fleet.myInvites', (c) => c.fleet.myInvites(), 'courier', 'fleet_owner'],
  ['fleet.respondInvite', (c) => c.fleet.respondInvite({ fleetOrgId: 'fleet_1', accept: true }), 'driver', 'customer'],
  ['ops.addLandmarkPhoto', (c) => c.ops.addLandmarkPhoto({ target: { kind: 'landmark', id: 'l1' }, uploadId: 'up_1' }), 'field_ops', 'courier'],
  ['ops.recordCashReceipt', (c) => c.ops.recordCashReceipt({ courierId: 'k1', amountIqd: 1000, code: '1234' }), 'field_ops', 'finance'],
  [
    'ops.merchantOnboarding',
    (c) => c.ops.merchantOnboarding({ cityId: 'aziziyah', name: 'مطعم', type: 'restaurant', contact: { name: 'a', phone: '07700000001' }, location: { zoneKey: 'centre' } }),
    'field_ops',
    'merchant_owner',
  ],
  ['ops.myTasks', (c) => c.ops.myTasks({}), 'field_ops', 'courier'],
  ['ops.completeTask', (c) => c.ops.completeTask({ taskId: 't1' }), 'admin', 'courier'],
  ['ops.cashHolders', (c) => c.ops.cashHolders({}), 'field_ops', 'courier'],
  ['ops.landmarks', (c) => c.ops.landmarks({ zoneKey: 'centre' }), 'field_ops', 'fleet_owner'],
  ['merchantAdmin.myMerchants', (c) => c.merchantAdmin.myMerchants(), 'merchant_staff', 'customer'],
  ['merchantAdmin.menu.get', (c) => c.merchantAdmin.menu.get(M), 'merchant_staff', 'customer'],
  ['merchantAdmin.menu.soldOutToday', (c) => c.merchantAdmin.menu.soldOutToday({ ...M, itemId: 'i1' }), 'merchant_staff', 'courier'],
  ['merchantAdmin.menu.updatePrice', (c) => c.merchantAdmin.menu.updatePrice({ ...M, itemId: 'i1', priceIqd: 3000 }), 'merchant_owner', 'courier'],
  ['merchantAdmin.menu.setModifiers', (c) => c.merchantAdmin.menu.setModifiers({ ...M, itemId: 'i1', groups: [] }), 'merchant_owner', 'courier'],
  ['merchantAdmin.menu.reorderCategories', (c) => c.merchantAdmin.menu.reorderCategories({ ...M, order: ['مشويات', 'لفات'] }), 'merchant_staff', 'courier'],
  ['merchantAdmin.menu.importFromPhotos', (c) => c.merchantAdmin.menu.importFromPhotos({ ...M, uploadIds: ['up_1'] }), 'merchant_staff', 'courier'],
  ['merchantAdmin.deals.project', (c) => c.merchantAdmin.deals.project({ ...M, type: 'free_delivery', nameAr: 'توصيل ببلاش', schedule: SCHEDULE }), 'merchant_owner', 'customer'],
  ['merchantAdmin.deals.propose', (c) => c.merchantAdmin.deals.propose({ ...M, type: 'percent', value: 10, nameAr: 'خصم', schedule: SCHEDULE }), 'merchant_owner', 'customer'],
  ['merchantAdmin.deals.review', (c) => c.merchantAdmin.deals.review({ dealId: 'd1', approve: true }), 'admin', 'merchant_owner'],
  ['merchantAdmin.money.today', (c) => c.merchantAdmin.money.today(M), 'merchant_owner', 'finance'],
  ['merchantAdmin.money.cash', (c) => c.merchantAdmin.money.cash(M), 'merchant_owner', 'courier'],
  ['merchantAdmin.money.statement', (c) => c.merchantAdmin.money.statement(M), 'merchant_owner', 'courier'],
  ['merchantAdmin.money.respondDispute', (c) => c.merchantAdmin.money.respondDispute({ ...M, orderId: 'o1', decision: 'contest' }), 'merchant_owner', 'customer'],
  ['merchantAdmin.insights', (c) => c.merchantAdmin.insights(M), 'merchant_staff', 'customer'],
  ['merchantAdmin.staff.invite', (c) => c.merchantAdmin.staff.invite({ ...M, phone: '07700000001' }), 'merchant_owner', 'customer'],
  ['merchantAdmin.staff.remove', (c) => c.merchantAdmin.staff.remove({ ...M, personId: 'p2' }), 'merchant_owner', 'customer'],
];

describe('wave-2 routers: role gates reach the right port', () => {
  it.each(CASES)('%s', async (name, run, allowed, refused) => {
    expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
    const no = caller([refused]);
    expect(await codeOf(run(no.call))).toBe('FORBIDDEN');
    expect(no.calls).toEqual([]);
    const yes = caller([allowed]);
    expect(await codeOf(run(yes.call))).toBe('NOT_FOUND');
    // Nested routers map onto flat port methods (menu.get → menuGet).
    const flat = name.split('.');
    const port = flat[0]!;
    const method = flat.slice(1).map((p, i) => (i === 0 ? p : p[0]!.toUpperCase() + p.slice(1))).join('');
    expect(yes.calls).toEqual([`${port}.${method}`]);
  });

  it('validates inputs before any port call', async () => {
    const { call, calls } = caller(['merchant_owner']);
    expect(await codeOf(call.merchantAdmin.menu.updatePrice({ merchantOrgId: 'org_1', itemId: 'i1', priceIqd: -5 }))).toBe('BAD_REQUEST');
    const ops = caller(['field_ops']);
    expect(await codeOf(ops.call.ops.recordCashReceipt({ courierId: 'k1', amountIqd: 1000, code: '12a4' }))).toBe('BAD_REQUEST');
    const reviewer = caller(['field_ops']);
    expect(await codeOf(reviewer.call.driverAccount.reviewDocument({ documentId: 'd1', decision: 'reject' }))).toBe('BAD_REQUEST');
    expect([...calls, ...ops.calls, ...reviewer.calls]).toEqual([]);
  });
});
