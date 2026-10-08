import { describe, expect, it } from 'vitest';
import { InboxDoneInput, InboxListInput, type Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { InMemoryInboxRepository } from './inbox.repository.js';
import { INBOX_END_EVENTS, INBOX_START_EVENTS, InboxService } from './inbox.service.js';

const ALI: Actor = { personId: 'p_ali', sessionId: 's-a' };
const SARA: Actor = { personId: 'p_sara', sessionId: 's-s' };
const NAMES: Record<string, string> = { p_ali: 'علي', p_sara: 'سارة', p_haider: 'حيدر' };
const STAFF = [
  { personId: 'p_ali', roles: ['admin'], frozen: false },
  { personId: 'p_sara', roles: ['support'], frozen: false },
  { personId: 'p_haider', roles: ['dispatcher'], frozen: false },
  { personId: 'p_frozen', roles: ['dispatcher'], frozen: true },
];
const T0 = '2026-10-09T18:00:00Z'; // 21:00 in Aziziyah

function harness() {
  const clock = new FakeClock(T0);
  const ev = createInMemoryEvents({ clock });
  const identity = {
    rosterEntry: async (personId: string, kinds: readonly string[]) =>
      STAFF.find((r) => r.personId === personId && r.roles.some((k) => kinds.includes(k))) ?? null,
    firstNamesFor: async (ids: readonly string[]) =>
      Object.fromEntries(ids.map((id) => [id, NAMES[id] ?? null])),
  } as unknown as IdentityService;
  const controls = new InMemoryControlsRepository();
  const names = new StaffNames(identity, clock);
  const audits = new AuditLogService(controls, names, clock);
  const repo = new InMemoryInboxRepository();
  const svc = new InboxService(
    repo,
    { defaultCityId: 'aziziyah' },
    ev.events,
    audits,
    names,
    identity,
    ev.uow,
    clock,
  );
  svc.onModuleInit();
  let n = 0;
  const emit = (
    type: string,
    env: { orderId?: string; tripId?: string; actorId?: string; aggregateId?: string } = {},
    payload: Record<string, unknown> = {},
  ) =>
    ev.events.emit(
      undefined,
      {
        type,
        actorId: env.actorId ?? 'system',
        occurredAt: clock.now(),
        idempotencyKey: `t:${(n += 1)}`,
        ...(env.orderId ? { orderId: env.orderId } : {}),
        ...(env.tripId ? { tripId: env.tripId } : {}),
        payload,
      },
      { name: 'test', id: env.aggregateId ?? env.orderId ?? env.tripId ?? 'x' },
    );
  const later = (sec: number) => clock.set(new Date(clock.now().getTime() + sec * 1000));
  const list = (view: 'open' | 'mine' | 'snoozed' | 'done' = 'open', actor = ALI) =>
    svc.list(actor, InboxListInput.parse({ cityId: 'aziziyah', view }));
  return { svc, repo, clock, controls, emit, later, list };
}

describe('InboxService — the Today list (CON-12)', () => {
  it('opens exactly one row per trigger kind, most urgent first', async () => {
    const h = harness();
    await h.emit('order.late_apology', { orderId: 'ord_late' }, { customerId: 'p_c' });
    await h.emit(
      'order.merchant_unresponsive',
      { orderId: 'ord_shop' },
      { merchantOrgId: 'org_k' },
    );
    await h.emit(
      'dispatch.needs_dispatcher',
      { tripId: 'trp_1' },
      { cityId: 'aziziyah', vertical: 'taxi', reason: 'no_acceptance' },
    );
    await h.emit(
      'trip.unreachable_started',
      { tripId: 'trp_2', orderId: 'ord_door' },
      { stopId: 's' },
    );
    await h.emit(
      'khat.sweep_missed',
      { tripId: 'trp_k' },
      { alertId: 'kswp_1', tripId: 'trp_k', driverId: 'p_d', cityId: 'aziziyah' },
    );
    await h.emit(
      'seat.pin_alert',
      { actorId: 'p_d', aggregateId: 'dep_1' },
      { cityId: 'aziziyah', alert: 'wrong_pin', attemptId: 'att_1' },
    );
    await h.emit(
      'driver.document_submitted',
      { actorId: 'p_d' },
      { documentId: 'doc_1', kind: 'photo' },
    );
    await h.emit(
      'merchant.onboarding_drafted',
      {},
      { onboardingId: 'onb_1', merchantOrgId: 'org_n', cityId: 'aziziyah', type: 'restaurant' },
    );
    await h.emit(
      'sos.raised',
      { actorId: 'p_rider' },
      { incidentId: 'sos_1', cityId: 'aziziyah', role: 'customer', subjectKind: 'order' },
    );
    // A second late apology for the same order (an at-least-once replay) adds nothing.
    await h.emit('order.late_apology', { orderId: 'ord_late' }, { customerId: 'p_c' });

    const rows = await h.list();
    expect(rows.map((r) => r.kind)).toEqual([
      'sos',
      'sweep',
      'pin_alert',
      'no_driver',
      'unreachable',
      'store_silent',
      'late',
      'approval',
      'approval',
    ]);
    expect(rows.find((r) => r.kind === 'no_driver')).toMatchObject({
      subjectKind: 'trip',
      subjectId: 'trp_1',
      facts: { reason: 'no_acceptance', vertical: 'taxi' },
    });
    expect(rows.find((r) => r.kind === 'pin_alert')).toMatchObject({
      facts: { alert: 'wrong_pin', departureId: 'dep_1', driverId: 'p_d' },
    });
    expect(rows.every((r) => r.state === 'open' && r.assigneeId === null && r.times === 1)).toBe(
      true,
    );
    const counts = await h.svc.counts(ALI, { cityId: 'aziziyah' });
    expect(counts).toMatchObject({
      open: 9,
      unassigned: 9,
      mine: 0,
      doneToday: 0,
      byKind: { approval: 2, sos: 1, late: 1 },
    });
    expect(counts.oldestOpenAt).toEqual(new Date(T0));
  });

  it('a booked ride whose request was lost (lane B durable timers) opens a no-driver row', async () => {
    const h = harness();
    await h.emit(
      'dispatch.needs_dispatcher',
      { tripId: 'trp_lost' },
      { cityId: 'aziziyah', vertical: 'taxi', reason: 'request_lost', timer: 'booked_open', orderId: 'ord_ride' },
    );
    const [row] = await h.list();
    expect(row).toMatchObject({
      kind: 'no_driver',
      subjectId: 'trp_lost',
      orderId: 'ord_ride',
      facts: { reason: 'request_lost', vertical: 'taxi' },
    });
    await h.emit('dispatch.assigned', { tripId: 'trp_lost' }, { cityId: 'aziziyah' });
    expect(await h.list()).toEqual([]);
  });

  it('closes rows by themselves when the problem ends, and only the right ones', async () => {
    const h = harness();
    await h.emit('order.late_apology', { orderId: 'ord_1' });
    await h.emit('order.merchant_unresponsive', { orderId: 'ord_1' });
    await h.emit(
      'dispatch.needs_dispatcher',
      { tripId: 'trp_1', orderId: 'ord_1' },
      { cityId: 'aziziyah', reason: 'no_acceptance' },
    );
    await h.emit(
      'dispatch.needs_dispatcher',
      { tripId: 'trp_2' },
      { cityId: 'aziziyah', reason: 'passes_exhausted' },
    );
    await h.emit(
      'driver.document_submitted',
      { actorId: 'p_d' },
      { documentId: 'doc_1', kind: 'photo' },
    );
    h.later(60);
    await h.emit('order.ready', { orderId: 'ord_1' });
    expect((await h.list()).map((r) => r.kind).sort()).toEqual([
      'approval',
      'late',
      'no_driver',
      'no_driver',
    ]);
    await h.emit('dispatch.assigned', { tripId: 'trp_2' }, { cityId: 'aziziyah' });
    await h.emit('order.delivered', { orderId: 'ord_1' });
    await h.emit(
      'driver.document_reviewed',
      { actorId: 'p_ali' },
      { documentId: 'doc_1', decision: 'approved' },
    );
    expect(await h.list()).toEqual([]);
    const done = await h.list('done');
    expect(done).toHaveLength(5);
    expect(done.every((r) => r.outcome === 'auto' && r.doneById === null)).toBe(true);
    expect((await h.svc.counts(ALI, { cityId: 'aziziyah' })).doneToday).toBe(5);
  });

  it('brings a closed problem back when it happens again, and a replay never reopens it', async () => {
    const h = harness();
    await h.emit(
      'dispatch.needs_dispatcher',
      { tripId: 'trp_1' },
      { cityId: 'aziziyah', reason: 'no_acceptance' },
    );
    const [row] = await h.list();
    await h.svc.take(SARA, { id: row!.id });
    h.later(30);
    await h.emit('trip.accepted', { tripId: 'trp_1' });
    expect(await h.list()).toEqual([]);
    h.later(120);
    await h.emit(
      'dispatch.needs_dispatcher',
      { tripId: 'trp_1' },
      { cityId: 'aziziyah', reason: 'override_declined' },
    );
    const [back] = await h.list();
    expect(back).toMatchObject({
      id: row!.id,
      times: 2,
      assigneeId: null,
      outcome: null,
      facts: { reason: 'override_declined' },
    });
    // An old event delivered late (before the last close) changes nothing.
    await h.repo.updateOpen(back!.id, {
      doneAt: h.clock.now(),
      outcome: 'fixed',
      doneById: 'p_ali',
    });
    await h.repo.sight({
      cityId: 'aziziyah',
      kind: 'no_driver',
      subjectKind: 'trip',
      subjectId: 'trp_1',
      orderId: null,
      tripId: 'trp_1',
      facts: {},
      at: new Date(T0),
    });
    expect(await h.list()).toEqual([]);
  });

  it('take, hand over, snooze, note and close: each audited, nothing closes without an outcome', async () => {
    const h = harness();
    await h.emit('order.late_apology', { orderId: 'ord_1' });
    const [row] = await h.list();
    const taken = await h.svc.take(SARA, { id: row!.id });
    expect(taken).toMatchObject({ assigneeId: 'p_sara', assigneeName: 'سارة', mine: true });
    expect(await h.list('mine', SARA)).toHaveLength(1);
    expect((await h.svc.counts(SARA, { cityId: 'aziziyah' })).mine).toBe(1);

    await h.svc.assign(SARA, { id: row!.id, personId: 'p_haider' });
    await expect(h.svc.assign(SARA, { id: row!.id, personId: 'p_frozen' })).rejects.toMatchObject({
      code: 'inbox_not_staff',
    });
    await expect(h.svc.assign(SARA, { id: row!.id, personId: 'p_customer' })).rejects.toMatchObject(
      { code: 'inbox_not_staff' },
    );

    await h.svc.snooze(SARA, { id: row!.id, minutes: 15 });
    expect(await h.list()).toEqual([]);
    expect(await h.list('snoozed')).toHaveLength(1);
    h.later(15 * 60);
    expect((await h.list())[0]).toMatchObject({ state: 'open', assigneeId: 'p_haider' });

    await h.svc.note(SARA, { id: row!.id, note: 'اتصلت بالمطعم، يطلع بعد 5 دقايق' });
    expect(() => InboxDoneInput.parse({ id: row!.id, outcome: 'auto' })).toThrow();
    const closed = await h.svc.done(ALI, InboxDoneInput.parse({ id: row!.id, outcome: 'called' }));
    expect(closed).toMatchObject({
      state: 'done',
      outcome: 'called',
      doneById: 'p_ali',
      doneByName: 'علي',
      note: 'اتصلت بالمطعم، يطلع بعد 5 دقايق',
    });
    await expect(h.svc.take(SARA, { id: row!.id })).rejects.toMatchObject({ code: 'inbox_done' });
    await expect(h.svc.take(SARA, { id: 'inb_nope' })).rejects.toMatchObject({
      code: 'inbox_not_found',
    });

    const audit = await h.controls.audit({ limit: 20 });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'inbox.assign',
      'inbox.done',
      'inbox.note',
      'inbox.snooze',
      'inbox.take',
    ]);
    expect(audit.every((a) => a.subjectKind === 'inbox_item' && a.subjectId === row!.id)).toBe(
      true,
    );
    // The note's words stay on the row, never in the audit detail.
    expect(JSON.stringify(audit.map((a) => a.detail))).not.toContain('اتصلت');
  });

  it('an SOS row is taken when the SOS is taken, and closes only on the SOS desk', async () => {
    const h = harness();
    await h.emit(
      'sos.raised',
      { actorId: 'p_rider' },
      { incidentId: 'sos_1', cityId: 'aziziyah', role: 'driver' },
    );
    const [row] = await h.list();
    await expect(
      h.svc.done(ALI, InboxDoneInput.parse({ id: row!.id, outcome: 'fixed' })),
    ).rejects.toMatchObject({ code: 'inbox_close_at_source' });
    await h.emit(
      'sos.acknowledged',
      { actorId: 'p_haider' },
      { incidentId: 'sos_1', cityId: 'aziziyah' },
    );
    expect((await h.list())[0]).toMatchObject({ assigneeId: 'p_haider', assigneeName: 'حيدر' });
    await h.emit(
      'sos.resolved',
      { actorId: 'p_haider' },
      { incidentId: 'sos_1', cityId: 'aziziyah', outcome: 'safe' },
    );
    expect(await h.list()).toEqual([]);
  });

  it('keeps the event lists apart and in step with the handlers', () => {
    expect(
      INBOX_START_EVENTS.filter((t) => (INBOX_END_EVENTS as readonly string[]).includes(t)),
    ).toEqual([]);
  });
});
