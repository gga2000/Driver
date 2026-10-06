import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleKind } from '../auth.js';
import type { ConsolePickupSpotView, PickupSpotsOpsPort, PickupStoreRow } from '../merchant-io.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';

const VIEW: ConsolePickupSpotView = {
  merchantOrgId: 'org_k',
  storeName: 'مطعم خالد',
  note: 'الاستلام من الشباك اليسار',
  photos: [{ id: 'up_1', url: '/uploads/up_1' }],
  canEdit: true,
  updatedAt: new Date('2026-10-07T09:00:00Z'),
  consoleEdit: null,
};
const ROW: PickupStoreRow = { merchantOrgId: 'org_k', name: 'مطعم خالد', type: 'restaurant', note: VIEW.note, photos: 1, updatedAt: VIEW.updatedAt };

function caller(roles: readonly RoleKind[] | null) {
  const pickupSpots: PickupSpotsOpsPort = {
    stores: vi.fn(async () => [ROW]),
    get: vi.fn(async () => VIEW),
    set: vi.fn(async () => VIEW),
  };
  const ctx = {
    auth: roles ? { sub: 'p_1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    pickupSpots,
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), pickupSpots };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => 'ok', (e: unknown) => e);
  if (err === 'ok') return 'ok';
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

type Call = ReturnType<typeof caller>['call'];
const ALL: readonly RoleKind[] = ['customer', 'courier', 'driver', 'merchant_owner', 'merchant_staff', 'fleet_owner', 'field_ops', 'dispatcher', 'support', 'finance', 'admin'];
/** Field ops and «everything» admins; not support, dispatch or finance, and not the store's own people (they use `merchant.*`). */
const CONSOLE_EDITORS: readonly RoleKind[] = ['field_ops', 'admin'];
const SCOPE = { merchantOrgId: 'org_k' };
const MATRIX: Array<[string, (c: Call) => Promise<unknown>]> = [
  ['ops.pickupSpots.stores', (c) => c.ops.pickupSpots.stores({ cityId: 'aziziyah' })],
  ['ops.pickupSpots.get', (c) => c.ops.pickupSpots.get(SCOPE)],
  ['ops.pickupSpots.set', (c) => c.ops.pickupSpots.set({ ...SCOPE, note: 'من الباب الجانبي', photoIds: ['up_1'] })],
];

describe('pickup spot from the Console: role gates', () => {
  for (const [name, run] of MATRIX) {
    it(`${name}: field ops and admin only`, async () => {
      expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
      for (const role of ALL) expect([role, await codeOf(run(caller([role]).call))]).toEqual([role, CONSOLE_EDITORS.includes(role) ? 'ok' : 'FORBIDDEN']);
    });
  }
});

describe('pickup spot from the Console: input', () => {
  it('passes the trimmed note and the photos in order', async () => {
    const c = caller(['field_ops']);
    await c.call.ops.pickupSpots.set({ ...SCOPE, note: '  من الباب الجانبي ', photoIds: ['up_2', 'up_1'] });
    expect(vi.mocked(c.pickupSpots.set).mock.calls[0]![1]).toEqual({ ...SCOPE, note: 'من الباب الجانبي', photoIds: ['up_2', 'up_1'] });
  });

  it('refuses a long note, a third photo and a repeated photo before reaching the port', async () => {
    const c = caller(['admin']);
    expect(await codeOf(c.call.ops.pickupSpots.set({ ...SCOPE, note: 'ا'.repeat(141), photoIds: [] }))).toBe('BAD_REQUEST');
    expect(await codeOf(c.call.ops.pickupSpots.set({ ...SCOPE, note: null, photoIds: ['a', 'b', 'c'] }))).toBe('BAD_REQUEST');
    expect(await codeOf(c.call.ops.pickupSpots.set({ ...SCOPE, note: null, photoIds: ['a', 'a'] }))).toBe('BAD_REQUEST');
    expect(c.pickupSpots.set).not.toHaveBeenCalled();
  });
});
