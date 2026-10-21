import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleKind } from '../auth.js';
import type { AdminMenu, AdminMenuItem } from '../merchant-admin-io.js';
import { appRouter } from '../router.js';
import type { StoreRow, StoresOpsPort } from '../store-setup-io.js';
import { t, type AppContext } from '../trpc.js';

const ITEM: AdminMenuItem = {
  id: 'it_1',
  nameAr: 'تكة لحم',
  nameEn: null,
  description: null,
  priceIqd: 8000,
  photoUrl: null,
  categoryAr: 'مشويات',
  sortOrder: 10,
  prepTimeMin: 20,
  available: true,
  soldOutUntil: null,
  onSale: true,
  modifierGroups: [],
};
const MENU: AdminMenu = { merchantOrgId: 'org_k', categories: [{ nameAr: 'مشويات', items: [ITEM] }] };
const ROW: StoreRow = {
  merchantOrgId: 'org_k',
  name: 'مشويات الحاج كريم',
  type: 'restaurant',
  photoUrl: null,
  state: 'setup',
  steps: { done: 3, total: 7, next: 'hours' },
  dishes: 18,
  dishesNoPhoto: 4,
  lastEdit: null,
};

function caller(roles: readonly RoleKind[] | null) {
  const stores: StoresOpsPort = {
    list: vi.fn(async () => [ROW]),
    history: vi.fn(async () => []),
    menu: vi.fn(async () => MENU),
    upsertItem: vi.fn(async () => ITEM),
    addItems: vi.fn(async () => MENU),
    upsertCategory: vi.fn(async () => MENU),
    reorderCategories: vi.fn(async () => MENU),
    setModifiers: vi.fn(async () => ITEM),
    setAvailability: vi.fn(async () => ITEM),
    soldOutToday: vi.fn(async () => ITEM),
    libraryPhoto: vi.fn(async () => ITEM),
  };
  const ctx = {
    auth: roles ? { sub: 'p_1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    stores,
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), stores };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => 'ok', (e: unknown) => e);
  if (err === 'ok') return 'ok';
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

type Call = ReturnType<typeof caller>['call'];
const ALL: readonly RoleKind[] = ['customer', 'courier', 'driver', 'merchant_owner', 'merchant_staff', 'fleet_owner', 'field_ops', 'dispatcher', 'support', 'finance', 'admin'];
const READERS: readonly RoleKind[] = ['field_ops', 'admin', 'support'];
/** Support reads every store but never changes one; the store's own people use `merchantAdmin.*`. */
const EDITORS: readonly RoleKind[] = ['field_ops', 'admin'];
const S = { merchantOrgId: 'org_k' };

const READS: Array<[string, (c: Call) => Promise<unknown>]> = [
  ['list', (c) => c.ops.stores.list({ cityId: 'aziziyah' })],
  ['history', (c) => c.ops.stores.history(S)],
  ['menu', (c) => c.ops.stores.menu(S)],
];
const WRITES: Array<[string, (c: Call) => Promise<unknown>]> = [
  ['upsertItem', (c) => c.ops.stores.upsertItem({ ...S, nameAr: 'كباب', priceIqd: 7000 })],
  ['addItems', (c) => c.ops.stores.addItems({ ...S, items: [{ nameAr: 'زنگر', priceIqd: 5000 }] })],
  ['upsertCategory', (c) => c.ops.stores.upsertCategory({ ...S, nameAr: 'مقبلات' })],
  ['reorderCategories', (c) => c.ops.stores.reorderCategories({ ...S, order: ['مشويات'] })],
  ['setModifiers', (c) => c.ops.stores.setModifiers({ ...S, itemId: 'it_1', groups: [] })],
  ['setAvailability', (c) => c.ops.stores.setAvailability({ ...S, itemId: 'it_1', available: false })],
  ['soldOutToday', (c) => c.ops.stores.soldOutToday({ ...S, itemId: 'it_1' })],
  ['libraryPhoto', (c) => c.ops.stores.libraryPhoto({ ...S, itemId: 'it_1', photo: 'lib-kebab-1.webp' })],
];

describe('ops.stores: role gates', () => {
  for (const [name, run] of READS) {
    it(`${name}: field ops, admin and support read`, async () => {
      expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
      for (const role of ALL) expect([role, await codeOf(run(caller([role]).call))]).toEqual([role, READERS.includes(role) ? 'ok' : 'FORBIDDEN']);
    });
  }
  for (const [name, run] of WRITES) {
    it(`${name}: field ops and admin only (support is refused)`, async () => {
      expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
      for (const role of ALL) expect([role, await codeOf(run(caller([role]).call))]).toEqual([role, EDITORS.includes(role) ? 'ok' : 'FORBIDDEN']);
    });
  }

  it('only a real library file name reaches the API', async () => {
    const { call, stores } = caller(['field_ops']);
    for (const photo of ['../secret.webp', 'lib-kebab.webp', 'kebab-1.webp', 'lib-kebab-1.png', 'https://x.io/lib-kebab-1.webp']) {
      expect(await codeOf(call.ops.stores.libraryPhoto({ ...S, itemId: 'it_1', photo }))).toBe('BAD_REQUEST');
    }
    expect(stores.libraryPhoto).not.toHaveBeenCalled();
    expect(await codeOf(call.ops.stores.libraryPhoto({ ...S, itemId: 'it_1', photo: 'lib-mixed-grill-2.webp' }))).toBe('ok');
  });
});
