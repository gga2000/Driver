import { describe, expect, it } from 'vitest';
import { ON_CALL_RULES, type Actor } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { DevSmsProvider } from '../../shared/messaging/sms.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { NotifyEngine, type NotifyJob } from '../notify/notify.engine.js';
import { InMemoryNotifyRepository } from '../notify/notify.repository.js';
import { NotifyService } from '../notify/notify.service.js';
import { DevPushProvider } from '../notify/providers/push.js';
import { DevWhatsAppProvider } from '../notify/providers/whatsapp.js';
import { InMemoryConsoleWatchRepository } from './console-watch.repository.js';
import { ConsoleWatchService } from './console-watch.service.js';
import { InMemoryOnCallRepository } from './on-call.repository.js';
import { OnCallService } from './on-call.service.js';

const ALI: Actor = { personId: 'p_ali', sessionId: 's-a' };
const HAIDER: Actor = { personId: 'p_haider', sessionId: 's-h' };
const NAMES: Record<string, string> = {
  p_rider: 'زينب ع.',
  p_haider: 'حيدر ج.',
  p_sara: 'سارة م.',
  p_ali: 'علي أ.',
  p_noor: 'نور ح.',
  p_omar: 'عمر ك.',
};
const STAFF = [
  { personId: 'p_haider', roles: ['dispatcher'], frozen: false },
  { personId: 'p_sara', roles: ['support'], frozen: false },
  { personId: 'p_ali', roles: ['admin'], frozen: false },
  { personId: 'p_noor', roles: ['finance'], frozen: false },
  { personId: 'p_omar', roles: ['field_ops'], frozen: false },
  { personId: 'p_frozen', roles: ['dispatcher'], frozen: true },
];
const T0 = '2026-10-09T21:00:00Z';

/** `watchCities`: the cities whose Console watches itself (none by default, so the SOS tests stay quiet). */
function harness(watchCities: readonly string[] = []) {
  const clock = new FakeClock(T0);
  const ev = createInMemoryEvents({ clock });
  const vault: string[] = [];
  const identity = {
    roster: async (q: { kinds: readonly string[] }) => {
      const rows = STAFF.filter((r) => r.roles.some((k) => q.kinds.includes(k)));
      return { rows, nextCursor: null, total: rows.length };
    },
    rosterEntry: async (personId: string, kinds: readonly string[]) =>
      STAFF.find((r) => r.personId === personId && r.roles.some((k) => kinds.includes(k))) ?? null,
    displayNamesFor: async (ids: readonly string[], accessorId: string, purpose: string) => {
      for (const id of ids) vault.push(`${id}:${accessorId}:${purpose}`);
      return Object.fromEntries(
        ids.map((id) => [id, { displayName: NAMES[id] ?? null, deleted: false }]),
      );
    },
  } as unknown as IdentityService;

  const nrepo = new InMemoryNotifyRepository();
  const queue = new InMemoryQueue<NotifyJob>('notify', () => clock.now());
  const sms = new DevSmsProvider(false);
  const contacts = {
    contact: async (_to: string, o: { phone: boolean }) => ({
      locale: 'ar-IQ' as const,
      phoneE164: o.phone ? '+9647700000000' : null,
    }),
  };
  const engine = new NotifyEngine(
    nrepo,
    {
      push: { expo: new DevPushProvider(false), fcm: new DevPushProvider(false) },
      sms,
      whatsapp: new DevWhatsAppProvider(false),
    },
    contacts,
    queue,
    clock,
    { retryBaseMs: 1000, maxAttempts: 3, receiptDelaySec: 60 },
  );
  queue.process((job) => engine.process(job.data));
  const notify = new NotifyService(undefined, engine, nrepo, clock);
  const controls = new InMemoryControlsRepository();
  const audits = new AuditLogService(controls, new StaffNames(identity, clock), clock);
  const repo = new InMemoryOnCallRepository();
  const watchRepo = new InMemoryConsoleWatchRepository();
  const watch = new ConsoleWatchService(
    watchRepo,
    repo,
    { cities: watchCities, consoleBase: 'https://console.driver.iq' },
    identity,
    notify,
    ev.uow,
    clock,
  );
  const make = () =>
    new OnCallService(
      repo,
      { consoleBase: 'https://console.driver.iq', tickMs: 0 },
      identity,
      notify,
      ev.events,
      audits,
      ev.uow,
      clock,
      watch,
    );
  const svc = make();
  svc.onModuleInit();

  const emit = (type: string, incidentId = 'sos_1', extra: Record<string, unknown> = {}) =>
    ev.events.emit(
      undefined,
      {
        type,
        actorId: type === 'sos.raised' ? 'p_rider' : 'p_haider',
        occurredAt: clock.now(),
        idempotencyKey: `${incidentId}:${type}`,
        payload: { incidentId, cityId: 'aziziyah', ...extra },
      },
      { name: 'safety_incident', id: incidentId },
    );
  const raise = (incidentId = 'sos_1') =>
    emit('sos.raised', incidentId, {
      role: 'customer',
      subjectKind: 'order',
      orderId: 'ord_ride_1',
    });
  /** Moves the clock to `sec` after T0 and runs one sweep and the notify queue. */
  const at = async (sec: number, service = svc) => {
    clock.set(new Date(new Date(T0).getTime() + sec * 1000));
    const r = await service.tick();
    await queue.drain();
    return r;
  };
  const sent = async (personId: string) =>
    (await nrepo.log({ personId, limit: 100 })).reverse().map((d) => `${d.template}:${d.channel}`);
  const shift = (
    personId: string,
    rank: number,
    desk: 'sos' | 'cash' = 'sos',
    fromSec = -3600,
    toSec = 8 * 3600,
  ) =>
    svc.add(ALI, {
      cityId: 'aziziyah',
      desk,
      personId,
      rank,
      startsAt: new Date(new Date(T0).getTime() + fromSec * 1000),
      endsAt: new Date(new Date(T0).getTime() + toSec * 1000),
    });
  return { svc, make, repo, watchRepo, clock, ev, vault, controls, emit, raise, at, sent, shift };
}

describe('OnCallService — the SOS ladder (CON-02)', () => {
  it('rings the desk every 30 s, reaches rank 1 at 60 s and rank 2 at 120 s, and marks it unanswered', async () => {
    const h = harness();
    await h.shift('p_noor', 1);
    await h.shift('p_omar', 2);
    await h.raise();
    expect(await h.svc.ladder(HAIDER, { alertId: 'sos_1' })).toMatchObject({
      kind: 'sos',
      cityId: 'aziziyah',
      rings: 0,
      unanswered: false,
      steps: [],
    });

    expect(await h.at(29)).toEqual({ rings: 0, onCall: 0 });
    expect(await h.at(30)).toEqual({ rings: 1, onCall: 0 });
    // The desk: dispatchers, support and admins who are not frozen (never the person who pressed).
    for (const p of ['p_haider', 'p_sara', 'p_ali'])
      expect(await h.sent(p)).toEqual(['sos_desk_ring:push']);
    expect(await h.sent('p_frozen')).toEqual([]);
    expect(await h.sent('p_noor')).toEqual([]);

    expect(await h.at(60)).toEqual({ rings: 0, onCall: 1 });
    expect(await h.sent('p_noor')).toEqual([
      'sos_dispatch_alert:push',
      'sos_dispatch_alert:whatsapp',
    ]);
    expect(await h.sent('p_omar')).toEqual([]);
    expect((await h.svc.ladder(HAIDER, { alertId: 'sos_1' }))!.unanswered).toBe(true);

    expect(await h.at(61)).toEqual({ rings: 1, onCall: 0 }); // the ring that was due at 60
    expect(await h.at(120)).toEqual({ rings: 0, onCall: 1 });
    expect(await h.sent('p_omar')).toEqual([
      'sos_dispatch_alert:push',
      'sos_dispatch_alert:whatsapp',
    ]);
    const l = (await h.svc.ladder(HAIDER, { alertId: 'sos_1' }))!;
    expect(l.steps.map((s) => [s.step, s.count])).toEqual([
      ['ring', 3],
      ['on_call_1', 1],
      ['ring', 3],
      ['on_call_2', 1],
    ]);
  });

  it('stops the moment someone takes it, and stays stopped when it is resolved', async () => {
    const h = harness();
    await h.raise();
    await h.at(30);
    h.clock.set(new Date(new Date(T0).getTime() + 45_000));
    await h.emit('sos.acknowledged');
    expect(await h.at(60)).toEqual({ rings: 0, onCall: 0 });
    expect(await h.at(600)).toEqual({ rings: 0, onCall: 0 });
    expect(await h.sent('p_haider')).toEqual(['sos_desk_ring:push']);
    expect(await h.svc.ladder(HAIDER, { alertId: 'sos_1' })).toMatchObject({
      unanswered: false,
      takenAt: new Date(new Date(T0).getTime() + 45_000),
      rings: 1,
    });
    await h.emit('sos.resolved');
    expect((await h.svc.ladder(HAIDER, { alertId: 'sos_1' }))!.closedAt).not.toBeNull();
  });

  it('clears unanswered when it is taken late, and a cancelled alert stops ringing', async () => {
    const h = harness();
    await h.raise('sos_a');
    await h.raise('sos_b');
    await h.at(60);
    await h.emit('sos.acknowledged', 'sos_a');
    await h.emit('sos.cancelled', 'sos_b');
    expect(await h.svc.ladder(HAIDER, { alertId: 'sos_a' })).toMatchObject({ unanswered: false });
    expect(await h.svc.ladder(HAIDER, { alertId: 'sos_b' })).toMatchObject({ unanswered: false });
    expect(await h.at(90)).toEqual({ rings: 0, onCall: 0 });
  });

  it('with nobody on the roster, reaches the admins on every channel instead (never an empty list)', async () => {
    const h = harness();
    await h.raise();
    await h.at(60);
    expect(await h.sent('p_ali')).toEqual([
      'sos_dispatch_alert:push',
      'sos_dispatch_alert:whatsapp',
    ]);
    const l = (await h.svc.ladder(HAIDER, { alertId: 'sos_1' }))!;
    expect(l.steps.at(-1)).toMatchObject({ step: 'admins', count: 1 });
  });

  it('never goes quiet: rings every 30 s for 10 min, then every 2 min', async () => {
    const h = harness();
    await h.raise();
    for (let s = 5; s <= 20 * 60; s += 5) await h.at(s);
    const rings = (await h.svc.ladder(HAIDER, { alertId: 'sos_1' }))!.steps
      .filter((x) => x.step === 'ring')
      .map((x) => (x.at.getTime() - new Date(T0).getTime()) / 1000);
    const gaps = rings.slice(1).map((t, i) => t - rings[i]!);
    // Every 30 s (a sweep later when an on-call step took that sweep) until 10 min, then every 2 min.
    const fast = gaps.filter((_, i) => rings[i + 1]! <= ON_CALL_RULES.ringSlowAfterSec);
    const slow = gaps.filter((_, i) => rings[i]! >= ON_CALL_RULES.ringSlowAfterSec);
    expect(Math.max(...fast)).toBeLessThanOrEqual(
      ON_CALL_RULES.ringEverySec + ON_CALL_RULES.tickSec,
    );
    expect(slow.length).toBeGreaterThanOrEqual(4);
    expect(slow.every((g) => g === ON_CALL_RULES.ringSlowEverySec)).toBe(true);
    expect(rings.at(-1)).toBeGreaterThan(20 * 60 - ON_CALL_RULES.ringSlowEverySec);
    expect((await h.svc.ladder(HAIDER, { alertId: 'sos_1' }))!.unanswered).toBe(true);
  });

  it('two machines sweeping at once page each step once', async () => {
    const h = harness();
    await h.shift('p_noor', 1);
    const other = h.make();
    await h.raise();
    h.clock.set(new Date(new Date(T0).getTime() + 60_000));
    const [a, b] = await Promise.all([h.svc.tick(), other.tick()]);
    expect(a.onCall + b.onCall).toBe(1);
    h.clock.set(new Date(new Date(T0).getTime() + 61_000));
    const [c, d] = await Promise.all([h.svc.tick(), other.tick()]);
    expect(c.rings + d.rings).toBe(1);
    await h.at(61);
    expect(await h.sent('p_noor')).toEqual([
      'sos_dispatch_alert:push',
      'sos_dispatch_alert:whatsapp',
    ]);
  });

  it('opens one ladder per alert even when the event is delivered twice', async () => {
    const h = harness();
    await h.raise();
    await h.raise();
    expect(await h.repo.ringing(10)).toHaveLength(1);
  });

  it("first page (the safety module's port): the whole desk, 60 s to take it", async () => {
    const h = harness();
    const plan = await h.svc.firstPage({
      incidentId: 'sos_1',
      kind: 'sos',
      cityId: 'aziziyah',
      zoneKey: null,
      orderId: null,
      rideId: null,
      tripId: null,
      createdAt: h.clock.now(),
    });
    expect(plan).toEqual({
      step: 'ring',
      staffPersonIds: ['p_haider', 'p_sara', 'p_ali'],
      ackWithinSec: 60,
      source: 'roster',
    });
  });
});

describe('OnCallService — the roster', () => {
  it('adds and ends shifts (audited), lists them with names, and says who is on call now', async () => {
    const h = harness();
    const noor = await h.shift('p_noor', 1);
    await h.shift('p_omar', 2);
    await h.shift('p_sara', 1, 'cash');
    await h.shift('p_haider', 1, 'sos', 3600, 7200); // later tonight
    expect(noor).toMatchObject({
      personId: 'p_noor',
      displayName: 'نور ح.',
      rank: 1,
      now: true,
      endedAt: null,
      createdById: 'p_ali',
    });

    const now = await h.svc.now(HAIDER, { cityId: 'aziziyah' });
    expect(
      now.map((d) => [d.desk, d.people.map((p) => [p.personId, p.rank]), d.fallbackToAdmins]),
    ).toEqual([
      [
        'sos',
        [
          ['p_noor', 1],
          ['p_omar', 2],
        ],
        false,
      ],
      ['cash', [['p_sara', 1]], false],
    ]);
    expect(
      (await h.svc.list(HAIDER, { cityId: 'aziziyah' })).map((s) => [s.personId, s.now]),
    ).toEqual([
      ['p_noor', true],
      ['p_omar', true],
      ['p_sara', true],
      ['p_haider', false],
    ]);

    const ended = await h.svc.end(ALI, { id: noor.id });
    expect(ended).toMatchObject({ now: false, endedAt: h.clock.now() });
    expect(await h.svc.end(ALI, { id: noor.id })).toMatchObject({ endedAt: ended.endedAt }); // ending twice changes nothing
    const sos = (await h.svc.now(HAIDER, { cityId: 'aziziyah' }))[0]!;
    expect(sos.people.map((p) => p.personId)).toEqual(['p_omar']);

    const audit = await h.controls.audit({ limit: 20 });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'on_call.shift_added',
      'on_call.shift_added',
      'on_call.shift_added',
      'on_call.shift_added',
      'on_call.shift_ended',
    ]);
    expect(h.vault.every((v) => v.includes('console_staff'))).toBe(true);
  });

  it('shows the admins fallback when nobody is on call, and refuses people who are not staff', async () => {
    const h = harness();
    expect(
      (await h.svc.now(HAIDER, { cityId: 'aziziyah' })).map((d) => d.fallbackToAdmins),
    ).toEqual([true, true]);
    await expect(h.shift('p_rider', 1)).rejects.toMatchObject({ code: 'on_call_not_staff' });
    await expect(h.shift('p_frozen', 1)).rejects.toMatchObject({ code: 'on_call_not_staff' });
    await expect(h.svc.end(ALI, { id: 'onc_nope' })).rejects.toMatchObject({
      code: 'on_call_not_found',
    });
  });

  it('a shift that has not started yet, or has ended, is not reached', async () => {
    const h = harness();
    await h.shift('p_noor', 1, 'sos', 3600, 7200);
    await h.raise();
    await h.at(60);
    expect(await h.sent('p_noor')).toEqual([]);
    expect(await h.sent('p_ali')).toContain('sos_dispatch_alert:whatsapp');
  });
});

describe('OnCallService — the staff list', () => {
  it('lists staff who are not frozen, with names (one logged read)', async () => {
    const h = harness();
    const staff = await h.svc.staff(ALI);
    expect(staff.map((s) => [s.personId, s.displayName])).toEqual([
      ['p_haider', 'حيدر ج.'],
      ['p_sara', 'سارة م.'],
      ['p_ali', 'علي أ.'],
      ['p_noor', 'نور ح.'],
      ['p_omar', 'عمر ك.'],
    ]);
    expect(h.vault).toHaveLength(5);
  });
});

describe('ConsoleWatchService — the Console watching itself', () => {
  /** 06:00 city time on 10 Oct (T0 is midnight). */
  const SIX = 6 * 3600;
  const tab = (h: ReturnType<typeof harness>, tabId: string, live: 'live' | 'fallback' | 'connecting' | 'stopped', who = HAIDER) =>
    h.svc.present(who, { cityId: 'aziziyah', tabId, live });

  it('tells the admins once when nobody opened the Console by 06:05, and stops when a screen opens', async () => {
    const h = harness(['aziziyah']);
    await h.at(3 * 3600); // 03:00: outside the hours, nobody on call
    await h.at(SIX + 299);
    expect(await h.sent('p_ali')).toEqual([]);
    await h.at(SIX + 300);
    expect(await h.sent('p_ali')).toEqual([
      'console_unwatched_alert:push',
      'console_unwatched_alert:whatsapp',
    ]);
    expect(await h.sent('p_haider')).toEqual([]);
    await h.at(SIX + 400); // still nobody: no second page
    expect(await h.sent('p_ali')).toHaveLength(2);
    expect((await h.watchRepo.openFor('aziziyah')).map((a) => [a.kind, a.paged])).toEqual([
      ['unwatched', 1],
    ]);

    await tab(h, 'tab_haider_1', 'stopped');
    await h.at(SIX + 410);
    expect(await h.watchRepo.openFor('aziziyah')).toEqual([]);

    // The screen closes (last seen at +400); five minutes after that it is a new gap and pages again.
    await h.at(SIX + 699);
    expect(await h.sent('p_ali')).toHaveLength(2);
    await h.at(SIX + 700);
    expect(await h.sent('p_ali')).toHaveLength(4);
  });

  it('at night, only while someone is on call, and it tells them, not the admins', async () => {
    const h = harness(['aziziyah']);
    await h.at(3 * 3600);
    expect(await h.sent('p_ali')).toEqual([]);
    await h.shift('p_haider', 1, 'sos', 3 * 3600, 5 * 3600);
    await h.at(3 * 3600 + 300);
    expect(await h.sent('p_haider')).toContain('console_unwatched_alert:whatsapp');
    expect(await h.sent('p_ali')).toEqual([]);
  });

  it('when every screen has had live updates stopped for a minute: the red bar and one page', async () => {
    const h = harness(['aziziyah']);
    const beat = async (sec: number, a: 'live' | 'fallback', b: 'live' | 'fallback' = a) => {
      h.clock.set(new Date(new Date(T0).getTime() + sec * 1000));
      await tab(h, 'tab_haider_1', a);
      await tab(h, 'tab_sara_1', b, { personId: 'p_sara', sessionId: 's-s' });
      await tab(h, 'tab_ali_1', 'stopped', ALI); // a page without live updates is not counted
      return h.at(sec);
    };
    await beat(SIX, 'live');
    await beat(SIX + 30, 'fallback', 'live'); // one screen still live: fine
    await beat(SIX + 60, 'fallback');
    await beat(SIX + 119, 'fallback');
    expect(await h.sent('p_ali')).toEqual([]);
    await beat(SIX + 120, 'fallback');
    expect(await h.sent('p_ali')).toEqual([
      'console_live_down_alert:push',
      'console_live_down_alert:whatsapp',
    ]);
    const watch = await tab(h, 'tab_haider_1', 'fallback');
    expect(watch.open.map((a) => a.kind)).toEqual(['live_down']);

    await beat(SIX + 150, 'live', 'fallback');
    expect((await tab(h, 'tab_haider_1', 'live')).open).toEqual([]);
    expect(await h.sent('p_ali')).toHaveLength(2);
  });
});
