import { beforeEach, describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES, ETA_LEARNING_RULES, type LatLng, type VehicleClass, type Vertical } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { createInMemoryEvents } from '../events/index.js';
import { ZoneResolver } from '../places/index.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import { InMemoryTripsRepository, ScriptedOfferCheck, TripEventsAdapter, TripsService, type TripTimerJob } from '../trips/index.js';
import { InMemoryEtaCorrectionsRepository, type EtaSampleRecord } from './eta-corrections.repository.js';
import { EtaLearner } from './eta-learner.js';
import { ALL_DAY, ANY_ZONE, clampFactor, hourBucketOf, judgeLeg, lookupChain, nextEwma, pickFactor, type EtaCell, type EtaCellKey } from './eta-learning.js';
import { LearnedEtaCorrection, zoneLocator } from './learned-eta-correction.js';

const zone = (id: string): LatLng => {
  const z = AZIZIYAH_ZONES.find((x) => x.id === id);
  if (!z) throw new Error(`no seed zone ${id}`);
  return { lat: z.lat, lng: z.lng };
};
/** About 2.1 km apart in a straight line: a ~5 minute leg on the straight-line router. */
const KITCHEN = zone('centre');
const DOOR = zone('qutniya');
const OUTSIDE: LatLng = { lat: 33.4, lng: 44.4 };

const MIN = 60_000;
/** 12:00 Baghdad (09:00Z): the 11–14 bucket. */
const NOON = '2026-10-06T09:00:00Z';

const zones = zoneLocator(new ZoneResolver(), () => ['aziziyah']);
const router = new StraightLineRouter();

describe('eta learning maths', () => {
  it('buckets Baghdad local time into the six traffic regimes', () => {
    expect(hourBucketOf(new Date('2026-10-06T02:59:00Z'))).toBe(0); // 05:59 local
    expect(hourBucketOf(new Date('2026-10-06T03:00:00Z'))).toBe(6); // 06:00 local
    expect(hourBucketOf(new Date(NOON))).toBe(11);
    expect(hourBucketOf(new Date('2026-10-06T15:30:00Z'))).toBe(17); // 18:30 local
    expect(hourBucketOf(new Date('2026-10-06T20:30:00Z'))).toBe(21); // 23:30 local
  });

  it('seeds a cell with its first ratio, then moves by alpha towards each new one', () => {
    const first = nextEwma(null, 1.5, 0.2);
    expect(first).toEqual({ factor: 1.5, samples: 1 });
    const second = nextEwma(first, 1.0, 0.2);
    expect(second.factor).toBeCloseTo(1.4, 10);
    expect(second.samples).toBe(2);
  });

  it('clamps an applied factor to 0.7–1.6', () => {
    expect(clampFactor(2.5)).toBe(1.6);
    expect(clampFactor(0.4)).toBe(0.7);
    expect(clampFactor(1.2)).toBe(1.2);
  });

  it('rejects too-short legs and outliers, keeps ordinary traffic', () => {
    expect(judgeLeg(3, 1.5)).toEqual({ ok: false, reason: 'too_short' });
    expect(judgeLeg(25, 5)).toEqual({ ok: false, reason: 'outlier' }); // 5×: he stopped somewhere
    expect(judgeLeg(1, 5)).toEqual({ ok: false, reason: 'outlier' }); // 0.2×: a GPS gap or an early tap
    expect(judgeLeg(7.5, 5)).toEqual({ ok: true, ratio: 1.5 });
  });

  it('falls back pair+bucket → pair all day → city+bucket → city all day → 1, using only trusted cells', () => {
    const leg = { cityId: 'aziziyah', fromZone: 'a', toZone: 'b', hourBucket: 11, vehicleClass: 'bike' as VehicleClass, basis: 'estimated' as const };
    const chain = lookupChain(leg);
    expect(chain.map((k) => [k.fromZone, k.toZone, k.hourBucket])).toEqual([
      ['a', 'b', 11],
      ['a', 'b', ALL_DAY],
      [ANY_ZONE, ANY_ZONE, 11],
      [ANY_ZONE, ANY_ZONE, ALL_DAY],
    ]);
    const cells = new Map<string, { factor: number; samples: number }>();
    const key = (k: EtaCellKey) => `${k.fromZone}|${k.toZone}|${k.hourBucket}`;
    const pick = () => pickFactor(chain, (k) => cells.get(key(k)));
    expect(pick()).toBe(1);
    cells.set('*|*|-1', { factor: 1.1, samples: 40 });
    expect(pick()).toBe(1.1);
    cells.set('*|*|11', { factor: 1.3, samples: 12 });
    expect(pick()).toBe(1.3);
    cells.set('a|b|-1', { factor: 1.2, samples: ETA_LEARNING_RULES.minSamples });
    expect(pick()).toBe(1.2);
    // A young cell (fewer than minSamples legs) is not trusted yet: the pair's all-day cell still answers.
    cells.set('a|b|11', { factor: 1.5, samples: ETA_LEARNING_RULES.minSamples - 1 });
    expect(pick()).toBe(1.2);
    cells.set('a|b|11', { factor: 3, samples: ETA_LEARNING_RULES.minSamples });
    expect(pick()).toBe(ETA_LEARNING_RULES.maxFactor);
  });
});

describe('InMemoryEtaCorrectionsRepository', () => {
  const sample = (stopId: string, actualMin: number): EtaSampleRecord => ({
    stopId,
    tripId: 't1',
    cityId: 'aziziyah',
    fromZone: 'a',
    toZone: 'b',
    hourBucket: 11,
    vehicleClass: 'bike',
    basis: 'estimated',
    predictedMin: 5,
    actualMin,
    startedAt: new Date(NOON),
    arrivedAt: new Date(Date.parse(NOON) + actualMin * MIN),
  });
  const keys = lookupChain({ cityId: 'aziziyah', fromZone: 'a', toZone: 'b', hourBucket: 11, vehicleClass: 'bike', basis: 'estimated' });

  it('learns each stop once: a redelivered leg changes nothing', async () => {
    const repo = new InMemoryEtaCorrectionsRepository();
    expect(await repo.learn(sample('s1', 7.5), keys, 0.2)).toBe(true);
    expect(await repo.learn(sample('s1', 7.5), keys, 0.2)).toBe(false);
    expect(await repo.learn(sample('s2', 5), keys, 0.2)).toBe(true);
    const cells = await repo.cells('aziziyah');
    expect(cells).toHaveLength(4);
    for (const c of cells) {
      expect(c.samples).toBe(2);
      expect(c.factor).toBeCloseTo(1.5 + 0.2 * (1 - 1.5), 10);
    }
    expect(await repo.cells('kut')).toEqual([]);
  });
});

describe('EtaService × LearnedEtaCorrection', () => {
  let clock: FakeClock;
  let repo: InMemoryEtaCorrectionsRepository;

  beforeEach(() => {
    clock = new FakeClock(NOON);
    repo = new InMemoryEtaCorrectionsRepository();
  });

  async function teach(n: number, ratio: number, opts: { from?: string; to?: string; vehicle?: VehicleClass } = {}): Promise<void> {
    const leg = { cityId: 'aziziyah', fromZone: opts.from ?? 'centre', toZone: opts.to ?? 'qutniya', hourBucket: 11, vehicleClass: opts.vehicle ?? 'bike', basis: 'estimated' as const };
    for (let i = 0; i < n; i++) {
      await repo.learn({ ...leg, stopId: `s${opts.from ?? ''}${i}`, tripId: `t${i}`, predictedMin: 5, actualMin: 5 * ratio, startedAt: clock.now(), arrivedAt: clock.now() }, lookupChain(leg), ETA_LEARNING_RULES.alpha);
    }
  }

  it('resolves the seed zones the legs use', () => {
    expect(zones.locate(KITCHEN)).toEqual({ cityId: 'aziziyah', zoneId: 'centre' });
    expect(zones.zoneIn('aziziyah', DOOR)).toBe('qutniya');
    expect(zones.locate(OUTSIDE)).toBeNull();
  });

  it('changes nothing until a cell has minSamples legs, then multiplies the leg (basis unchanged)', async () => {
    const base = await new EtaService(router).minutes(KITCHEN, DOOR, 'bike');
    const eta = new EtaService(router, new LearnedEtaCorrection(repo, zones, clock));
    expect(await eta.minutes(KITCHEN, DOOR, 'bike')).toEqual(base);

    await teach(ETA_LEARNING_RULES.minSamples - 1, 1.5);
    expect(await new EtaService(router, new LearnedEtaCorrection(repo, zones, clock)).minutes(KITCHEN, DOOR, 'bike')).toEqual(base);

    await teach(ETA_LEARNING_RULES.minSamples, 1.5);
    const learned = await new EtaService(router, new LearnedEtaCorrection(repo, zones, clock)).minutes(KITCHEN, DOOR, 'bike');
    const exact = (await eta.baseMinutes(KITCHEN, DOOR, 'bike')).exactMinutes;
    expect(learned).toEqual({ minutes: Math.round(exact * 1.5), basis: 'estimated' });
    expect(learned.minutes).toBeGreaterThan(base.minutes);
    // baseMinutes stays the router's own (legs are judged against it); the promise locks the learned minutes at placement.
    expect(await eta.baseMinutes(KITCHEN, DOOR, 'bike')).toMatchObject({ minutes: base.minutes });
  });

  it('keeps cells per vehicle and per hour bucket; the city cell covers zone pairs not yet learned', async () => {
    await teach(ETA_LEARNING_RULES.minSamples, 1.4);
    const correction = new LearnedEtaCorrection(repo, zones, clock);
    expect(await correction.factor({ from: KITCHEN, to: DOOR, vehicle: 'car', basis: 'estimated' })).toBe(1);
    expect(await correction.factor({ from: KITCHEN, to: DOOR, vehicle: 'bike', basis: 'road' })).toBe(1);
    expect(await correction.factor({ from: KITCHEN, to: zone('nakra'), vehicle: 'bike', basis: 'estimated' })).toBeCloseTo(1.4, 10);
    expect(await correction.factor({ from: KITCHEN, to: OUTSIDE, vehicle: 'bike', basis: 'estimated' })).toBe(1);
    // 20:00 local is another bucket: the pair's all-day cell answers.
    clock.advance(8 * 60 * MIN);
    expect(await new LearnedEtaCorrection(repo, zones, clock).factor({ from: KITCHEN, to: DOOR, vehicle: 'bike', basis: 'estimated' })).toBeCloseTo(1.4, 10);
  });

  it('reuses a city’s cells for cacheMs, and forget() reads them again', async () => {
    const correction = new LearnedEtaCorrection(repo, zones, clock);
    expect(await correction.factor({ from: KITCHEN, to: DOOR, vehicle: 'bike', basis: 'estimated' })).toBe(1);
    await teach(ETA_LEARNING_RULES.minSamples, 1.5);
    expect(await correction.factor({ from: KITCHEN, to: DOOR, vehicle: 'bike', basis: 'estimated' })).toBe(1);
    correction.forget('aziziyah');
    expect(await correction.factor({ from: KITCHEN, to: DOOR, vehicle: 'bike', basis: 'estimated' })).toBeCloseTo(1.5, 10);
  });

  it('quotes uncorrected when the store cannot be read', async () => {
    const broken = { learn: async () => true, cells: async (): Promise<EtaCell[]> => Promise.reject(new Error('db down')) };
    const correction = new LearnedEtaCorrection(broken, zones, clock);
    expect(await correction.factor({ from: KITCHEN, to: DOOR, vehicle: 'bike', basis: 'estimated' })).toBe(1);
  });

  it('fromMany applies each source’s own factor', async () => {
    await teach(ETA_LEARNING_RULES.minSamples, 1.5, { from: 'centre', to: 'qutniya' });
    await teach(ETA_LEARNING_RULES.minSamples, 0.8, { from: 'nakra', to: 'qutniya' });
    const plain = await new EtaService(router).fromMany([KITCHEN, zone('nakra')], DOOR, 'bike');
    const learned = await new EtaService(router, new LearnedEtaCorrection(repo, zones, clock)).fromMany([KITCHEN, zone('nakra')], DOOR, 'bike');
    expect(learned[0]!.minutes).toBeGreaterThan(plain[0]!.minutes);
    expect(learned[1]!.minutes).toBeLessThanOrEqual(plain[1]!.minutes);
    expect(learned.every((m) => m?.basis === 'estimated')).toBe(true);
  });
});

describe('EtaLearner (trips + events in memory)', () => {
  /** Where the courier is when he accepts: about 2.2 km from the kitchen, a ~5 minute first leg. */
  const START = zone('nakra');

  function world() {
    const clock = new FakeClock(NOON);
    const mem = createInMemoryEvents({ clock, contradictions: false });
    const trips = new TripsService(new InMemoryTripsRepository(), new TripEventsAdapter(mem.events), mem.uow, clock, new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now()));
    trips.onModuleInit();
    trips.bindOfferCheck(new ScriptedOfferCheck());
    const repo = new InMemoryEtaCorrectionsRepository();
    const correction = new LearnedEtaCorrection(repo, zones, clock);
    const learner = new EtaLearner(trips, mem.events, new EtaService(router), repo, zones, correction);
    const outcomes: string[] = [];
    // The learner's own handler, wrapped to record what it decided for each arrival.
    mem.events.subscribe('test:eta-learn', ['stop.arrived'], async (e, ctx) => {
      outcomes.push(await learner.onStopArrived(e, ctx.tx));
    });
    return { clock, events: mem.events, trips, repo, correction, learner, outcomes };
  }

  type World = ReturnType<typeof world>;

  /** One delivery: accept at START, first fix after `fixDelayMs`, kitchen, 4 min wait, ride `rideMin` to the door. */
  async function deliver(
    w: World,
    orderId: string,
    opts: { rideMin?: number; fixDelayMs?: number; vertical?: Vertical; vehicle?: VehicleClass; doorPin?: LatLng; doorTapLagMs?: number } = {},
  ): Promise<string> {
    const t = await w.trips.createForOrders({
      cityId: 'aziziyah',
      vertical: opts.vertical ?? 'food',
      orders: [{ orderId, minVehicleClass: null }],
      stops: [
        { orderId, type: 'pickup', zoneKey: 'centre', target: KITCHEN },
        { orderId, type: 'dropoff', zoneKey: 'qutniya', target: DOOR },
      ],
    });
    await w.trips.offer(t.id, { driverIds: ['d1'] });
    const accepted = await w.trips.accept(t.id, 'd1', { vehicleClass: opts.vehicle ?? 'bike' });
    const [pickup, dropoff] = accepted.stops;
    w.clock.advance(opts.fixDelayMs ?? 10_000);
    await w.trips.reportPosition('d1', { tripId: t.id, pin: START, at: w.clock.now() });
    w.clock.advance(7 * MIN);
    await w.trips.arrive(t.id, pickup!.id, 'd1', { pin: KITCHEN });
    w.clock.advance(4 * MIN);
    await w.trips.completeStop(t.id, pickup!.id, 'd1');
    w.clock.advance((opts.rideMin ?? 7.5) * MIN);
    const lag = opts.doorTapLagMs;
    await w.trips.arrive(t.id, dropoff!.id, 'd1', { pin: opts.doorPin ?? DOOR, ...(lag !== undefined ? { occurredAt: new Date(w.clock.now().getTime() - lag) } : {}) });
    await w.trips.completeStop(t.id, dropoff!.id, 'd1');
    w.clock.advance(5 * MIN);
    return t.id;
  }

  it('learns the first leg from the first fix and the kitchen → door leg from the pickup', async () => {
    const w = world();
    await deliver(w, 'ord_1');
    expect(w.outcomes).toEqual(['learned', 'learned']);
    const cells = await w.repo.cells('aziziyah');
    const ride = cells.find((c) => c.fromZone === 'centre' && c.toZone === 'qutniya' && c.hourBucket === 11);
    const predicted = (await new EtaService(router).baseMinutes(KITCHEN, DOOR, 'bike')).exactMinutes;
    expect(ride).toMatchObject({ samples: 1, vehicleClass: 'bike', basis: 'estimated' });
    expect(ride!.factor).toBeCloseTo(7.5 / predicted, 10);
    expect(cells.find((c) => c.fromZone === 'nakra' && c.toZone === 'centre')?.samples).toBe(1);
    // Both legs feed the city cells.
    expect(cells.find((c) => c.fromZone === ANY_ZONE && c.hourBucket === ALL_DAY)?.samples).toBe(2);
  });

  it('a redelivered arrival is not counted twice; a quarantined one is ignored', async () => {
    const w = world();
    const tripId = await deliver(w, 'ord_1');
    const arrivals = (await w.events.forTrip(tripId)).filter((e) => e.type === 'stop.arrived');
    expect(arrivals).toHaveLength(2);
    for (const e of arrivals) expect(await w.learner.onStopArrived(e)).toBe('duplicate');
    expect(await w.learner.onStopArrived({ ...arrivals[1]!, quarantined: true })).toBe('quarantined');
    for (const c of await w.repo.cells('aziziyah')) expect(c.samples).toBeLessThanOrEqual(2);
  });

  it('skips a first leg without a fix near the acceptance', async () => {
    const w = world();
    await deliver(w, 'ord_1', { fixDelayMs: ETA_LEARNING_RULES.firstFixMaxDelayMs + 60_000 });
    expect(w.outcomes).toEqual(['no_leg_start', 'learned']);
  });

  it('skips taps outside the geofence, taps queued offline, outliers, and الرجعة', async () => {
    const outside = world();
    await deliver(outside, 'ord_1', { doorPin: { lat: DOOR.lat + 0.003, lng: DOOR.lng } });
    expect(outside.outcomes[1]).toBe('outside_geofence');

    const offline = world();
    await deliver(offline, 'ord_1', { doorTapLagMs: ETA_LEARNING_RULES.maxTapDelayMs + 60_000 });
    expect(offline.outcomes[1]).toBe('late_tap');

    const lunch = world();
    await deliver(lunch, 'ord_1', { rideMin: 45 });
    expect(lunch.outcomes[1]).toBe('outlier');

    const intercity = world();
    await deliver(intercity, 'ord_1', { vertical: 'intercity', vehicle: 'car' });
    expect(intercity.outcomes).toEqual(['not_learnable_vertical', 'not_learnable_vertical']);
    expect(await intercity.repo.cells('aziziyah')).toEqual([]);
  });

  it('after minSamples slow rides the kitchen → door ETA grows; before, it is the router’s', async () => {
    const w = world();
    const eta = new EtaService(router, w.correction);
    const base = await new EtaService(router).minutes(KITCHEN, DOOR, 'bike');
    // Every ride takes 7.2 min where the straight line says ~5.1: the cell settles at 7.2 / 5.1. Only
    // the rides teach here (no fix near the acceptance), so the city cells fill no faster than the pair's.
    const ride = { rideMin: 7.2, fixDelayMs: ETA_LEARNING_RULES.firstFixMaxDelayMs + 60_000 };
    for (let i = 1; i < ETA_LEARNING_RULES.minSamples; i++) await deliver(w, `ord_${i}`, ride);
    w.clock.set(new Date(NOON));
    expect(await eta.minutes(KITCHEN, DOOR, 'bike')).toEqual(base);
    await deliver(w, 'ord_last', ride);
    w.clock.set(new Date(NOON));
    const learned = await eta.minutes(KITCHEN, DOOR, 'bike');
    expect(learned.basis).toBe('estimated');
    expect(learned.minutes).toBe(7);
    expect(learned.minutes).toBeGreaterThan(base.minutes);
  });
});
