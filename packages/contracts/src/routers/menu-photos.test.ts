import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleKind } from '../auth.js';
import type { MenuPhotoRequestView, MenuPhotosPort } from '../menu-photos-io.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';

const VIEW: MenuPhotoRequestView = {
  requestId: 'mpr_1', merchantOrgId: 'org_k', storeName: 'مطعم خالد', cityId: 'aziziyah', zoneKey: 'centre', pin: null,
  state: 'requested', note: 'الأفضل الصبح قبل الزحمة', wholeMenu: true, dishes: [], photographerName: null, assignedToMe: false,
  scheduledFor: null, requestedAt: new Date('2026-10-07T07:00:00Z'), shotAt: null, closedAt: null,
  counts: { dishes: 0, proposed: 0, accepted: 0, rejected: 0 }, canAct: true,
};

function caller(roles: readonly RoleKind[] | null) {
  const menuPhotos: MenuPhotosPort = {
    merchantList: vi.fn(async () => [VIEW]),
    request: vi.fn(async () => VIEW),
    cancel: vi.fn(async () => VIEW),
    decide: vi.fn(async () => VIEW),
    openForOps: vi.fn(async () => [VIEW]),
    opsGet: vi.fn(async () => VIEW),
    schedule: vi.fn(async () => VIEW),
    addShot: vi.fn(async () => VIEW),
    markShot: vi.fn(async () => VIEW),
    queue: vi.fn(async () => [VIEW]),
  };
  const ctx = {
    auth: roles ? { sub: 'p_1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    menuPhotos,
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), menuPhotos };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => 'ok', (e: unknown) => e);
  if (err === 'ok') return 'ok';
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

type Call = ReturnType<typeof caller>['call'];
const ALL: readonly RoleKind[] = ['customer', 'courier', 'driver', 'merchant_owner', 'merchant_staff', 'fleet_owner', 'field_ops', 'dispatcher', 'support', 'finance', 'admin'];
const MERCHANT: readonly RoleKind[] = ['merchant_owner', 'merchant_staff'];
const FIELD_OPS: readonly RoleKind[] = ['field_ops', 'admin'];
const SCOPE = { merchantOrgId: 'org_k' };
const MATRIX: Array<[string, readonly RoleKind[], (c: Call) => Promise<unknown>]> = [
  ['merchantAdmin.menuPhotos.list', MERCHANT, (c) => c.merchantAdmin.menuPhotos.list(SCOPE)],
  ['merchantAdmin.menuPhotos.request', MERCHANT, (c) => c.merchantAdmin.menuPhotos.request({ ...SCOPE, itemIds: [] })],
  ['merchantAdmin.menuPhotos.cancel', MERCHANT, (c) => c.merchantAdmin.menuPhotos.cancel({ ...SCOPE, requestId: 'mpr_1' })],
  ['merchantAdmin.menuPhotos.decide', MERCHANT, (c) => c.merchantAdmin.menuPhotos.decide({ ...SCOPE, requestId: 'mpr_1', shotId: 'mps_1', accept: true })],
  ['ops.menuPhotos.open', FIELD_OPS, (c) => c.ops.menuPhotos.open({})],
  ['ops.menuPhotos.get', FIELD_OPS, (c) => c.ops.menuPhotos.get({ requestId: 'mpr_1' })],
  ['ops.menuPhotos.schedule', FIELD_OPS, (c) => c.ops.menuPhotos.schedule({ requestId: 'mpr_1', scheduledFor: new Date('2026-10-07T09:00:00Z') })],
  ['ops.menuPhotos.addShot', FIELD_OPS, (c) => c.ops.menuPhotos.addShot({ requestId: 'mpr_1', itemId: 'it_1', uploadId: 'up_1' })],
  ['ops.menuPhotos.markShot', FIELD_OPS, (c) => c.ops.menuPhotos.markShot({ requestId: 'mpr_1' })],
  ['ops.menuPhotos.queue', ['dispatcher', 'support', 'finance', 'admin', 'field_ops'], (c) => c.ops.menuPhotos.queue({})],
];

describe('menu photo service: role gates', () => {
  for (const [name, allowed, run] of MATRIX) {
    it(`${name}: ${allowed.join(', ')} only`, async () => {
      expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
      for (const role of ALL) expect([role, await codeOf(run(caller([role]).call))]).toEqual([role, allowed.includes(role) ? 'ok' : 'FORBIDDEN']);
    });
  }
});

describe('menu photo service: input', () => {
  it('defaults the city and passes the store, dishes and trimmed note through', async () => {
    const c = caller(['merchant_owner']);
    await c.call.merchantAdmin.menuPhotos.request({ ...SCOPE, itemIds: ['it_1', 'it_2'], note: '  الأفضل الصبح قبل الزحمة ' });
    expect(vi.mocked(c.menuPhotos.request).mock.calls[0]![1]).toEqual({ ...SCOPE, itemIds: ['it_1', 'it_2'], note: 'الأفضل الصبح قبل الزحمة' });
    const o = caller(['field_ops']);
    await o.call.ops.menuPhotos.open({});
    expect(vi.mocked(o.menuPhotos.openForOps).mock.calls[0]![1]).toEqual({ cityId: 'aziziyah' });
  });

  it('refuses a too-long note and too many dishes before reaching the port', async () => {
    const c = caller(['merchant_owner']);
    expect(await codeOf(c.call.merchantAdmin.menuPhotos.request({ ...SCOPE, note: 'ا'.repeat(201) }))).toBe('BAD_REQUEST');
    expect(await codeOf(c.call.merchantAdmin.menuPhotos.request({ ...SCOPE, itemIds: Array.from({ length: 81 }, (_, i) => `it_${i}`) }))).toBe('BAD_REQUEST');
    expect(c.menuPhotos.request).not.toHaveBeenCalled();
  });
});
