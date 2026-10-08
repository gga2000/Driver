import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appRouter } from '@driver/contracts/router';
import { SAFETY_RULES, type Actor, type AppContext, type LiveBusEvent, type Order, type SessionClaims, type Trip } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { DevSmsProvider } from '../../shared/messaging/sms.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import type { LiveBus } from '../live/index.js';
import { NotifyEngine, type NotifyJob } from '../notify/notify.engine.js';
import { InMemoryNotifyRepository } from '../notify/notify.repository.js';
import { emergencyContactOwner, NotifyService } from '../notify/notify.service.js';
import { DevPushProvider } from '../notify/providers/push.js';
import { DevWhatsAppProvider } from '../notify/providers/whatsapp.js';
import { InMemorySafetyRepository } from './safety.repository.js';
import type { OnCallPort } from './on-call.js';
import { SafetyService } from './safety.service.js';
import type { SafetySources } from './safety.subjects.js';

const RIDER: Actor = { personId: 'p_rider', sessionId: 's-rider' };
const DRIVER: Actor = { personId: 'p_driver', sessionId: 's-driver' };
const STRANGER: Actor = { personId: 'p_stranger', sessionId: 's-x' };
const HAIDER: Actor = { personId: 'p_haider', sessionId: 's-h' };
const ALI: Actor = { personId: 'p_ali', sessionId: 's-a' };
const POS = { lat: 32.9095, lng: 45.0635, accuracyM: 12, at: new Date('2026-10-05T17:59:58Z') };
const NAMES: Record<string, string> = { p_rider: 'زينب علي', p_driver: 'حيدر كاظم', p_haider: 'حيدر جاسم', p_ali: 'علي أحمد' };
const PHONES: Record<string, string> = { p_rider: '+9647702223344', p_driver: '+9647701110002', p_haider: '+9647700000002', p_ali: '+9647700000001' };

function harness(opts: { contact?: boolean; driverContact?: boolean; onCall?: OnCallPort | null } = {}) {
  const clock = new FakeClock('2026-10-05T18:00:00Z');
  const ev = createInMemoryEvents({ clock });
  const vault: string[] = [];
  const contact = opts.contact === false ? null : { name: 'أم زينب', phoneE164: '+9647809990000' };
  const identity = {
    emergencyContactOf: async (personId: string, accessorId: string, purpose: string) => {
      vault.push(`${personId}:emergency_contact:${accessorId}:${purpose}`);
      if (personId === 'p_driver') return opts.driverContact ? { name: 'أم حيدر', phoneE164: '+9647805550000' } : null;
      return personId === 'p_rider' ? contact : null;
    },
    firstNamesFor: async (ids: readonly string[], accessorId: string, purpose: string) => {
      for (const id of ids) vault.push(`${id}:name:${accessorId}:${purpose}`);
      return Object.fromEntries(ids.map((id) => [id, NAMES[id]?.split(' ')[0] ?? null]));
    },
    displayNamesFor: async (ids: readonly string[], accessorId: string, purpose: string) => {
      for (const id of ids) vault.push(`${id}:name:${accessorId}:${purpose}`);
      return Object.fromEntries(ids.map((id) => [id, { displayName: NAMES[id] ? `${NAMES[id]!.split(' ')[0]} ${NAMES[id]!.split(' ')[1]![0]}.` : null, deleted: false }]));
    },
    memberCards: async (ids: readonly string[], accessorId: string, purpose: string) => {
      for (const id of ids) vault.push(`${id}:card:${accessorId}:${purpose}`);
      return Object.fromEntries(ids.map((id) => [id, { name: NAMES[id] ?? null, phoneMasked: '0770 ••• 0000' }]));
    },
    roster: async (q: { kinds: readonly string[] }) => {
      const rows = [
        { personId: 'p_haider', roles: ['dispatcher'], frozen: false },
        { personId: 'p_ali', roles: ['admin'], frozen: false },
        { personId: 'p_frozen', roles: ['dispatcher'], frozen: true },
      ].filter((r) => r.roles.some((k) => q.kinds.includes(k)));
      return { rows, nextCursor: null, total: rows.length };
    },
  } as unknown as IdentityService;

  // Notify on in-memory everything; the emergency contact resolves through `ec:<personId>`.
  const nrepo = new InMemoryNotifyRepository();
  const queue = new InMemoryQueue<NotifyJob>('notify', () => clock.now());
  const whatsapp = new DevWhatsAppProvider(false);
  const sms = new DevSmsProvider(false);
  const contacts = {
    contact: async (to: string, o: { phone: boolean; purpose: string }) => {
      const owner = emergencyContactOwner(to);
      if (owner) return { locale: 'ar-IQ' as const, phoneE164: o.phone ? ((await identity.emergencyContactOf(owner, 'system:notify', o.purpose))?.phoneE164 ?? null) : null };
      return { locale: 'ar-IQ' as const, phoneE164: o.phone ? (PHONES[to] ?? null) : null };
    },
  };
  const engine = new NotifyEngine(nrepo, { push: { expo: new DevPushProvider(false), fcm: new DevPushProvider(false) }, sms, whatsapp }, contacts, queue, clock, { retryBaseMs: 1000, maxAttempts: 3, receiptDelaySec: 60 });
  queue.process((job) => engine.process(job.data));
  const notify = new NotifyService(undefined, engine, nrepo, clock);

  const published: Array<{ channel: string; event: LiveBusEvent }> = [];
  const bus = { publish: async (channel: string, event: LiveBusEvent) => void published.push({ channel, event }) } as unknown as LiveBus;
  const controls = new InMemoryControlsRepository();
  const staff = new StaffNames(identity, clock);
  const calls: Array<{ calleeId: string; callerId: string }> = [];

  const order: Pick<Order, 'id' | 'cityId' | 'type' | 'state' | 'ordererId' | 'deliveredAt' | 'closedAt' | 'cancelledAt'> = {
    id: 'ord_ride_1',
    cityId: 'aziziyah',
    type: 'ride',
    state: 'matched',
    ordererId: RIDER.personId,
    deliveredAt: null,
    closedAt: null,
    cancelledAt: null,
  };
  const trip: Pick<Trip, 'id' | 'cityId' | 'vertical' | 'state' | 'courierId' | 'vehicleId' | 'completedAt' | 'cancelledAt' | 'stops'> = {
    id: 'trp_1',
    cityId: 'aziziyah',
    vertical: 'tuktuk',
    state: 'in_transit',
    courierId: DRIVER.personId,
    vehicleId: null,
    completedAt: null,
    cancelledAt: null,
    stops: [{ orderId: order.id } as Trip['stops'][number]],
  };
  const sources: SafetySources = {
    order: async (id) => (id === order.id ? { ...order } : null),
    courierOf: async (id) => (id === order.id ? { tripId: trip.id, courierId: DRIVER.personId } : null),
    trip: async (id) => (id === trip.id ? { ...trip } : null),
    departure: async () => null,
    riders: async () => [],
    booking: async () => null,
    request: async () => null,
    vehicle: async () => ({ plate: '12345 واسط', label: 'تكتك باجاج' }),
    tripFix: async (id) => (id === trip.id ? { lat: 32.8995, lng: 45.0702, at: new Date('2026-10-05T17:59:50Z') } : null),
  };
  const svc = new SafetyService(
    new InMemorySafetyRepository(),
    sources,
    {
      open: async (req, now) => {
        calls.push({ calleeId: req.calleeId, callerId: req.callerId });
        return { mode: 'proxy', dial: '+9647800000000', expiresAt: new Date(now.getTime() + 120_000) };
      },
    },
    { secret: 'test-secret', linkBase: 'https://driver.iq/sos/', consoleBase: 'https://console.driver.iq', timers: false, sweepMs: 0 },
    bus,
    identity,
    notify,
    ev.events,
    new AuditLogService(controls, staff, clock),
    staff,
    ev.uow,
    clock,
    opts.onCall ?? null,
  );
  svc.onModuleInit();
  const raise = (actor: Actor = RIDER, clientId = 'press-0001', subject = { kind: 'order' as const, id: order.id }) => svc.sos(actor, { subject, position: POS, clientId, pressedAt: new Date('2026-10-05T17:59:59Z') });
  const deliveries = async (personId: string) => (await nrepo.log({ personId, limit: 50 })).reverse();
  const run = async (ms = 0) => {
    if (ms > 0) clock.advance(ms);
    await queue.drain();
  };
  return { svc, clock, ev, vault, published, controls, calls, order, trip, raise, deliveries, run, whatsapp, sms, notify };
}

describe('SafetyService — raising an SOS', () => {
  it('opens an incident, emits sos.raised, pages every live dispatcher and admin, and tells the Console', async () => {
    const h = harness();
    const view = await h.raise();
    expect(view).toMatchObject({ state: 'open', sharing: true, contactName: 'أم زينب', contactStatus: 'queued' });
    expect(view.cancelUntil.getTime() - view.raisedAt.getTime()).toBe(SAFETY_RULES.cancelWindowSec * 1000);
    expect((await h.ev.events.forAggregate('safety_incident', view.incidentId)).map((e) => e.type)).toEqual(['sos.raised', 'safety.incident_opened']);
    await h.run();
    const paged = [...(await h.deliveries('p_haider')), ...(await h.deliveries('p_ali'))];
    expect(paged.map((d) => [d.personId, d.template, d.channel])).toEqual([
      ['p_haider', 'sos_dispatch_alert', 'push'],
      ['p_haider', 'sos_dispatch_alert', 'whatsapp'],
      ['p_ali', 'sos_dispatch_alert', 'push'],
      ['p_ali', 'sos_dispatch_alert', 'whatsapp'],
    ]);
    expect(await h.deliveries('p_frozen')).toEqual([]);
    expect(h.published).toContainEqual({ channel: 'safety', event: { type: 'invalidate', keys: ['safety.open'], cause: 'sos.raised' } });
    const c = await h.svc.get(HAIDER, { id: view.incidentId });
    expect(c.timeline.map((e) => e.kind)).toEqual(['raised', 'paged']);
    expect(c.timeline[1]!.data).toEqual({ count: '2', source: 'fallback_all_dispatchers' });
    expect(c).toMatchObject({ raiser: { role: 'customer', displayName: 'زينب ع.' }, counterpart: { personId: 'p_driver', role: 'driver' }, subject: { label: 'مشوار تكتك #' + c.subject.label.split('#')[1], vehicle: 'تكتك باجاج · 12345 واسط' } });
    expect(c.lastPosition).toMatchObject({ lat: POS.lat, lng: POS.lng, accuracyM: 12, deviceAt: POS.at });
  });

  it('is idempotent: a retried press and a second hold return the same incident', async () => {
    const h = harness();
    const a = await h.raise(RIDER, 'press-0001');
    const b = await h.raise(RIDER, 'press-0001');
    const c = await h.raise(RIDER, 'press-0002');
    expect(new Set([a.incidentId, b.incidentId, c.incidentId]).size).toBe(1);
    expect((await h.svc.list(HAIDER, { scope: 'all', limit: 50 })).length).toBe(1);
    expect((await h.ev.events.forAggregate('safety_incident', a.incidentId)).filter((e) => e.type === 'sos.raised')).toHaveLength(1);
  });

  it('works for the driver of the same trip, by trip id; without GPS it starts from the car\'s last fix', async () => {
    const h = harness();
    const v = await h.svc.sos(DRIVER, { subject: { kind: 'trip', id: h.trip.id }, position: null, clientId: 'driver-press-1' });
    const c = await h.svc.get(HAIDER, { id: v.incidentId });
    expect(c).toMatchObject({ raiser: { role: 'driver', personId: 'p_driver' }, counterpart: { personId: 'p_rider', role: 'customer' }, lastPosition: { lat: 32.8995, lng: 45.0702, accuracyM: null }, contact: { set: false, status: 'none' } });
    expect(c.timeline.map((e) => e.kind)).toContain('contact');
  });

  it('refuses a stranger, an unknown trip and a trip that ended long ago', async () => {
    const h = harness();
    await expect(h.raise(STRANGER)).rejects.toMatchObject({ code: 'sos_not_party' });
    await expect(h.svc.sos(RIDER, { subject: { kind: 'trip', id: 'trp_nope' }, position: null, clientId: 'press-x-1' })).rejects.toMatchObject({ code: 'sos_not_party' });
    h.order.state = 'completed';
    h.order.deliveredAt = new Date(h.clock.now().getTime() - 31 * 60_000);
    await expect(h.raise()).rejects.toMatchObject({ code: 'sos_trip_over' });
    h.order.deliveredAt = new Date(h.clock.now().getTime() - 5 * 60_000);
    await expect(h.raise()).resolves.toMatchObject({ state: 'open' });
    h.order.state = 'customer_cancelled';
    await expect(h.raise(RIDER, 'press-after-cancel')).resolves.toBeDefined(); // joins the open one
  });

  it('never refuses an SOS: cancelled false alarms do not count toward the hourly limit (FLOW-08)', async () => {
    const h = harness();
    for (let i = 0; i < SAFETY_RULES.maxPerHour; i++) {
      const v = await h.raise(RIDER, `press-rl-${i}`);
      await h.svc.cancel(RIDER, { incidentId: v.incidentId });
    }
    const real = await h.raise(RIDER, 'press-rl-x');
    expect(real).toMatchObject({ state: 'open' });
    const kase = await h.svc.get(HAIDER, { id: real.incidentId });
    expect(kase.timeline.find((e) => e.kind === 'raised')?.data['repeated']).toBeUndefined();
  });

  it('past the hourly limit of real alerts, still opens the incident, flagged as possibly repeated', async () => {
    const h = harness();
    for (let i = 0; i < SAFETY_RULES.maxPerHour; i++) {
      const v = await h.raise(RIDER, `press-rr-${i}`);
      await h.svc.resolve(HAIDER, { id: v.incidentId, outcome: 'safe', note: 'اتصلنا، بخير' });
    }
    const v = await h.raise(RIDER, 'press-rr-x');
    expect(v).toMatchObject({ state: 'open' });
    const kase = await h.svc.get(HAIDER, { id: v.incidentId });
    expect(kase.timeline.find((e) => e.kind === 'raised')?.data['repeated']).toBe(String(SAFETY_RULES.maxPerHour));
    await h.svc.resolve(HAIDER, { id: v.incidentId, outcome: 'safe', note: 'اتصلنا، بخير' });
    h.clock.advance(61 * 60_000);
    const w = await h.raise(RIDER, 'press-rr-y');
    expect((await h.svc.get(HAIDER, { id: w.incidentId })).timeline.find((e) => e.kind === 'raised')?.data['repeated']).toBeUndefined();
  });
});

describe('SafetyService — cancel window, contact, positions, escalation', () => {
  it('cancels inside 10 s (logged, never erased); refuses after the window', async () => {
    const h = harness();
    const v = await h.raise();
    h.clock.advance(9_000);
    const c = await h.svc.cancel(RIDER, { incidentId: v.incidentId });
    expect(c).toMatchObject({ state: 'cancelled', sharing: false });
    expect(await h.svc.cancel(RIDER, { incidentId: v.incidentId })).toMatchObject({ state: 'cancelled' });
    const kase = await h.svc.get(HAIDER, { id: v.incidentId });
    expect(kase.timeline.map((e) => e.kind)).toEqual(['raised', 'paged', 'cancelled']);
    expect(kase.outcome).toBe('false_alarm');
    // The emergency contact is never told about a false alarm.
    h.clock.advance(5_000);
    expect(await h.svc.sweep()).toEqual({ contacts: 0, escalated: 0 });
    expect(h.whatsapp.sent ?? []).toHaveLength(0);

    const w = await h.raise(RIDER, 'press-late');
    h.clock.advance(SAFETY_RULES.cancelWindowSec * 1000 + 1);
    await expect(h.svc.cancel(RIDER, { incidentId: w.incidentId })).rejects.toMatchObject({ code: 'sos_cancel_window_passed' });
    await expect(h.svc.cancel(STRANGER, { incidentId: w.incidentId })).rejects.toMatchObject({ code: 'sos_not_found' });
  });

  it('messages the emergency contact once after the window, with a working live-location link, through notify', async () => {
    const h = harness();
    const v = await h.raise();
    expect(await h.svc.notifyContact(v.incidentId)).toBe(false); // still inside the cancel window
    h.clock.advance(10_001);
    const swept = await h.svc.sweep();
    expect(swept.contacts).toBe(1);
    expect(await h.svc.notifyContact(v.incidentId)).toBe(false); // once
    await h.run();
    const rows = await h.deliveries('ec:p_rider');
    expect(rows.map((r) => [r.template, r.channel, r.status])).toEqual([['sos_emergency_contact', 'whatsapp', 'delivered']]);
    const link = rows[0]!.payload.body!.match(/https:\/\/driver\.iq\/sos\/(\S+)/)?.[1];
    expect(rows[0]!.payload.body).toContain('زينب');
    expect(link).toBeTruthy();
    // Vault reads: the contact's number is read by notify, logged against the person.
    expect(h.vault).toContain('p_rider:emergency_contact:system:notify:notify:sos_emergency_contact');
    const shared = await h.svc.shared({ token: link! });
    expect(shared).toMatchObject({ status: 'live', firstName: 'زينب', position: { lat: POS.lat, lng: POS.lng } });
    await expect(h.svc.shared({ token: `${v.incidentId}.forged` })).rejects.toMatchObject({ code: 'share_link_invalid' });
    expect((await h.svc.get(HAIDER, { id: v.incidentId })).contact).toMatchObject({ set: true, name: 'أم زينب', status: 'delivered' });
    expect((await h.svc.status(RIDER, {}))!.contactStatus).toBe('sent');
  });

  it("a driver's SOS reaches the driver's own emergency contact (Partner الحساب → رقم للطوارئ)", async () => {
    const h = harness({ driverContact: true });
    const v = await h.svc.sos(DRIVER, { subject: { kind: 'trip', id: h.trip.id }, position: POS, clientId: 'driver-press-2' });
    expect(v).toMatchObject({ contactName: 'أم حيدر', contactStatus: 'queued' });
    h.clock.advance(SAFETY_RULES.cancelWindowSec * 1000 + 1);
    expect((await h.svc.sweep()).contacts).toBe(1);
    await h.run();
    const rows = await h.deliveries('ec:p_driver');
    expect(rows.map((r) => [r.template, r.channel, r.status])).toEqual([['sos_emergency_contact', 'whatsapp', 'delivered']]);
    expect(rows[0]!.payload.body).toContain('حيدر');
    // The rider's contact is never told about the driver's alert.
    expect(await h.deliveries('ec:p_rider')).toEqual([]);
    expect(h.vault).toContain('p_driver:emergency_contact:system:notify:notify:sos_emergency_contact');
    expect((await h.svc.get(HAIDER, { id: v.incidentId })).contact).toMatchObject({ set: true, name: 'أم حيدر', status: 'delivered' });
  });

  it('keeps the position trail while open, throttles a flood, stops when closed', async () => {
    const h = harness();
    const v = await h.raise();
    for (let i = 1; i <= 3; i++) {
      h.clock.advance(5_000);
      await h.svc.position(RIDER, { incidentId: v.incidentId, position: { ...POS, lat: POS.lat + i / 1000, at: h.clock.now() } });
    }
    let c = await h.svc.get(HAIDER, { id: v.incidentId });
    expect(c.trail).toHaveLength(4);
    expect(c.lastPosition!.lat).toBeCloseTo(POS.lat + 0.003, 6);
    for (let i = 0; i < SAFETY_RULES.maxPositionsPerMin + 5; i++) await h.svc.position(RIDER, { incidentId: v.incidentId, position: { ...POS, at: h.clock.now() } });
    c = await h.svc.get(HAIDER, { id: v.incidentId });
    expect(c.trail.length).toBeLessThanOrEqual(SAFETY_RULES.maxPositionsPerMin + 1);
    await expect(h.svc.position(STRANGER, { incidentId: v.incidentId, position: POS })).rejects.toMatchObject({ code: 'sos_not_found' });
    await h.svc.resolve(HAIDER, { id: v.incidentId, outcome: 'safe', note: 'اتصلت بيها، بخير ووصلت البيت' });
    const before = (await h.svc.get(HAIDER, { id: v.incidentId })).trail.length;
    const after = await h.svc.position(RIDER, { incidentId: v.incidentId, position: { ...POS, at: h.clock.now() } });
    expect(after.sharing).toBe(false);
    expect((await h.svc.get(HAIDER, { id: v.incidentId })).trail).toHaveLength(before);
  });

  it('escalates once when nobody takes it within 60 s, paging the admins again', async () => {
    const h = harness();
    const v = await h.raise();
    await h.run();
    h.clock.advance(59_000);
    expect(await h.svc.escalate(v.incidentId)).toBe(false);
    expect((await h.svc.list(HAIDER, { scope: 'open', limit: 10 }))[0]!.overdue).toBe(false);
    h.clock.advance(2_000);
    expect((await h.svc.list(HAIDER, { scope: 'open', limit: 10 }))[0]!.overdue).toBe(true);
    expect((await h.svc.sweep()).escalated).toBe(1);
    expect((await h.svc.sweep()).escalated).toBe(0);
    await h.run();
    expect((await h.deliveries('p_ali')).filter((d) => d.channel === 'push')).toHaveLength(2);
    expect((await h.deliveries('p_haider')).filter((d) => d.channel === 'push')).toHaveLength(1);
    expect((await h.svc.get(HAIDER, { id: v.incidentId })).timeline.map((e) => e.kind)).toContain('escalated');
  });
});

describe('SafetyService — the on-call paging port', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Who got the first page (one dispatch per person) and what the fallback log said. */
  async function firstPage(onCall: OnCallPort | null, opts: { slow?: boolean } = {}) {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const h = harness({ onCall });
    const dispatch = vi.spyOn(h.notify, 'dispatch');
    if (opts.slow) vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const raised = h.raise();
    if (opts.slow) await vi.advanceTimersByTimeAsync(2_001);
    const v = await raised;
    if (opts.slow) await vi.advanceTimersByTimeAsync(2_001);
    if (opts.slow) vi.useRealTimers();
    await h.run();
    const paged = dispatch.mock.calls.filter(([req]) => req.template === 'sos_dispatch_alert').map(([req]) => req.to);
    const fallbackLogs = warn.mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith('safety_oncall_fallback'));
    const kase = await h.svc.get(HAIDER, { id: v.incidentId });
    return { h, v, paged, fallbackLogs, pagedEntry: kase.timeline.find((e) => e.kind === 'paged')! };
  }

  it('port absent → every live dispatcher and admin, logged', async () => {
    const r = await firstPage(null);
    expect(r.v.state).toBe('open');
    expect(r.paged).toEqual(['p_haider', 'p_ali']);
    expect(r.fallbackLogs).toEqual([expect.stringContaining('reason=absent')]);
    expect(r.pagedEntry.data).toMatchObject({ source: 'fallback_all_dispatchers' });
  });

  it('port throws → fallback; the SOS still opens', async () => {
    const r = await firstPage({ firstPage: async () => Promise.reject(new Error('rota down')) });
    expect(r.v.state).toBe('open');
    expect(r.paged).toEqual(['p_haider', 'p_ali']);
    expect(r.fallbackLogs).toEqual([expect.stringMatching(/reason=threw .*rota down/)]);
  });

  it('port slower than 2 s → fallback', async () => {
    const r = await firstPage({ firstPage: () => new Promise(() => undefined) }, { slow: true });
    expect(r.v.state).toBe('open');
    expect(r.paged).toEqual(['p_haider', 'p_ali']);
    expect(r.fallbackLogs).toEqual([expect.stringContaining('reason=timeout')]);
  });

  it('port returns nobody → fallback', async () => {
    const r = await firstPage({ firstPage: async () => ({ step: 'ring', staffPersonIds: [], ackWithinSec: 60, source: 'roster' }) });
    expect(r.paged).toEqual(['p_haider', 'p_ali']);
    expect(r.fallbackLogs).toEqual([expect.stringContaining('reason=empty')]);
  });

  it('port returns two people → exactly those two are paged; escalation is left to the on-call module', async () => {
    const seen: unknown[] = [];
    const r = await firstPage({
      firstPage: async (i) => {
        seen.push(i);
        return { step: 'ring', staffPersonIds: ['p_haider', 'p_oncall'], ackWithinSec: 90, source: 'roster' };
      },
    });
    expect(r.paged).toEqual(['p_haider', 'p_oncall']);
    expect(r.fallbackLogs).toEqual([]);
    expect(r.pagedEntry.data).toEqual({ count: '2', source: 'roster', step: 'ring' });
    expect(seen).toEqual([{ incidentId: r.v.incidentId, kind: 'sos', cityId: 'aziziyah', zoneKey: null, orderId: 'ord_ride_1', rideId: null, tripId: 'trp_1', createdAt: r.v.raisedAt }]);
    // Nobody took it in 60 s: the incident is marked escalated, but safety pages nobody again.
    const dispatch = vi.spyOn(r.h.notify, 'dispatch');
    r.h.clock.advance(61_000);
    expect((await r.h.svc.sweep()).escalated).toBe(1);
    await r.h.run();
    expect(dispatch.mock.calls.filter(([req]) => req.template === 'sos_dispatch_alert')).toHaveLength(0);
  });

  it('emits the on-call events: opened, acked (with who), closed', async () => {
    const h = harness();
    const v = await h.raise();
    await h.svc.acknowledge(HAIDER, { id: v.incidentId });
    await h.svc.resolve(HAIDER, { id: v.incidentId, outcome: 'safe', note: 'اتصلنا، بخير' });
    const evs = await h.ev.events.forAggregate('safety_incident', v.incidentId);
    const of = (t: string) => evs.find((e) => e.type === t)?.payload;
    expect(of('safety.incident_opened')).toMatchObject({ incidentId: v.incidentId, kind: 'sos', cityId: 'aziziyah', orderId: 'ord_ride_1', tripId: 'trp_1' });
    expect(of('safety.incident_acked')).toEqual({ incidentId: v.incidentId, byPersonId: HAIDER.personId });
    expect(of('safety.incident_closed')).toEqual({ incidentId: v.incidentId, outcome: 'safe', byPersonId: HAIDER.personId });
    const w = await h.raise(RIDER, 'press-cancel-1');
    await h.svc.cancel(RIDER, { incidentId: w.incidentId });
    expect((await h.ev.events.forAggregate('safety_incident', w.incidentId)).find((e) => e.type === 'safety.incident_closed')?.payload).toEqual({ incidentId: w.incidentId, outcome: 'false_alarm', byPersonId: null });
  });
});

describe('SafetyService — the Console desk', () => {
  it('acknowledge → call → note → resolve, all on the timeline and in the audit log', async () => {
    const h = harness();
    const v = await h.raise();
    await h.run();
    h.clock.advance(20_000);
    const acked = await h.svc.acknowledge(HAIDER, { id: v.incidentId });
    expect(acked).toMatchObject({ state: 'acknowledged', acknowledgedByName: 'حيدر' });
    expect(await h.svc.status(RIDER, { incidentId: v.incidentId })).toMatchObject({ state: 'acknowledged', acknowledgedBy: 'حيدر' });
    // A second dispatcher acknowledging changes nothing.
    expect(await h.svc.acknowledge(ALI, { id: v.incidentId })).toMatchObject({ acknowledgedByName: 'حيدر' });
    await expect(h.svc.call(HAIDER, { id: v.incidentId, who: 'raiser' })).resolves.toMatchObject({ mode: 'proxy', dial: '+9647800000000' });
    await h.svc.call(HAIDER, { id: v.incidentId, who: 'contact' });
    await h.svc.call(HAIDER, { id: v.incidentId, who: 'counterpart' });
    expect(h.calls.map((c) => c.calleeId)).toEqual(['p_rider', 'ec:p_rider', 'p_driver']);
    await h.svc.note(HAIDER, { id: v.incidentId, note: 'الزبونة تگول السايق وگف بمكان غريب' });
    await expect(h.svc.resolve(HAIDER, { id: v.incidentId, outcome: 'safe', note: 'وصلت البيت' })).resolves.toMatchObject({ state: 'resolved', outcome: 'safe', resolution: 'وصلت البيت' });
    await expect(h.svc.resolve(HAIDER, { id: v.incidentId, outcome: 'safe', note: 'مرة ثانية' })).rejects.toMatchObject({ code: 'safety_incident_closed' });
    await expect(h.svc.acknowledge(HAIDER, { id: v.incidentId })).rejects.toMatchObject({ code: 'safety_incident_closed' });
    const c = await h.svc.get(HAIDER, { id: v.incidentId });
    expect(c.timeline.map((e) => e.kind)).toEqual(['raised', 'paged', 'acknowledged', 'call', 'call', 'call', 'note', 'resolved']);
    expect(h.controls.auditRows.map((a) => a.action)).toEqual(['safety.acknowledge', 'safety.call', 'safety.call', 'safety.call', 'safety.resolve']);
    expect((await h.ev.events.forAggregate('safety_incident', v.incidentId)).map((e) => e.type)).toEqual(['sos.raised', 'safety.incident_opened', 'sos.acknowledged', 'safety.incident_acked', 'sos.resolved', 'safety.incident_closed']);
    expect(await h.svc.list(HAIDER, { scope: 'open', limit: 10 })).toEqual([]);
    expect(await h.svc.status(RIDER, {})).toBeNull();
  });

  it('logs every personal-data read in the vault with the staff member as reader', async () => {
    const h = harness();
    const v = await h.raise();
    h.vault.length = 0;
    await h.svc.get(HAIDER, { id: v.incidentId });
    expect(h.vault).toEqual(expect.arrayContaining(['p_rider:card:p_haider:safety_incident', 'p_driver:card:p_haider:safety_incident', 'p_rider:emergency_contact:p_haider:safety_incident']));
    h.vault.length = 0;
    await h.svc.list(ALI, { scope: 'open', limit: 10 });
    expect(h.vault).toEqual(['p_rider:name:p_ali:safety_desk']);
  });

  it('refuses the contact call when no contact is set', async () => {
    const h = harness({ contact: false });
    const v = await h.raise();
    await expect(h.svc.call(HAIDER, { id: v.incidentId, who: 'contact' })).rejects.toMatchObject({ code: 'safety_no_contact' });
    expect((await h.svc.get(HAIDER, { id: v.incidentId })).shareUrl).toBeNull();
  });
});

describe('safety router — who may call what', () => {
  const claims = (sub: string): SessionClaims => ({ sub, sid: `s-${sub}`, iat: 0, exp: 9_999_999_999 }) as unknown as SessionClaims;
  function caller(sub: string | null, roles: string[], svc: Partial<SafetyService>) {
    const ctx = {
      auth: sub ? claims(sub) : null,
      authError: null,
      identity: { hasRole: async (_p: string, kind: string) => roles.includes(kind) },
      safety: svc,
    } as unknown as AppContext;
    return appRouter.createCaller(ctx);
  }
  const svc = {
    list: async () => [],
    sos: async () => ({ incidentId: 'sos_1' }),
  } as unknown as Partial<SafetyService>;

  it('the desk is for dispatchers, support and admins only', async () => {
    await expect(caller('p_customer', ['customer'], svc).safety.list({ scope: 'open' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('p_finance', ['finance'], svc).safety.list({ scope: 'open' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('p_disp', ['dispatcher'], svc).safety.list({ scope: 'open' })).resolves.toEqual([]);
    await expect(caller('p_sup', ['support'], svc).safety.list({})).resolves.toEqual([]);
  });

  it('raising needs a session, not a role; anonymous callers are refused', async () => {
    await expect(caller(null, [], svc).safety.sos({ subject: { kind: 'order', id: 'o1' }, position: null, clientId: 'press-0001' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
