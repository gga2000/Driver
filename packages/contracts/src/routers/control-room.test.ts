import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleKind } from '../auth.js';
import type { ControlRoomPort, ControlsPort } from '../control-room-io.js';
import type { SupportPort } from '../support-io.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';

const AT = new Date('2026-10-04T09:00:00Z');
const LATER = new Date('2026-10-04T12:00:00Z');

const ticket = {
  id: 'tk_1',
  cityId: 'aziziyah',
  kind: 'dispute' as const,
  kind_ar: 'نزاع',
  status: 'open' as const,
  status_ar: 'مفتوحة',
  channel: 'in_app' as const,
  subject: 'الطلب تأخّر',
  orderId: 'o1',
  tripId: null,
  customerId: 'c1',
  customerName: 'علي',
  openedAt: AT,
  firstResponseAt: null,
  resolvedAt: null,
  slaDueAt: LATER,
  slaState: 'ok' as const,
  overdue24h: false,
  urgency: 10,
  urgencyReasons: [],
  assigneeId: null,
  faultParty: 'none' as const,
  refundedIqd: 0,
  escalatedTo: null,
  lastActivityAt: AT,
};
const ticketCase = {
  ticket,
  entries: [],
  order: null,
  timeline: [],
  ledger: [],
  chatKinds: [],
  limits: { agentDailyCapIqd: 10_000, agentUsedTodayIqd: 0, customerMonthlyCapIqd: 25_000, customerUsedMonthIqd: 0, escalateAboveIqd: 25_000, availableIqd: 10_000, cashAboveIqd: 10_000 },
  canned: [],
  suggestion: null,
  customerDisputes30d: 1,
};
const switchView = { id: 'ks_1', cityId: 'aziziyah', scope: 'vertical' as const, key: 'food', label_ar: 'الأكل', vertical: null, active: true, holdDispatch: false, message_ar: null, reason: 'مطر', setBy: 'p_staff', setByName: 'علي', setAt: AT, expiresAt: null };
const zoneView = { zoneKey: 'zakur', name_ar: 'زاكور', tier: 'mid', maxActive: 5, mode: 'refuse' as const, etaMin: 15, active: 2, load: 0.4, state: 'ok' as const, killed: false, setBy: 'p_staff', setAt: AT };
const bannerView = { id: 'bn_1', severity: 'info' as const, message_ar: 'هلا', message_en: null, expiresAt: LATER, cityId: null, audiences: ['customer' as const], startsAt: AT, active: true, setBy: 'p_staff', setByName: null, setAt: AT, clearedAt: null };
const quietView = { id: 'qd_1', cityId: 'aziziyah', startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'يوم عزاء', active: false, setBy: 'p_staff', setByName: null, setAt: AT, clearedAt: null };
const seasonView = { ...quietView, kind: 'ramadan' as const, celebrations: true, sounds: true, promos: true, accent: true, homeCard: true, homeCardAr: null, shiaOffsetMin: null, days: [] };

function ports() {
  const controls: ControlsPort = {
    view: vi.fn(async (cityId: string) => ({ cityId, at: AT, switches: [switchView], zones: [zoneView], verticals: [], restaurants: [], corridors: [], activeOrders: 2 })),
    setSwitch: vi.fn(async () => switchView),
    setCapacity: vi.fn(async () => zoneView),
    audit: vi.fn(async () => []),
    banner: vi.fn(async () => ({ id: 'bn_1', severity: 'info' as const, message_ar: 'هلا', message_en: null, expiresAt: LATER })),
    banners: vi.fn(async () => [bannerView]),
    setBanner: vi.fn(async () => bannerView),
    clearBanner: vi.fn(async () => bannerView),
    season: vi.fn(async () => ({ quiet: false, celebrations: true, sounds: true, promos: true, quietUntil: null, kind: 'ordinary' as const, accent: true, ramadan: null, homeCard: null })),
    quietDays: vi.fn(async () => [quietView]),
    setQuietDays: vi.fn(async () => quietView),
    clearQuietDays: vi.fn(async () => quietView),
    seasons: vi.fn(async () => [seasonView]),
    setSeason: vi.fn(async () => seasonView),
    clearSeason: vi.fn(async () => seasonView),
    setIftarTime: vi.fn(async () => seasonView),
  };
  const controlRoom: ControlRoomPort = {
    approvals: vi.fn(async () => ({ at: AT, items: [], counts: { driver_document: 0, merchant_deal: 0, landmark_photo: 0, merchant_onboarding: 0, fleet_vehicle: 0, vehicle_features: 0 } })),
    decide: vi.fn(async (_a, input) => ({ id: `${input.kind}:${input.refId}`, kind: input.kind, refId: input.refId, decision: input.decision, decidedAt: AT })),
    finance: vi.fn(async () => ({
      cityId: 'aziziyah',
      at: AT,
      localDate: '2026-10-04',
      couriers: [],
      merchants: [],
      handovers: [],
      round: { at: LATER, stops: [], totalIqd: 0 },
      nightly: { ok: true, message_ar: 'الدفتر متوازن', moneyNet: 0, pointsNet: 0, kindViolations: 0, checkedAt: AT, lastClose: null },
      totals: { cashInFieldIqd: 0, merchantsPayableIqd: 0, collectedTodayIqd: 0, couriersOverCap: 0 },
    })),
    exportSettlement: vi.fn(async () => ({ filename: 'driver-couriers-2026-10-04.csv', csv: 'a\r\n', rows: 0 })),
    metrics: vi.fn(async () => ({ cityId: 'aziziyah', at: AT, since: AT, day: 1, metrics: [], ordersByDay: [], deliverySamples: 0, offers: { accepted: 0, answered: 0 }, openTickets: 0 })),
  };
  const support: SupportPort = {
    list: vi.fn(async () => ({ at: AT, rows: [ticket], counts: { open: 1, breached: 0, overdue24h: 0, escalated: 0, resolvedToday: 0 } })),
    get: vi.fn(async () => ticketCase),
    open: vi.fn(async () => ticket),
    reply: vi.fn(async () => ticketCase),
    refund: vi.fn(async () => ticketCase),
    attributeFault: vi.fn(async () => ticketCase),
    escalate: vi.fn(async () => ticketCase),
    resolve: vi.fn(async () => ticketCase),
    canned: vi.fn(() => []),
    customer: vi.fn(async () => null),
  };
  return { controls, controlRoom, support };
}

function caller(roles: readonly RoleKind[] | null) {
  const p = ports();
  const ctx = {
    auth: roles ? { sub: 'p_staff', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    ...p,
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), ...p };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => 'ok',
    (e: unknown) => e,
  );
  if (err === 'ok') return 'ok';
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

type Call = ReturnType<typeof caller>['call'];
const ALL: readonly RoleKind[] = ['customer', 'courier', 'driver', 'merchant_owner', 'fleet_owner', 'field_ops', 'dispatcher', 'support', 'finance', 'admin'];

/** Every procedure with the roles that may call it (the rest: FORBIDDEN; no session: UNAUTHORIZED). */
const MATRIX: Array<[string, readonly RoleKind[], (c: Call) => Promise<unknown>]> = [
  ['ops.controls.view', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.ops.controls.view({})],
  ['ops.controls.setSwitch', ['dispatcher', 'admin'], (c) => c.ops.controls.setSwitch({ scope: 'vertical', key: 'food', active: true, reason: 'مطر قوي' })],
  ['ops.controls.setCapacity', ['dispatcher', 'admin'], (c) => c.ops.controls.setCapacity({ zoneKey: 'zakur', maxActive: 5 })],
  ['ops.controls.audit', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.ops.controls.audit({})],
  ['system.banners', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.system.banners()],
  ['system.setBanner', ['admin'], (c) => c.system.setBanner({ severity: 'info', audiences: ['customer'], message_ar: 'هلا بيكم', expiresAt: LATER })],
  ['system.clearBanner', ['admin'], (c) => c.system.clearBanner({ bannerId: 'bn_1' })],
  ['system.quietDays', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.system.quietDays()],
  ['system.setQuietDays', ['admin'], (c) => c.system.setQuietDays({ startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'يوم عزاء' })],
  ['system.clearQuietDays', ['admin'], (c) => c.system.clearQuietDays({ quietId: 'qd_1' })],
  ['system.seasons', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.system.seasons()],
  ['system.setSeason', ['admin'], (c) => c.system.setSeason({ kind: 'ramadan', startsOn: '2027-02-07', endsOn: '2027-03-09', label_ar: 'رمضان' })],
  ['system.clearSeason', ['admin'], (c) => c.system.clearSeason({ seasonId: 'qd_1' })],
  ['system.setIftarTime', ['admin'], (c) => c.system.setIftarTime({ seasonId: 'qd_1', day: '2027-02-08', timetable: 'shia', time: '17:55' })],
  ['approvals.list', ['field_ops', 'support', 'admin'], (c) => c.approvals.list({})],
  ['approvals.decide', ['field_ops', 'support', 'admin'], (c) => c.approvals.decide({ kind: 'driver_document', refId: 'd1', decision: 'approve' })],
  ['support.list', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.list({})],
  ['support.get', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.get({ ticketId: 'tk_1' })],
  ['support.customer', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.customer({ ticketId: 'tk_1' })],
  ['support.canned', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.canned()],
  ['support.open', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.open({ kind: 'question', subject: 'سؤال عن الطلب' })],
  ['support.reply', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.reply({ ticketId: 'tk_1', text: 'هلا' })],
  ['support.refund', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.refund({ ticketId: 'tk_1', amountIqd: 1000, method: 'wallet', idempotencyKey: 'key-12345' })],
  ['support.attributeFault', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.attributeFault({ ticketId: 'tk_1', faultParty: 'courier', note: 'تأخر' })],
  ['support.escalate', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.escalate({ ticketId: 'tk_1', reason: 'فلوس كثيرة' })],
  ['support.resolve', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.support.resolve({ ticketId: 'tk_1', resolution: 'تعوّض' })],
  ['finance.desk', ['finance', 'admin', 'dispatcher', 'field_ops'], (c) => c.finance.desk({})],
  ['finance.exportSettlement', ['finance', 'admin'], (c) => c.finance.exportSettlement({ kind: 'couriers' })],
  ['metrics.wall', ['dispatcher', 'support', 'finance', 'admin'], (c) => c.metrics.wall({})],
];

describe('launch control room routers: role gates', () => {
  for (const [name, allowed, run] of MATRIX) {
    it(`${name}: ${allowed.join(', ')} only`, async () => {
      expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
      for (const role of ALL) expect([role, await codeOf(run(caller([role]).call))]).toEqual([role, allowed.includes(role) ? 'ok' : 'FORBIDDEN']);
    });
  }

  it('system.banner is public and validated', async () => {
    const anon = caller(null);
    expect(await anon.call.system.banner({ app: 'customer' })).toMatchObject({ id: 'bn_1', severity: 'info' });
    expect(anon.controls.banner).toHaveBeenCalledWith({ app: 'customer' });
    expect(await codeOf(anon.call.system.banner({ app: 'console' as never }))).toBe('BAD_REQUEST');
  });

  it('system.season is public; quiet days are validated before the port', async () => {
    const anon = caller(null);
    expect(await anon.call.system.season({ cityId: 'aziziyah' })).toMatchObject({ quiet: false, celebrations: true, sounds: true, promos: true });
    expect(anon.controls.season).toHaveBeenCalledWith({ cityId: 'aziziyah' });
    const admin = caller(['admin']);
    expect(await codeOf(admin.call.system.setQuietDays({ startsOn: '2026-11-14', endsOn: '2026-11-13', label_ar: 'يوم عزاء' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.system.setQuietDays({ startsOn: '13-11-2026', endsOn: '2026-11-13', label_ar: 'يوم عزاء' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.system.setQuietDays({ startsOn: '2026-11-13', endsOn: '2026-11-13', label_ar: 'يو' }))).toBe('BAD_REQUEST');
    expect(admin.controls.setQuietDays).not.toHaveBeenCalled();
  });

  it('J6: the season read takes the picked timetable; season periods and iftar times are validated before the port', async () => {
    const anon = caller(null);
    await anon.call.system.season({ cityId: 'aziziyah', timetable: 'shia' });
    expect(anon.controls.season).toHaveBeenCalledWith({ cityId: 'aziziyah', timetable: 'shia' });
    expect(await codeOf(anon.call.system.season({ timetable: 'other' as never }))).toBe('BAD_REQUEST');
    const admin = caller(['admin']);
    expect(await codeOf(admin.call.system.setSeason({ kind: 'feast' as never, startsOn: '2027-02-07', endsOn: '2027-03-09', label_ar: 'رمضان' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.system.setSeason({ kind: 'ramadan', startsOn: '2027-03-09', endsOn: '2027-02-07', label_ar: 'رمضان' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.system.setSeason({ kind: 'ramadan', startsOn: '2027-02-07', endsOn: '2027-03-09', label_ar: 'رمضان', shiaOffsetMin: 90 }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.system.setIftarTime({ seasonId: 'qd_1', day: '2027-02-08', timetable: 'shia', time: '5:55' }))).toBe('BAD_REQUEST');
    expect(admin.controls.setSeason).not.toHaveBeenCalled();
    expect(admin.controls.setIftarTime).not.toHaveBeenCalled();
  });

  it('inputs are validated before the port: a refusal needs a reason, refunds come in 250s, capacity and banners are bounded', async () => {
    const admin = caller(['admin']);
    expect(await codeOf(admin.call.approvals.decide({ kind: 'driver_document', refId: 'd1', decision: 'reject' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.support.refund({ ticketId: 'tk_1', amountIqd: 1100, method: 'wallet', idempotencyKey: 'key-12345' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.support.refund({ ticketId: 'tk_1', amountIqd: 1000, method: 'wallet', faultParty: 'customer' as never, idempotencyKey: 'key-12345' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.ops.controls.setCapacity({ zoneKey: 'zakur', maxActive: 0 }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.ops.controls.setSwitch({ scope: 'zone', key: 'zakur', active: true, reason: 'x' }))).toBe('BAD_REQUEST');
    expect(await codeOf(admin.call.system.setBanner({ severity: 'info', audiences: [], message_ar: 'هلا بيكم', expiresAt: LATER }))).toBe('BAD_REQUEST');
    expect(admin.controlRoom.decide).not.toHaveBeenCalled();
    expect(admin.support.refund).not.toHaveBeenCalled();
  });

  it('defaults reach the port: city aziziyah, refuse mode with a quarter-hour wait, active tickets', async () => {
    const c = caller(['admin']);
    await c.call.ops.controls.setCapacity({ zoneKey: 'zakur', maxActive: 5 });
    expect(vi.mocked(c.controls.setCapacity).mock.calls[0]![1]).toEqual({ cityId: 'aziziyah', zoneKey: 'zakur', maxActive: 5, mode: 'refuse', etaMin: 15 });
    await c.call.support.list({});
    expect(vi.mocked(c.support.list).mock.calls[0]![1]).toEqual({ cityId: 'aziziyah', status: 'active', limit: 100 });
    await c.call.ops.controls.setSwitch({ scope: 'vertical', key: 'food', active: true, reason: 'مطر قوي' });
    expect(vi.mocked(c.controls.setSwitch).mock.calls[0]![0]).toEqual({ personId: 'p_staff', sessionId: 's1' });
  });
});
