import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleKind } from '../auth.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';
import type { ZoneChecksPort, ZonePlacementView, ZonesPort } from '../zones-io.js';

const VIEW: ZonePlacementView = {
  key: 'centre', name_ar: 'العزيزية (مركز)', name_en: 'Aziziyah centre', tier: 'centre', group: 'centre', placement: 'placed',
  ring: [{ lat: 32.9, lng: 45.05 }, { lat: 32.9, lng: 45.07 }, { lat: 32.91, lng: 45.06 }], centre: { lat: 32.903, lng: 45.06 },
  areaM2: 1_000_000, placedBy: 'علي', placedAt: new Date('2026-10-05T10:00:00Z'),
};
const RING = VIEW.ring;

function caller(roles: readonly RoleKind[] | null) {
  const zones: ZonesPort = { list: vi.fn(async () => [VIEW]), place: vi.fn(async () => VIEW), clearCheckFlag: vi.fn(async () => VIEW) };
  const zoneChecks: ZoneChecksPort = { open: vi.fn(async () => null), answer: vi.fn(async () => undefined) };
  const ctx = {
    auth: roles ? { sub: 'p_staff', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    zones,
    zoneChecks,
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), zones, zoneChecks };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => 'ok', (e: unknown) => e);
  if (err === 'ok') return 'ok';
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

type Call = ReturnType<typeof caller>['call'];
const ALL: readonly RoleKind[] = ['customer', 'courier', 'driver', 'merchant_owner', 'fleet_owner', 'field_ops', 'dispatcher', 'support', 'finance', 'admin'];
const MATRIX: Array<[string, readonly RoleKind[], (c: Call) => Promise<unknown>]> = [
  ['ops.zones.list', ['dispatcher', 'support', 'finance', 'admin', 'field_ops'], (c) => c.ops.zones.list({})],
  ['ops.zones.place', ['admin', 'field_ops'], (c) => c.ops.zones.place({ key: 'centre', ring: RING, centre: VIEW.centre })],
  ['ops.zones.clearCheckFlag', ['admin', 'field_ops'], (c) => c.ops.zones.clearCheckFlag({ key: 'centre' })],
  ['partner.zoneCheck', ['courier', 'driver'], (c) => c.partner.zoneCheck()],
  ['partner.answerZoneCheck', ['courier', 'driver'], (c) => c.partner.answerZoneCheck({ checkId: 'zc_1', answer: 'yes' })],
];

describe('ops.zones: role gates', () => {
  for (const [name, allowed, run] of MATRIX) {
    it(`${name}: ${allowed.join(', ')} only`, async () => {
      expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
      for (const role of ALL) expect([role, await codeOf(run(caller([role]).call))]).toEqual([role, allowed.includes(role) ? 'ok' : 'FORBIDDEN']);
    });
  }
});

describe('ops.zones: input', () => {
  it('defaults the city and passes the outline through', async () => {
    const c = caller(['admin']);
    await c.call.ops.zones.place({ key: 'centre', ring: RING, centre: VIEW.centre });
    expect(vi.mocked(c.zones.place).mock.calls[0]![1]).toEqual({ cityId: 'aziziyah', key: 'centre', ring: RING, centre: VIEW.centre });
  });
  it('refuses fewer than 3 corners before reaching the port', async () => {
    const c = caller(['admin']);
    expect(await codeOf(c.call.ops.zones.place({ key: 'centre', ring: RING.slice(0, 2), centre: VIEW.centre }))).toBe('BAD_REQUEST');
    expect(c.zones.place).not.toHaveBeenCalled();
  });
});

describe('ops.zones.clearCheckFlag: input', () => {
  it('defaults the city and passes the Console user and zone through', async () => {
    const c = caller(['field_ops']);
    await c.call.ops.zones.clearCheckFlag({ key: ' centre ' });
    expect(vi.mocked(c.zones.clearCheckFlag).mock.calls[0]![1]).toEqual({ cityId: 'aziziyah', key: 'centre' });
    expect(await codeOf(c.call.ops.zones.clearCheckFlag({ key: '' }))).toBe('BAD_REQUEST');
    expect(c.zones.clearCheckFlag).toHaveBeenCalledTimes(1);
  });
});

describe('partner.answerZoneCheck: input', () => {
  it('passes his answer through and refuses anything but إي / لا / ما أعرف', async () => {
    const c = caller(['courier']);
    await c.call.partner.answerZoneCheck({ checkId: 'zc_1', answer: 'unsure' });
    expect(vi.mocked(c.zoneChecks.answer).mock.calls[0]![1]).toEqual({ checkId: 'zc_1', answer: 'unsure' });
    const notAnAnswer = { checkId: 'zc_1', answer: 'maybe' };
    expect(await codeOf(c.call.partner.answerZoneCheck(notAnAnswer as never))).toBe('BAD_REQUEST');
    expect(c.zoneChecks.answer).toHaveBeenCalledTimes(1);
  });
});
