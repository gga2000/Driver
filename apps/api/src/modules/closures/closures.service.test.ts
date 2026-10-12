import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { CLOSURE_REPORT_RULES, DriverError, haversineM, ReportClosureInput, type Actor, type AppContext, type LatLng, type RoleKind } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { FakeClock } from '../../shared/clock.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { ClosureAwareRouter, EtaService, RouteClosures, StraightLineRouter } from '../routing/index.js';
import { InMemoryClosuresRepository } from './closures.repository.js';
import { ClosuresService, type CourierWayPort } from './closures.service.js';

const OPS: Actor = { personId: 'p_ops', sessionId: 's_ops' };
const HAIDER: Actor = { personId: 'p_haider', sessionId: 's_h' };
const ALI: Actor = { personId: 'p_ali_c', sessionId: 's_a' };
const CITY = 'aziziyah';

const A: LatLng = { lat: 32.905, lng: 45.06 };
const M_LAT = 111_195;
const M_LNG = M_LAT * Math.cos((A.lat * Math.PI) / 180);
/** About `n` metres north and `e` metres east of A. */
const at = (n: number, e = 0): LatLng => ({ lat: A.lat + n / M_LAT, lng: A.lng + e / M_LNG });
/** Metres north of A. */
const northOf = (p: LatLng) => (p.lat - A.lat) * M_LAT;

/** 12:00 in Baghdad; that night's midnight is 21:00 UTC. */
const NOON = '2026-10-12T09:00:00Z';
const MIDNIGHT = new Date('2026-10-12T21:00:00Z');

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (err instanceof DriverError) return err.code;
    if (err instanceof TRPCError) return err.code;
    return String(err);
  }
};

function harness() {
  const clock = new FakeClock(NOON);
  const ev = createInMemoryEvents({ clock });
  const auditRepo = new InMemoryControlsRepository();
  const identity = { firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, ({ p_ops: 'زينب', p_haider: 'حيدر', p_ali_c: 'علي' } as Record<string, string>)[id] ?? null])) } as unknown as IdentityService;
  const names = new StaffNames(identity, clock);
  const audits = new AuditLogService(auditRepo, names, clock);
  const repo = new InMemoryClosuresRepository();
  const book = new RouteClosures();
  const eta = new EtaService(new ClosureAwareRouter(new StraightLineRouter(), book, clock));
  /** Each courier's job road: where he is and the stops ahead (null = off a job). */
  const ways = new Map<string, { from: LatLng; ahead: LatLng[] } | null>();
  const wayCalls: string[] = [];
  const way: CourierWayPort = {
    jobWay: async (personId) => {
      wayCalls.push(personId);
      return ways.get(personId) ?? null;
    },
  };
  const svc = new ClosuresService(repo, book, eta, audits, names, ev.events, ev.uow, clock, way);
  /** A job heading north from `e` metres east of A, 1 km to the door. */
  const onJob = (actor: Actor, e = 0, n = 0) => ways.set(actor.personId, { from: at(n, e), ahead: [at(n + 1_000, e)] });
  const eventsOf = async (id: string) => (await ev.events.forAggregate('street_closure', id)).map((e) => ({ type: e.type, payload: e.payload as Record<string, unknown> }));
  return { clock, ev, auditRepo, repo, book, eta, ways, wayCalls, svc, onJob, eventsOf };
}

/** A 200 m stretch of street east of A, the one ops close in these tests. */
const STREET = [at(400, 300), at(500, 300), at(600, 300)];

describe('ClosuresService: ops close and open (N20)', () => {
  it('ops close a street: live until midnight, routed around, audited and evented', async () => {
    const h = harness();
    const v = await h.svc.close(OPS, { cityId: CITY, path: STREET, reason: 'works', nameAr: '  شارع المستشفى ' });
    expect(v).toMatchObject({ cityId: CITY, reason: 'works', nameAr: 'شارع المستشفى', source: 'ops', confirmed: true, active: true, closedByName: 'زينب', openedAt: null, endsAt: MIDNIGHT });
    expect(v.lengthM).toBeGreaterThanOrEqual(199);
    expect(v.lengthM).toBeLessThanOrEqual(201);
    expect(h.book.active(h.clock.now()).map((c) => c.id)).toEqual([v.id]);
    expect(h.auditRepo.auditRows.map((a) => [a.action, a.subjectId, a.actorId])).toEqual([['closure.close', v.id, OPS.personId]]);
    expect((await h.eventsOf(v.id)).map((e) => e.type)).toEqual(['ops.street_closed']);
    expect(await h.svc.list({ cityId: CITY })).toHaveLength(1);
  });

  it('ops may pick an earlier hour, never past midnight and never under 5 minutes; too short or too long is refused', async () => {
    const h = harness();
    const until = new Date('2026-10-12T14:00:00Z');
    expect((await h.svc.close(OPS, { cityId: CITY, path: STREET, reason: 'funeral', nameAr: null, until })).endsAt).toEqual(until);
    expect(await code(h.svc.close(OPS, { cityId: CITY, path: STREET, reason: 'funeral', nameAr: null, until: new Date(MIDNIGHT.getTime() + 60_000) }))).toBe('invalid_input');
    expect(await code(h.svc.close(OPS, { cityId: CITY, path: STREET, reason: 'funeral', nameAr: null, until: new Date(h.clock.now().getTime() + 4 * 60_000) }))).toBe('invalid_input');
    expect(await code(h.svc.close(OPS, { cityId: CITY, path: [at(0, 300), at(10, 300)], reason: 'water', nameAr: null }))).toBe('invalid_input');
    expect(await code(h.svc.close(OPS, { cityId: CITY, path: [at(0, 300), at(3_100, 300)], reason: 'water', nameAr: null }))).toBe('invalid_input');
  });

  it('ops open it early: routes stop going around it; opening twice keeps the first, with one audit row', async () => {
    const h = harness();
    const v = await h.svc.close(OPS, { cityId: CITY, path: STREET, reason: 'water', nameAr: null });
    h.clock.advance(30 * 60_000);
    const opened = await h.svc.open(OPS, { id: v.id });
    expect(opened).toMatchObject({ active: false, openedAt: h.clock.now(), openedByName: 'زينب' });
    expect(h.book.active(h.clock.now())).toEqual([]);
    h.clock.advance(60_000);
    expect((await h.svc.open(HAIDER, { id: v.id })).openedByName).toBe('زينب');
    expect(h.auditRepo.auditRows.map((a) => a.action)).toEqual(['closure.close', 'closure.open']);
    expect((await h.eventsOf(v.id)).map((e) => e.type)).toEqual(['ops.street_closed', 'ops.street_opened']);
    expect(await code(h.svc.open(OPS, { id: 'cls_nope' }))).toBe('not_found');
  });
});

describe('ClosuresService: a courier reports «الشارع مسدود قدامي» (N20)', () => {
  it('takes the stretch 40–190 m ahead on his own job road, never a point from the app', async () => {
    const h = harness();
    h.onJob(HAIDER);
    // Whatever the app tries to send besides the city and why is dropped by the input schema.
    const input = ReportClosureInput.parse({ cityId: CITY, reason: 'works', path: [at(5_000, 5_000), at(5_100, 5_000)], at: at(5_000, 5_000) });
    expect(input).toEqual({ cityId: CITY, reason: 'works' });
    const r = await h.svc.report(HAIDER, input);
    expect(r.confirmed).toBe(false);
    expect(h.wayCalls).toEqual([HAIDER.personId]);
    const row = (await h.repo.get(r.id))!;
    expect(row).toMatchObject({ source: 'courier', closedById: HAIDER.personId, confirmedAt: null, reason: 'works' });
    // Sampled every 10 m along his road: it starts within a step past 40 m and ends within a step before 190 m.
    const from = northOf(row.path[0]!);
    const to = northOf(row.path.at(-1)!);
    expect(from).toBeGreaterThanOrEqual(CLOSURE_REPORT_RULES.aheadFromM - 1);
    expect(from).toBeLessThanOrEqual(CLOSURE_REPORT_RULES.aheadFromM + 11);
    expect(to).toBeLessThanOrEqual(CLOSURE_REPORT_RULES.aheadToM + 1);
    expect(to).toBeGreaterThanOrEqual(CLOSURE_REPORT_RULES.aheadToM - 11);
    for (const p of row.path) expect(Math.abs(p.lng - A.lng)).toBeLessThan(1e-9);
    expect(row.lengthM).toBe(Math.round(haversineM(row.path[0]!, row.path.at(-1)!)));
    expect(row.lengthM).toBeGreaterThanOrEqual(130);
    expect(row.lengthM).toBeLessThanOrEqual(150);
    // It waits for ops: nothing routes around it, and the Console shows it unconfirmed.
    expect(h.book.active(h.clock.now())).toEqual([]);
    expect((await h.svc.list({ cityId: CITY }))[0]).toMatchObject({ id: r.id, source: 'courier', confirmed: false, active: true, closedByName: 'حيدر' });
    expect((await h.eventsOf(r.id)).map((e) => e.type)).toEqual(['ops.street_reported']);
    expect(h.auditRepo.auditRows).toEqual([]);
  });

  it('an unconfirmed report bends no route; once ops confirm it, routes through it go around', async () => {
    const h = harness();
    h.onJob(HAIDER);
    const { id } = await h.svc.report(HAIDER, { cityId: CITY, reason: 'works' });
    // Another courier's road straight through the reported stretch.
    const through = [at(-500), at(1_000)];
    expect((await h.eta.path(through)).avoided).toBeUndefined();
    await h.svc.confirm(OPS, { id });
    expect((await h.eta.path(through)).avoided?.map((a) => a.id)).toEqual([id]);
  });

  it('an unconfirmed report drops after 2 hours', async () => {
    const h = harness();
    h.onJob(HAIDER);
    const { id } = await h.svc.report(HAIDER, { cityId: CITY, reason: 'other' });
    expect((await h.repo.get(id))!.endsAt).toEqual(new Date(h.clock.now().getTime() + CLOSURE_REPORT_RULES.reportLiveMs));
    h.clock.advance(CLOSURE_REPORT_RULES.reportLiveMs + 60_000);
    expect(await h.repo.waiting(CITY, h.clock.now())).toEqual([]);
    expect((await h.svc.list({ cityId: CITY }))[0]).toMatchObject({ id, active: false, confirmed: false });
    // Too late to confirm.
    expect(await code(h.svc.confirm(OPS, { id }))).toBe('invalid_input');
  });

  it('a report late in the evening drops at midnight, not 2 hours on', async () => {
    const h = harness();
    h.clock.set('2026-10-12T20:00:00Z'); // 23:00 in Baghdad
    h.onJob(HAIDER);
    const { id } = await h.svc.report(HAIDER, { cityId: CITY, reason: 'other' });
    expect((await h.repo.get(id))!.endsAt).toEqual(MIDNIGHT);
  });

  it('the same street again within the hour returns the same report; after the hour it is a new one', async () => {
    const h = harness();
    h.onJob(HAIDER);
    const first = await h.svc.report(HAIDER, { cityId: CITY, reason: 'works' });
    h.clock.advance(20 * 60_000);
    h.onJob(HAIDER, 10, 5); // a few metres on, same street
    expect(await h.svc.report(HAIDER, { cityId: CITY, reason: 'water' })).toEqual(first);
    expect((await h.svc.list({ cityId: CITY })).length).toBe(1);
    h.clock.advance(CLOSURE_REPORT_RULES.againMs);
    const again = await h.svc.report(HAIDER, { cityId: CITY, reason: 'works' });
    expect(again.id).not.toBe(first.id);
    expect(again.confirmed).toBe(false);
  });

  it('5 reports a day per courier; the 6th is refused, and a new day starts again', async () => {
    const h = harness();
    for (let i = 0; i < CLOSURE_REPORT_RULES.perDay; i++) {
      h.onJob(HAIDER, i * 500);
      expect((await h.svc.report(HAIDER, { cityId: CITY, reason: 'works' })).confirmed).toBe(false);
    }
    h.onJob(HAIDER, 5 * 500);
    expect(await code(h.svc.report(HAIDER, { cityId: CITY, reason: 'works' }))).toBe('rate_limited');
    // The same street as one of today's within the hour is still answered (not counted again).
    h.onJob(HAIDER, 0);
    expect(await code(h.svc.report(HAIDER, { cityId: CITY, reason: 'works' }))).toBe('ok');
    // Tomorrow (Baghdad): five more.
    h.clock.set('2026-10-13T05:00:00Z');
    h.onJob(HAIDER, 5 * 500);
    expect(await code(h.svc.report(HAIDER, { cityId: CITY, reason: 'works' }))).toBe('ok');
  });

  it('a second courier reporting the same street within 40 m confirms it: routed around until midnight', async () => {
    const h = harness();
    h.onJob(HAIDER);
    const first = await h.svc.report(HAIDER, { cityId: CITY, reason: 'works' });
    h.clock.advance(10 * 60_000);
    // Ali's road runs 25 m beside Haider's: the same street.
    h.onJob(ALI, 25);
    expect(await h.svc.report(ALI, { cityId: CITY, reason: 'water' })).toEqual({ id: first.id, confirmed: true });
    const row = (await h.repo.get(first.id))!;
    expect(row).toMatchObject({ confirmedById: ALI.personId, confirmedAt: h.clock.now(), endsAt: MIDNIGHT });
    expect(h.book.active(h.clock.now()).map((c) => c.id)).toEqual([first.id]);
    expect(h.auditRepo.auditRows.map((a) => [a.action, a.actorId, (a.detail as { how?: string }).how])).toEqual([['closure.confirm', ALI.personId, 'second_report']]);
    const evs = await h.eventsOf(first.id);
    expect(evs.map((e) => e.type)).toEqual(['ops.street_reported', 'ops.street_closed']);
    expect(evs[1]!.payload).toMatchObject({ how: 'second_report', source: 'courier', endsAt: MIDNIGHT.toISOString() });
  });

  it('a courier 60 m away is another street: a second report, both waiting', async () => {
    const h = harness();
    h.onJob(HAIDER);
    const first = await h.svc.report(HAIDER, { cityId: CITY, reason: 'works' });
    h.onJob(ALI, 60);
    const second = await h.svc.report(ALI, { cityId: CITY, reason: 'works' });
    expect(second.id).not.toBe(first.id);
    expect(second.confirmed).toBe(false);
    expect((await h.repo.waiting(CITY, h.clock.now())).map((c) => c.id).sort()).toEqual([first.id, second.id].sort());
    expect(h.book.active(h.clock.now())).toEqual([]);
  });

  it('ops confirm a report: until that night’s midnight (Baghdad), with an audit row and ops.street_closed', async () => {
    const h = harness();
    h.onJob(HAIDER);
    const { id } = await h.svc.report(HAIDER, { cityId: CITY, reason: 'funeral' });
    h.clock.advance(15 * 60_000);
    const v = await h.svc.confirm(OPS, { id });
    expect(v).toMatchObject({ id, source: 'courier', confirmed: true, active: true, endsAt: MIDNIGHT, confirmedByName: 'زينب', closedByName: 'حيدر' });
    expect(h.book.active(h.clock.now()).map((c) => c.id)).toEqual([id]);
    expect(h.auditRepo.auditRows.map((a) => [a.action, a.actorId, a.subjectKind, a.subjectId, (a.detail as { how?: string }).how])).toEqual([['closure.confirm', OPS.personId, 'closure', id, 'ops']]);
    const evs = await h.eventsOf(id);
    expect(evs.map((e) => e.type)).toEqual(['ops.street_reported', 'ops.street_closed']);
    expect(evs[1]!.payload).toMatchObject({ cityId: CITY, closureId: id, how: 'ops', endsAt: MIDNIGHT.toISOString() });
    // Confirming again changes nothing and writes nothing.
    expect((await h.svc.confirm(OPS, { id })).confirmedByName).toBe('زينب');
    expect(h.auditRepo.auditRows).toHaveLength(1);
    expect(await h.eventsOf(id)).toHaveLength(2);
  });

  it('only a waiting courier report can be confirmed', async () => {
    const h = harness();
    const ops = await h.svc.close(OPS, { cityId: CITY, path: STREET, reason: 'works', nameAr: null });
    expect(await code(h.svc.confirm(OPS, { id: ops.id }))).toBe('invalid_input');
    expect(await code(h.svc.confirm(OPS, { id: 'cls_nope' }))).toBe('not_found');
    h.onJob(HAIDER);
    const { id } = await h.svc.report(HAIDER, { cityId: CITY, reason: 'works' });
    await h.svc.open(OPS, { id });
    expect(await code(h.svc.confirm(OPS, { id }))).toBe('invalid_input');
  });

  it('off a job there is no road to report on (trip_not_found → «no road» in the app); at the door, nothing ahead', async () => {
    const h = harness();
    expect(await code(h.svc.report(HAIDER, { cityId: CITY, reason: 'works' }))).toBe('trip_not_found');
    h.ways.set(HAIDER.personId, { from: A, ahead: [at(30)] });
    expect(await code(h.svc.report(HAIDER, { cityId: CITY, reason: 'works' }))).toBe('invalid_input');
    expect(await h.repo.reportsBy(HAIDER.personId, new Date(0))).toEqual([]);
    // Without the partner port wired at all: the same answer.
    const bare = new ClosuresService(h.repo, h.book, h.eta, new AuditLogService(h.auditRepo, new StaffNames({ firstNamesFor: async () => ({}) } as unknown as IdentityService, h.clock), h.clock), new StaffNames({ firstNamesFor: async () => ({}) } as unknown as IdentityService, h.clock), h.ev.events, h.ev.uow, h.clock, null);
    expect(await code(bare.report(HAIDER, { cityId: CITY, reason: 'works' }))).toBe('trip_not_found');
  });

  it('the stretch is measured along the road the router gives, not a straight line to the door', async () => {
    const h = harness();
    // The job's road turns east after 100 m: the reported stretch follows the turn.
    h.ways.set(HAIDER.personId, { from: A, ahead: [at(100), at(100, 1_000)] });
    const { id } = await h.svc.report(HAIDER, { cityId: CITY, reason: 'works' });
    const row = (await h.repo.get(id))!;
    expect(haversineM(row.path.at(-1)!, at(100, 90))).toBeLessThan(15);
  });
});

describe('closures over the shared router: who may call what (N20)', () => {
  function as(svc: ClosuresService, personId: string, roles: readonly RoleKind[]) {
    const ctx = {
      auth: { sub: personId, sid: `s_${personId}`, iss: 'driver-api', iat: 0, exp: 0 },
      authError: null,
      identity: { hasRole: async (_: string, kind: RoleKind) => roles.includes(kind) },
      closures: svc,
    } as unknown as AppContext;
    return t.createCallerFactory(appRouter)(ctx);
  }

  it('only driving partner roles report; a customer, merchant or fleet owner is refused', async () => {
    const h = harness();
    h.onJob(HAIDER);
    for (const roles of [['customer'], ['merchant_owner'], ['fleet_owner'], ['support']] as RoleKind[][]) {
      expect(await code(as(h.svc, HAIDER.personId, roles).closures.report({ cityId: CITY, reason: 'works' }))).toBe('FORBIDDEN');
    }
    expect(h.wayCalls).toEqual([]);
    expect(await as(h.svc, HAIDER.personId, ['courier']).closures.report({ cityId: CITY, reason: 'works' })).toMatchObject({ confirmed: false });
  });

  it('only ops confirm, and the views pass the router’s output schemas', async () => {
    const h = harness();
    h.onJob(HAIDER);
    const { id } = await as(h.svc, HAIDER.personId, ['courier']).closures.report({ cityId: CITY, reason: 'works' });
    expect(await code(as(h.svc, HAIDER.personId, ['courier']).ops.closures.confirm({ id }))).toBe('FORBIDDEN');
    expect(await code(as(h.svc, 'p_sup', ['support']).ops.closures.confirm({ id }))).toBe('FORBIDDEN');
    expect(await as(h.svc, OPS.personId, ['field_ops']).ops.closures.confirm({ id })).toMatchObject({ id, confirmed: true });
    expect(await as(h.svc, 'p_sup', ['support']).ops.closures.list({ cityId: CITY })).toHaveLength(1);
  });
});
