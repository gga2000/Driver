import { describe, expect, it } from 'vitest';
import { fromLocalM, ZONE_CHECK_RULES, type Actor, type LatLng, type Vertical } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { AuditLogService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents, type PublishedEvent } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { confirmsZone, tallyChecks } from './zone-checks.logic.js';
import { InMemoryZoneChecksRepository } from './zone-checks.repository.js';
import { ZoneChecksService } from './zone-checks.service.js';
import { InMemoryZonesRepository } from './zones.repository.js';
import { ZonesService } from './zones.service.js';

const ALI: Actor = { personId: 'p_ali', sessionId: 's_ali' };
const D1: Actor = { personId: 'p_d1', sessionId: 's1' };
const D2: Actor = { personId: 'p_d2', sessionId: 's2' };
const D3: Actor = { personId: 'p_d3', sessionId: 's3' };
const ORIGIN: LatLng = { lat: 32.905, lng: 45.06 };
const SIDE_M = 600;
const SQUARE = [{ x: 0, y: 0 }, { x: SIDE_M, y: 0 }, { x: SIDE_M, y: SIDE_M }, { x: 0, y: SIDE_M }].map((q) => fromLocalM(q, ORIGIN));
const INSIDE = fromLocalM({ x: SIDE_M / 2, y: SIDE_M / 2 }, ORIGIN);
const OUTSIDE = fromLocalM({ x: SIDE_M * 3, y: SIDE_M * 3 }, ORIGIN);
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

function harness() {
  // 10:00 Baghdad.
  const clock = new FakeClock('2026-10-06T07:00:00Z');
  const ev = createInMemoryEvents({ clock });
  const audit = new InMemoryControlsRepository();
  const identity = { firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, null])) } as unknown as IdentityService;
  const names = new StaffNames(identity, clock);
  const zonesRepo = new InMemoryZonesRepository();
  const checksRepo = new InMemoryZoneChecksRepository();
  const zones = new ZonesService(zonesRepo, ev.events, new AuditLogService(audit, names, clock), names, ev.uow, clock, checksRepo);
  const svc = new ZoneChecksService(checksRepo, zonesRepo, zones, ev.events, ev.uow, clock);
  svc.onModuleInit();
  let seq = 0;
  /** A finished drop-off by `driver`, through the outbox as trips emits it. */
  const drop = async (driver: Actor, over: { at?: LatLng; accuracyM?: number; vertical?: Vertical; final?: boolean } = {}) => {
    seq += 1;
    const at = over.at ?? INSIDE;
    await ev.events.emit(
      undefined,
      {
        actorId: driver.personId,
        type: 'stop.completed',
        occurredAt: clock.now(),
        tripId: `trp_${seq}`,
        payload: {
          stopId: `stp_${seq}`,
          stopType: 'dropoff',
          vertical: over.vertical ?? 'food',
          cashCollectedIqd: null,
          photo: false,
          pinOk: null,
          serverReceivedAt: clock.now().toISOString(),
          ...(over.final === false ? {} : { finalDrop: { cityId: 'aziziyah', lat: at.lat, lng: at.lng, accuracyM: over.accuracyM ?? 8 } }),
        },
      },
      { name: 'trip', id: `trp_${seq}` },
    );
  };
  const place = () => zones.place(ALI, { cityId: 'aziziyah', key: 'centre', ring: SQUARE, centre: INSIDE });
  const zone = async () => (await zones.list('aziziyah')).find((z) => z.key === 'centre')!;
  const nextDay = () => clock.advance(DAY_MS);
  /** Drop, then answer the question it raised. */
  const dropAndAnswer = async (driver: Actor, answer: 'yes' | 'no' | 'unsure') => {
    await drop(driver);
    const q = await svc.open(driver);
    expect(q).not.toBeNull();
    await svc.answer(driver, { checkId: q!.checkId, answer });
  };
  return { clock, ev, audit, zones, svc, checksRepo, drop, place, zone, nextDay, dropAndAnswer };
}

describe('ZoneChecksService: asking', () => {
  it('asks at the drop-off that ends a trip inside a placed outline, by name, for 30 minutes', async () => {
    const h = harness();
    await h.place();
    await h.drop(D1);
    const q = await h.svc.open(D1);
    expect(q).toMatchObject({ checkId: 'zc_stp_1', zoneKey: 'centre', name_ar: 'العزيزية (مركز)' });
    expect(q!.expiresAt).toEqual(new Date(h.clock.now().getTime() + ZONE_CHECK_RULES.answerWithinMin * MIN_MS));
    expect(await h.svc.open(D2)).toBeNull();
  });

  it('does not ask for drafts, outside every outline, imprecise fixes, mid-trip drops, الرجعة or خطوط', async () => {
    const h = harness();
    // Every zone is still an AI draft.
    await h.drop(D1);
    expect(await h.svc.open(D1)).toBeNull();
    await h.place();
    await h.drop(D1, { at: OUTSIDE });
    await h.drop(D1, { accuracyM: ZONE_CHECK_RULES.maxAccuracyM + 1 });
    await h.drop(D1, { final: false });
    await h.drop(D1, { vertical: 'intercity' });
    await h.drop(D1, { vertical: 'khat' });
    expect(await h.svc.open(D1)).toBeNull();
    // None of those used up his question for the day.
    await h.drop(D1);
    expect(await h.svc.open(D1)).not.toBeNull();
  });

  it('asks a driver at most once a Baghdad day, answered or not', async () => {
    const h = harness();
    await h.place();
    await h.dropAndAnswer(D1, 'unsure');
    await h.drop(D1);
    expect(await h.svc.open(D1)).toBeNull();
    // 23:59 Baghdad is still the same day.
    h.clock.set('2026-10-06T20:59:00Z');
    await h.drop(D1);
    expect(await h.svc.open(D1)).toBeNull();
    // Midnight Baghdad: a new day.
    h.clock.set('2026-10-06T21:00:00Z');
    await h.drop(D1);
    expect(await h.svc.open(D1)).not.toBeNull();
  });

  it('ignores quarantined (late-replay) events and deliveries too late to ask', async () => {
    const h = harness();
    await h.place();
    const base: PublishedEvent = {
      id: 'ev_1', outboxId: 'ob_1', actorId: D1.personId, type: 'stop.completed', occurredAt: h.clock.now(), recordedAt: h.clock.now(), tripId: 'trp_x',
      aggregate: 'trip', aggregateId: 'trp_x', skewMs: 0, flagged: false, quarantined: true,
      payload: { stopId: 'stp_x', stopType: 'dropoff', vertical: 'food', finalDrop: { cityId: 'aziziyah', lat: INSIDE.lat, lng: INSIDE.lng, accuracyM: 5 } },
    };
    await h.ev.uow.run((tx) => h.svc.onStopCompleted(base, tx));
    expect(await h.svc.open(D1)).toBeNull();
    const stale = { ...base, quarantined: false, recordedAt: new Date(h.clock.now().getTime() - (ZONE_CHECK_RULES.answerWithinMin + 1) * MIN_MS) };
    await h.ev.uow.run((tx) => h.svc.onStopCompleted(stale, tx));
    expect(await h.svc.open(D1)).toBeNull();
    await h.ev.uow.run((tx) => h.svc.onStopCompleted({ ...base, quarantined: false }, tx));
    expect(await h.svc.open(D1)).toMatchObject({ checkId: 'zc_stp_x' });
  });

  it('never asks about a confirmed zone', async () => {
    const h = harness();
    await h.place();
    await h.dropAndAnswer(D1, 'yes');
    await h.dropAndAnswer(D2, 'yes');
    await h.dropAndAnswer(D3, 'yes');
    expect((await h.zone()).placement).toBe('confirmed');
    h.nextDay();
    await h.drop(D1);
    expect(await h.svc.open(D1)).toBeNull();
  });
});

describe('ZoneChecksService: answers', () => {
  it('3 yes from one driver is not enough; a second driver makes it confirmed (audited, evented, as the system)', async () => {
    const h = harness();
    await h.place();
    for (let day = 0; day < ZONE_CHECK_RULES.yesToConfirm; day += 1) {
      await h.dropAndAnswer(D1, 'yes');
      h.nextDay();
    }
    expect(await h.zone()).toMatchObject({ placement: 'placed', checks: { yes: 3, no: 0, drivers: 1, flaggedAt: null } });
    await h.dropAndAnswer(D2, 'yes');
    expect(await h.zone()).toMatchObject({ placement: 'confirmed', checks: { yes: 4, drivers: 2 } });
    expect(h.audit.auditRows.map((a) => [a.action, a.actorId])).toEqual([['zone.placed', ALI.personId], ['zone.confirmed', 'system:zone-checks']]);
    expect((await h.ev.events.forAggregate('zone', 'aziziyah:centre')).map((e) => e.type)).toEqual(['zone.placed', 'zone.confirmed']);
  });

  it('a "no" flags the zone and holds confirmation until the outline is fixed and saved again', async () => {
    const h = harness();
    await h.place();
    await h.dropAndAnswer(D1, 'no');
    const flagged = await h.zone();
    expect(flagged.checks).toEqual({ yes: 0, no: 1, drivers: 0, flaggedAt: h.clock.now() });
    expect(h.audit.auditRows.map((a) => [a.action, a.actorId])).toEqual([['zone.placed', ALI.personId], ['zone.flagged', D1.personId]]);
    await h.dropAndAnswer(D2, 'yes');
    await h.dropAndAnswer(D3, 'yes');
    h.nextDay();
    await h.dropAndAnswer(D2, 'yes');
    expect(await h.zone()).toMatchObject({ placement: 'placed', checks: { yes: 3, no: 1, drivers: 2 } });
    // The field team fixes the outline: the count starts again and the flag is gone.
    await h.place();
    expect((await h.zone()).checks).toEqual({ yes: 0, no: 0, drivers: 0, flaggedAt: null });
  });

  it('"ما أعرف" closes the question and counts neither way; the first answer wins', async () => {
    const h = harness();
    await h.place();
    await h.drop(D1);
    const q = (await h.svc.open(D1))!;
    await h.svc.answer(D1, { checkId: q.checkId, answer: 'unsure' });
    await h.svc.answer(D1, { checkId: q.checkId, answer: 'no' });
    expect(await h.svc.open(D1)).toBeNull();
    expect((await h.zone()).checks).toEqual({ yes: 0, no: 0, drivers: 0, flaggedAt: null });
  });

  it('drops a question after 30 minutes: not shown, an answer is refused', async () => {
    const h = harness();
    await h.place();
    await h.drop(D1);
    const q = (await h.svc.open(D1))!;
    h.clock.advance(ZONE_CHECK_RULES.answerWithinMin * MIN_MS);
    expect(await h.svc.open(D1)).toBeNull();
    await expect(h.svc.answer(D1, { checkId: q.checkId, answer: 'yes' })).rejects.toMatchObject({ code: 'zone_check_expired' });
  });

  it("refuses answering someone else's question (or one that does not exist) as not found", async () => {
    const h = harness();
    await h.place();
    await h.drop(D1);
    const q = (await h.svc.open(D1))!;
    await expect(h.svc.answer(D2, { checkId: q.checkId, answer: 'no' })).rejects.toMatchObject({ code: 'zone_check_not_found' });
    await expect(h.svc.answer(D1, { checkId: 'zc_nope', answer: 'no' })).rejects.toMatchObject({ code: 'zone_check_not_found' });
    expect(await h.svc.open(D1)).not.toBeNull();
  });

  it('stops showing a question whose outline was redrawn since, and its answer no longer counts', async () => {
    const h = harness();
    await h.place();
    await h.drop(D1);
    const q = (await h.svc.open(D1))!;
    h.clock.advance(MIN_MS);
    await h.place();
    expect(await h.svc.open(D1)).toBeNull();
    await h.svc.answer(D1, { checkId: q.checkId, answer: 'no' });
    expect((await h.zone()).checks).toEqual({ yes: 0, no: 0, drivers: 0, flaggedAt: null });
  });

  it('drafts carry no tally in the zone list', async () => {
    const h = harness();
    expect((await h.zone()).checks).toBeUndefined();
  });
});

describe('«تم الفحص»: the team clears a flag without redrawing (Ali, 2026-10-06)', () => {
  const CENTRE = { cityId: 'aziziyah', key: 'centre' } as const;
  const actions = (h: ReturnType<typeof harness>) => h.audit.auditRows.map((a) => [a.action, a.actorId]);
  const eventTypes = async (h: ReturnType<typeof harness>) => (await h.ev.events.forAggregate('zone', 'aziziyah:centre')).map((e) => e.type);

  it('lifts the hold: the earlier "no" stops flagging, the yeses so far still count, audited and evented as the Console user', async () => {
    const h = harness();
    await h.place();
    await h.dropAndAnswer(D1, 'no');
    await h.dropAndAnswer(D2, 'yes');
    await h.dropAndAnswer(D3, 'yes');
    expect(await h.zone()).toMatchObject({ placement: 'placed', checks: { yes: 2, no: 1, drivers: 2 } });
    const view = await h.zones.clearCheckFlag(ALI, CENTRE);
    expect(view).toMatchObject({ key: 'centre', placement: 'placed', checks: { yes: 2, no: 0, drivers: 2, flaggedAt: null } });
    expect(actions(h)).toEqual([['zone.placed', ALI.personId], ['zone.flagged', D1.personId], ['zone.flag_cleared', ALI.personId]]);
    expect(h.audit.auditRows.at(-1)).toMatchObject({ subjectKind: 'zone', subjectId: 'centre', detail: { answers: 1 } });
    expect(await eventTypes(h)).toEqual(['zone.placed', 'zone.flagged', 'zone.flag_cleared']);
    // No longer held: the next "yes" confirms it, as the drivers.
    h.nextDay();
    await h.dropAndAnswer(D2, 'yes');
    expect(await h.zone()).toMatchObject({ placement: 'confirmed', checks: { yes: 3, no: 0, drivers: 2 } });
    expect(actions(h).at(-1)).toEqual(['zone.confirmed', 'system:zone-checks']);
  });

  it('a "no" after the check flags the zone again and holds it', async () => {
    const h = harness();
    await h.place();
    await h.dropAndAnswer(D1, 'no');
    await h.zones.clearCheckFlag(ALI, CENTRE);
    h.nextDay();
    await h.dropAndAnswer(D1, 'no');
    expect((await h.zone()).checks).toEqual({ yes: 0, no: 1, drivers: 0, flaggedAt: h.clock.now() });
    await h.dropAndAnswer(D2, 'yes');
    await h.dropAndAnswer(D3, 'yes');
    h.nextDay();
    await h.dropAndAnswer(D2, 'yes');
    expect(await h.zone()).toMatchObject({ placement: 'placed', checks: { yes: 3, no: 1, drivers: 2 } });
  });

  it('confirms the zone at the check when the yeses already add up (same event and audit line, the Console user as actor)', async () => {
    const h = harness();
    await h.place();
    await h.dropAndAnswer(D1, 'no');
    await h.dropAndAnswer(D2, 'yes');
    await h.dropAndAnswer(D3, 'yes');
    h.nextDay();
    await h.dropAndAnswer(D2, 'yes');
    expect((await h.zone()).placement).toBe('placed');
    const view = await h.zones.clearCheckFlag(ALI, CENTRE);
    expect(view).toMatchObject({ placement: 'confirmed', checks: { yes: 3, no: 0, drivers: 2, flaggedAt: null } });
    expect(actions(h)).toEqual([['zone.placed', ALI.personId], ['zone.flagged', D1.personId], ['zone.flag_cleared', ALI.personId], ['zone.confirmed', ALI.personId]]);
    expect(h.audit.auditRows.at(-1)).toMatchObject({ detail: { yes: 3, drivers: 2 } });
    expect(await eventTypes(h)).toEqual(['zone.placed', 'zone.flagged', 'zone.flag_cleared', 'zone.confirmed']);
  });

  it('leaves a zone with no open flag as it is: nothing written, audited or evented (a second tap included)', async () => {
    const h = harness();
    await h.place();
    await h.dropAndAnswer(D2, 'yes');
    expect(await h.zones.clearCheckFlag(ALI, CENTRE)).toMatchObject({ placement: 'placed', checks: { yes: 1, no: 0, flaggedAt: null } });
    expect(actions(h)).toEqual([['zone.placed', ALI.personId]]);
    await h.dropAndAnswer(D1, 'no');
    await h.zones.clearCheckFlag(ALI, CENTRE);
    await h.zones.clearCheckFlag(ALI, CENTRE);
    expect(actions(h).filter(([action]) => action === 'zone.flag_cleared')).toHaveLength(1);
    expect((await eventTypes(h)).filter((type) => type === 'zone.flag_cleared')).toHaveLength(1);
    // A draft has no drawn outline to judge: nothing happens either.
    expect(await h.zones.clearCheckFlag(ALI, { cityId: 'aziziyah', key: 'street_30' })).toMatchObject({ key: 'street_30', placement: 'draft' });
  });

  it('refuses a zone the city does not have', async () => {
    const h = harness();
    await expect(h.zones.clearCheckFlag(ALI, { cityId: 'aziziyah', key: 'atlantis' })).rejects.toMatchObject({ code: 'zone_unknown' });
  });

  it('a later redraw still starts the count from zero', async () => {
    const h = harness();
    await h.place();
    await h.dropAndAnswer(D1, 'no');
    await h.dropAndAnswer(D2, 'yes');
    await h.zones.clearCheckFlag(ALI, CENTRE);
    h.clock.advance(MIN_MS);
    await h.place();
    expect((await h.zone()).checks).toEqual({ yes: 0, no: 0, drivers: 0, flaggedAt: null });
  });
});

describe('zone check rules', () => {
  const row = (driverId: string, answer: 'yes' | 'no' | 'unsure', minute = 0, clearedAt: Date | null = null) => ({ zoneKey: 'centre', outlineAt: new Date(0), driverId, answer, answeredAt: new Date(minute * MIN_MS), clearedAt });
  it('counts yes, no, the different yes drivers and the latest no', () => {
    expect(tallyChecks([row('a', 'yes'), row('a', 'yes'), row('b', 'unsure'), row('c', 'no', 3), row('d', 'no', 7)])).toEqual({ yes: 2, no: 2, drivers: 1, flaggedAt: new Date(7 * MIN_MS) });
  });
  it('confirms at 3 yes from 2+ drivers with no "no"', () => {
    expect(confirmsZone(tallyChecks([row('a', 'yes'), row('a', 'yes'), row('b', 'yes')]))).toBe(true);
    expect(confirmsZone(tallyChecks([row('a', 'yes'), row('a', 'yes'), row('a', 'yes')]))).toBe(false);
    expect(confirmsZone(tallyChecks([row('a', 'yes'), row('b', 'yes')]))).toBe(false);
    expect(confirmsZone(tallyChecks([row('a', 'yes'), row('a', 'yes'), row('b', 'yes'), row('c', 'no')]))).toBe(false);
  });
  it('a "no" the team checked counts neither as a "no" nor toward the flag; one after it does', () => {
    const checked = new Date(5 * MIN_MS);
    expect(tallyChecks([row('a', 'yes'), row('c', 'no', 3, checked)])).toEqual({ yes: 1, no: 0, drivers: 1, flaggedAt: null });
    expect(confirmsZone(tallyChecks([row('a', 'yes'), row('a', 'yes'), row('b', 'yes'), row('c', 'no', 3, checked)]))).toBe(true);
    expect(tallyChecks([row('c', 'no', 3, checked), row('d', 'no', 9)])).toEqual({ yes: 0, no: 1, drivers: 0, flaggedAt: new Date(9 * MIN_MS) });
  });
});
