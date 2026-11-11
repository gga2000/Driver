import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleKind } from '../auth.js';
import type { AdminMenu, AdminMenuItem } from '../merchant-admin-io.js';
import type { StoreHoursView, StoreStatusView } from '../merchant-io.js';
import type { MerchantSetupView } from '../merchant-setup-io.js';
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

const NOW = new Date('2026-10-21T09:00:00Z');
const WEEK = Array.from({ length: 7 }, (_, dow) => ({ dow, shifts: [{ start: '12:00', end: '23:00' }] }));
const SETUP: MerchantSetupView = {
  merchantOrgId: 'org_k',
  name: 'مشويات الحاج كريم',
  active: true,
  live: false,
  liveAt: null,
  progress: { steps: [], percent: 40, done: 3, total: 7, left: 4, minutesLeft: 6, next: 'hours' },
  kinds: { confirmed: ['meal'], suggested: ['meal'] },
  shopPhotoUrl: null,
  menu: { items: 18, withPhoto: 14, libraryPhotos: 6, missingPhotos: 4, pendingCards: 0, cards: 'none' },
  hours: { set: false, source: 'none' },
  payout: { seen: false },
  pickup: { set: false },
  counter: { sound: false, screen: false, practice: false, printerLater: false },
  firstOrder: null,
};
const STATUS: StoreStatusView = {
  merchantOrgId: 'org_k',
  name: 'مشويات الحاج كريم',
  now: NOW,
  open: false,
  closed: null,
  pause: null,
  busy: { on: false, until: null, extraPrepMinutes: 0 },
  printer: { state: 'disconnected', name: null, updatedAt: null },
  lastHeartbeatAt: null,
  defaultPrepMinutes: 20,
};
const HOURS: StoreHoursView = {
  merchantOrgId: 'org_k',
  timeZone: 'Asia/Baghdad',
  source: 'store',
  days: WEEK,
  holidays: [],
  pauses: [],
  now: NOW,
  today: '2026-10-21',
  state: { open: true, reason: null, closesAt: '23:00', opensAt: null },
  canEdit: true,
  updatedAt: null,
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
    setup: vi.fn(async () => SETUP),
    status: vi.fn(async () => STATUS),
    hours: vi.fn(async () => HOURS),
    setHours: vi.fn(async () => HOURS),
    setOpen: vi.fn(async () => STATUS),
    setBusy: vi.fn(async () => STATUS),
    confirmKinds: vi.fn(async () => SETUP),
    shopPhoto: vi.fn(async () => SETUP),
    dishPhoto: vi.fn(async () => SETUP),
    goLive: vi.fn(async () => SETUP),
  };
  const ctx = {
    auth: roles ? { sub: 'p_1', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    // A staff session past the authenticator step (admin and finance routes fail closed without it).
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind), secondStepPending: async () => false },
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
  ['setup', (c) => c.ops.stores.setup(S)],
  ['status', (c) => c.ops.stores.status(S)],
  ['hours', (c) => c.ops.stores.hours(S)],
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
  ['setHours', (c) => c.ops.stores.setHours({ ...S, days: WEEK, holidays: [], why: 'زيارة' })],
  ['setOpen', (c) => c.ops.stores.setOpen({ ...S, open: false, reason: 'other' })],
  ['setBusy', (c) => c.ops.stores.setBusy({ ...S, on: true })],
  ['confirmKinds', (c) => c.ops.stores.confirmKinds({ ...S, kinds: ['meal'] })],
  ['shopPhoto', (c) => c.ops.stores.shopPhoto({ ...S, uploadId: 'up_1' })],
  ['dishPhoto', (c) => c.ops.stores.dishPhoto({ ...S, itemId: 'it_1', uploadId: 'up_2' })],
  ['goLive', (c) => c.ops.stores.goLive(S)],
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
