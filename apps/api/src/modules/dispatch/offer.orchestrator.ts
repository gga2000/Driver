import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AZIZIYAH_MONEY_RULES,
  bookedFallbackCompensationIqd,
  bookedFavouriteUntil,
  bookedRideWindow,
  CLIMATE_DISPATCH_RULES,
  climateAt,
  DriverError,
  NUDGE_RULES,
  RIDE_HABIT_RULES,
  rideSearchStartsAt,
  type BoardPolicy,
  type DispatchBoard,
  type DispatchConfig,
  type DispatchPolicyKind,
  type DispatchStatus,
  type MoneyRules,
  type PartnerBookedAnswer,
  type VehicleFeature,
  type Vertical,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import type { Queue } from '../../shared/queue.js';
import type { TimerStore, TimerSweeper } from '../../shared/timers/index.js';
import { ConfigService } from '../config/index.js';
import { MONEY_RULES } from '../ledger/index.js';
import { vehicleFits } from '../trips/index.js';
import { canBatch, type BatchOrder } from './batching.js';
import { bookedStep, isHeld, newBookedJob, openTo, type BookedJob } from './booked.js';
import { buildCard, sortCards } from './board.js';
import { DISPATCH_REPOSITORY, OPEN_STATES, type DispatchRepository, type NewOffer, type OfferRecord } from './dispatch.repository.js';
import { bookedLockKey, DISPATCH_STORE, lockKey, type DispatchRequest, type DispatchStore, type PolicyOverride } from './dispatch.store.js';
import type { LiveJobs } from './driver-pins.js';
import { DISPATCH_EVENTS, type DispatchEventEmitter } from './events.adapter.js';
import { etaMin, haversineKm } from './geo.js';
import { CITY_RADIUS_KM, type DriverPresence } from './geo-index.js';
import { DEFAULT_WAVES } from './policies.js';
import type { DispatchJob } from './policy.js';
import { CAPS, DEPARTURES, DISPATCH_HOLDS, TRIP_OFFERS, type CapsPort, type DeparturesPort, type DispatchHoldsPort, type JobExposure, type RiderPrefsPort, type TripOffersPort } from './ports.js';
import { PresenceService } from './presence.service.js';
import { climateFeature, DriverRanker, familyFit, preferFirst, type RankedDriver } from './ranker.js';
import { VEHICLE_FACTS, type VehicleFactsPort } from './vehicle-facts.js';
import { batchLimit, vehicleFit } from './vehicles.js';
import { ZoneDirectory } from './zones.js';

/** Timer jobs on the `dispatch` queue (BullMQ delayed jobs in production). */
export type TimerKind =
  | 'wave_end'
  | 'rebroadcast'
  | 'free_cancel'
  | 'assign_start'
  | 'assign_timeout'
  | 'route_driver_timeout'
  | 'sub_wave_end'
  | 'override_timeout'
  | 'low_fill_check'
  | 'broadcast_start'
  | 'favourite_end'
  | 'booked_open'
  | 'booked_fav_end'
  | 'booked_deadline'
  | 'booked_remind';

export interface TimerJob {
  kind: TimerKind;
  tripId: string;
  /** Timers from an older epoch are ignored (override, cancel and assignment bump it). */
  epoch: number;
  /** Wave or pass the timer belongs to. */
  step: number;
  /** Also written to the durable timer table (`bindDurableTimers`): marked fired there once it ran. */
  durable?: true;
}

/**
 * Timers due this far ahead (rides booked for later, scheduled departures) also get a row in
 * `scheduled_timers`, so losing their Redis job (a restart, a wiped Redis) only delays them; short wave
 * timers stay Redis-only (they are many, and a lost one is caught by the next wave or the dispatcher).
 */
export const DURABLE_TIMER_MIN_DELAY_MS = 5 * 60_000;
/** The durable copy is due this long after the Redis job, so it fires only when that job did not run. */
export const DURABLE_TIMER_GRACE_MS = 60_000;

export const DISPATCH_QUEUE = Symbol('DISPATCH_QUEUE');

/**
 * Joy l9: the offer a rider's favourite driver gets alone, for `RIDE_HABIT_RULES.favourite.offerWindowSec`,
 * when the search for his booked ride starts (wave 0, before the normal waves).
 */
export const FAVOURITE_OFFER_POLICY = 'favourite';
/**
 * Review #28: the confirmed driver of a booked ride starts it (his tap from T−60, or dispatch at T−30):
 * a one-driver offer accepted on his behalf — he confirmed it the evening before.
 */
export const BOOKED_OFFER_POLICY = 'booked';
export const DISPATCH_QUEUE_NAME = 'dispatch';

/** The first-accept lock is the assignment claim; it outlives any trip. */
const LOCK_TTL_MS = 24 * 3600 * 1000;
const SYSTEM = 'system';
/** A ride still looking for its driver: the rider may watch the offered drivers and nudge one (ride step 3). */
const SEARCHING: ReadonlySet<DispatchStatus> = new Set(['searching', 'rebroadcast', 'awaiting_dispatcher', 'needs_dispatcher']);
const RIDE_VERTICALS: ReadonlySet<Vertical> = new Set(['taxi', 'tuktuk']);

interface Candidate {
  ranked: RankedDriver;
  presence: DriverPresence;
  jobs: string[];
}

interface CandidateFilter {
  radiusKm?: number;
  exclude?: ReadonlySet<string>;
  /** Rides and broadcasts go to idle drivers only; auto_assign may batch onto busy couriers. */
  requireIdle: boolean;
  onlyVetted?: boolean;
  only?: readonly string[] | null;
}

export type DispatchRequestInput = DispatchJob;

/** A booked ride as the Partner app's «مشاوير باچر» needs it (review #28). */
export interface BookedJobInfo {
  request: DispatchRequest;
  job: BookedJob;
  /** He may start toward the pickup from here (the reminder, T−60). */
  startFrom: Date;
  /** It starts for him then if he is online and free, or goes to someone else (T−30). */
  showBy: Date;
  /** The rider asked for him. */
  favourite: boolean;
}

/** A booked ride's pre-assignment as its rider's view needs it (review #28). */
export interface BookedRideInfo {
  job: BookedJob | null;
  scheduledFor: Date;
  searchAt: Date;
}

/**
 * The offer lifecycle (plan Step 5, dispatch & pricing spec §3, edge-case decisions §6).
 *
 * smart_broadcast: waves 3 / 1.5 km / 15 s → 5 / 3 km / 15 s → all / 30 s, first accept wins
 *   (SET NX lock). At 60 s with no accept: red card and a city-wide re-broadcast; +500 pickup
 *   compensation only to drivers who were not in waves 1–2, and drivers who ignored the offer
 *   (seen ≥ 3 s, no answer) or declined it are excluded for that trip. At 180 s the customer may
 *   cancel free and the card goes to the dispatcher.
 * auto_assign: one courier at a time, starting at readyAt − (ETA + 2 min); 20 s to accept; 3
 *   passes then the dispatcher. Busy couriers are considered when the batch rules allow.
 * scheduled: low-fill check at T−30 (< 3 seats incl. walk-ups → cancelled_low_fill).
 * pre_assigned: the route driver first, else a substitute auction of 2 waves × 3 vetted × 5 min,
 *   then the dispatcher.
 * Suggest-only (config or runtime override) sends nothing to drivers: the dispatcher decides.
 *
 * Every timer is a delayed queue job carrying the request epoch, so stale timers are no-ops.
 */
@Injectable()
export class OfferOrchestrator {
  private readonly ranker: DriverRanker;

  /** Ride step 3: the rider's avoid list, favourites and drivers' standing (bound by ride habits). */
  private riders: RiderPrefsPort | null = null;

  private timers: TimerStore | null = null;
  private readonly rules: MoneyRules;

  constructor(
    private readonly config: ConfigService,
    private readonly presence: PresenceService,
    private readonly zones: ZoneDirectory,
    @Inject(DISPATCH_REPOSITORY) private readonly repo: DispatchRepository,
    @Inject(DISPATCH_STORE) private readonly store: DispatchStore,
    @Inject(DISPATCH_EVENTS) private readonly events: DispatchEventEmitter,
    @Inject(TRIP_OFFERS) private readonly trips: TripOffersPort,
    @Inject(CAPS) private readonly caps: CapsPort,
    @Inject(DEPARTURES) private readonly departures: DeparturesPort,
    @Inject(DISPATCH_QUEUE) private readonly queue: Queue<TimerJob>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    @Optional() ranker?: DriverRanker,
    @Optional() @Inject(DISPATCH_HOLDS) private readonly holds?: DispatchHoldsPort,
    /** Ride step 3: confirmed car features for n6 (weather) and s6 («عوائل»); without it nobody is preferred. */
    @Optional() @Inject(VEHICLE_FACTS) private readonly facts?: VehicleFactsPort,
    @Optional() @Inject(MONEY_RULES) rules?: MoneyRules,
  ) {
    this.ranker = ranker ?? new DriverRanker();
    this.rules = rules ?? AZIZIYAH_MONEY_RULES;
    this.queue.process(async (job) => {
      await this.onTimer(job.data);
      // Ran on time: its durable copy must not run again (it only waits for a lost Redis job).
      if (job.data.durable && this.timers) await this.timers.markFired(DISPATCH_QUEUE_NAME, job.id, this.clock.now());
    });
  }

  /**
   * NTF-05: far-ahead timers (the T−30 `broadcast_start` of a ride booked for later, its offer and
   * reminder timers, a departure's start and low-fill check) are also kept in the durable timer table,
   * and the timer sweeper fires them through `onTimer` when their Redis job was lost. Every handler
   * checks the request's state and epoch, so a late or second run changes nothing.
   */
  bindDurableTimers(store: TimerStore, sweeper: TimerSweeper | null): void {
    this.timers = store;
    sweeper?.register<TimerJob>(DISPATCH_QUEUE_NAME, (job) => this.onTimer(job.data));
  }

  /** The ride-habits module binds the rider's preferences at start-up (it imports this module). */
  bindRiders(port: RiderPrefsPort): void {
    this.riders = port;
  }

  // ───────────────────────── config & policy ─────────────────────────

  baseConfig(cityId: string, vertical: Vertical): DispatchConfig {
    const cfg = this.config.dispatchFor(cityId, vertical);
    if (!cfg) throw new DriverError('dispatch_not_found');
    return cfg;
  }

  /** City config with the runtime override (setPolicy) applied on top. */
  async effectiveConfig(cityId: string, vertical: Vertical): Promise<{ cfg: DispatchConfig; override: PolicyOverride | null }> {
    const base = this.baseConfig(cityId, vertical);
    const override = await this.store.getPolicyOverride(cityId, vertical);
    if (!override) return { cfg: base, override: null };
    return {
      cfg: { ...base, policy: override.policy ?? base.policy, suggestOnly: override.suggestOnly ?? base.suggestOnly },
      override,
    };
  }

  async setPolicy(actorId: string, input: { cityId: string; vertical: Vertical; policy?: DispatchPolicyKind; suggestOnly?: boolean; clear?: boolean }): Promise<BoardPolicy> {
    this.baseConfig(input.cityId, input.vertical);
    return this.uow.run(async () => {
      const prev = await this.store.getPolicyOverride(input.cityId, input.vertical);
      const next: PolicyOverride | null = input.clear
        ? null
        : {
            ...(prev ?? {}),
            ...(input.policy !== undefined ? { policy: input.policy } : {}),
            ...(input.suggestOnly !== undefined ? { suggestOnly: input.suggestOnly } : {}),
            setBy: actorId,
            setAt: this.now(),
          };
      await this.store.setPolicyOverride(input.cityId, input.vertical, next);
      const { cfg } = await this.effectiveConfig(input.cityId, input.vertical);
      await this.events.emit(
        undefined,
        {
          actorId,
          type: 'dispatch.policy_changed',
          occurredAt: this.clock.now(),
          payload: { cityId: input.cityId, vertical: input.vertical, policy: cfg.policy, suggestOnly: cfg.suggestOnly, cleared: Boolean(input.clear) },
        },
        { name: 'city', id: input.cityId },
      );
      return { vertical: input.vertical, policy: cfg.policy, suggestOnly: cfg.suggestOnly, overridden: next !== null };
    });
  }

  // ───────────────────────── request ─────────────────────────

  /** Starts dispatch for a trip. Idempotent: a live request for the trip is returned as is. */
  async request(job: DispatchRequestInput): Promise<DispatchRequest> {
    const existing = await this.store.getRequest(job.tripId);
    if (existing && existing.status !== 'cancelled') return existing;
    const { cfg: base } = await this.effectiveConfig(job.cityId, job.vertical);
    // Launch kill switch with "hold dispatch": no automatic offers in that vertical / zone, the
    // dispatcher decides (suggest-only). Seat low-fill checks are not offers and keep running.
    const held = base.policy !== 'scheduled' && !base.suggestOnly && ((await this.holds?.dispatchHeld({ cityId: job.cityId, vertical: job.vertical, zoneId: job.zoneId })) ?? false);
    const cfg = held ? { ...base, suggestOnly: true } : base;
    const pickup = job.pickup ?? this.zones.centre(job.cityId, job.zoneId);
    if (!pickup) throw new DriverError('invalid_input');
    const now = this.now();
    const r: DispatchRequest = {
      tripId: job.tripId,
      cityId: job.cityId,
      vertical: job.vertical,
      policy: cfg.policy,
      suggestOnly: cfg.suggestOnly,
      zoneId: job.zoneId,
      dropoffZoneId: job.dropoffZoneId ?? null,
      pickup,
      status: 'searching',
      createdAt: now,
      searchStartedAt: null,
      wave: 0,
      pass: 0,
      epoch: (existing?.epoch ?? 0) + 1,
      nextTimerAt: null,
      red: false,
      compensationActive: false,
      customerMayCancelFree: false,
      assignedDriverId: null,
      compensationIqd: 0,
      suggestion: [],
      readyAt: job.readyAt?.getTime() ?? null,
      hot: job.hot ?? false,
      batchWith: [],
      departAt: null,
      pickedUp: false,
      minVehicleClass: job.minVehicleClass ?? null,
      cashIqd: job.cashIqd ?? 0,
      routeId: job.routeId ?? null,
      routeDriverId: job.routeDriverId ?? null,
      departureId: job.departureId ?? null,
      departureAt: job.departureAt?.getTime() ?? null,
      eligibleDriverIds: job.eligibleDriverIds ?? null,
      startAt: job.startAt?.getTime() ?? null,
      preferDriverIds: job.preferDriverIds ? [...job.preferDriverIds] : [],
      riderId: job.riderId ?? null,
      orderId: job.orderId ?? null,
      familyPreferred: job.familyPreferred ?? false,
      // s5 / s4: read once when the search is asked for; a rider's ride never reaches a driver he avoids.
      ...(await this.riderLists(job)),
      scheduledFor: job.scheduledFor?.getTime() ?? null,
      booked: null,
      fallbackCompensationIqd: 0,
    };

    return this.uow.run(async () => {
      await this.emit('dispatch.requested', r, { policy: r.policy, suggestOnly: r.suggestOnly, zoneId: r.zoneId });

      if (r.policy === 'scheduled') {
        // Low fill is about seats, not drivers: suggest-only does not apply.
        if (r.departureAt === null || r.departureId === null) throw new DriverError('invalid_input');
        // The owner (routes) says when low fill may cancel it (decision 2026-10-04); T−30 otherwise.
        const checkAt = (await this.departures.lowFillCheckAt?.(r.departureId))?.getTime() ?? r.departureAt - 30 * 60_000;
        r.status = 'scheduled';
        r.nextTimerAt = checkAt;
        await this.store.saveRequest(r);
        await this.schedule('low_fill_check', r, checkAt, 0);
        return r;
      }

      if (r.suggestOnly) {
        const ranked = await this.candidates(r, cfg, { requireIdle: r.policy === 'smart_broadcast' });
        r.status = 'awaiting_dispatcher';
        r.searchStartedAt = now;
        r.suggestion = ranked.slice(0, 8).map((c) => c.ranked.driverId);
        await this.store.saveRequest(r);
        await this.emit('dispatch.suggested', r, { driverIds: r.suggestion });
        return r;
      }

      switch (r.policy) {
        case 'smart_broadcast': {
          // Joy J7d: a ride booked for later waits, on the board as «مجدول», until its search starts.
          if (r.startAt != null && r.startAt > now) {
            r.status = 'scheduled';
            r.nextTimerAt = r.startAt;
            // Review #28: offered the evening before to fitting drivers; the T−30 search is the fallback.
            r.booked = this.bookedPlan(job, cfg, now);
            r.fallbackCompensationIqd = bookedFallbackCompensationIqd(this.rules);
            await this.store.saveRequest(r);
            await this.schedule('broadcast_start', r, r.startAt, 0);
            if (r.booked) await this.scheduleBooked(r, r.booked, cfg);
            break;
          }
          await this.beginBroadcast(r, cfg);
          break;
        }
        case 'auto_assign': {
          const startAt = await this.autoAssignStartAt(r, cfg);
          if (startAt <= now) {
            r.searchStartedAt = now;
            await this.startPass(r, cfg, 1);
          } else {
            r.status = 'scheduled';
            r.nextTimerAt = startAt;
            await this.store.saveRequest(r);
            await this.schedule('assign_start', r, startAt, 0);
          }
          break;
        }
        case 'pre_assigned': {
          r.searchStartedAt = now;
          await this.offerRouteDriver(r, cfg);
          break;
        }
      }
      return (await this.store.getRequest(r.tripId)) ?? r;
    });
  }

  // ───────────────────────── smart_broadcast ─────────────────────────

  /**
   * The search starts. Joy l9: a booked ride that asked for the rider's favourite offers it to him
   * alone first (wave 0, `favourite`, one minute) when he is online, idle and eligible like anyone
   * else; otherwise — or once he declines or lets it ring out — the normal waves start with their
   * usual timers, exactly as for any ride.
   */
  private async beginBroadcast(r: DispatchRequest, cfg: DispatchConfig): Promise<void> {
    // Review #28: a favourite who dropped the booked job (or didn't show) is not asked first again.
    const dropped = r.booked?.releasedBy ?? [];
    const prefer = (r.preferDriverIds ?? []).filter((d) => !dropped.includes(d));
    const favourites = (r.favouriteDriverIds ?? []).filter((d) => !dropped.includes(d));
    if (prefer.length > 0) {
      const chosen = await this.candidates(r, cfg, { requireIdle: true, only: prefer });
      if (chosen.length > 0) return this.offerFavourite(r, chosen, false);
    } else if (favourites.length > 0) {
      // s4: no favourite asked for, but one of his favourites is free close by — he gets it first, alone.
      const near = await this.candidates(r, cfg, { requireIdle: true, only: favourites, radiusKm: RIDE_HABIT_RULES.favourite.autoFirstKm });
      if (near.length > 0) return this.offerFavourite(r, near.slice(0, 1), true);
    }
    await this.startWaves(r, cfg);
  }

  /** Wave 0: the favourite rings alone for `offerWindowSec`; then (or on his no) the normal waves. */
  private async offerFavourite(r: DispatchRequest, chosen: readonly Candidate[], auto: boolean): Promise<void> {
    const seconds = RIDE_HABIT_RULES.favourite.offerWindowSec;
    const expiresAt = this.now() + seconds * 1000;
    const ids = chosen.map((c) => c.ranked.driverId);
    r.status = 'searching';
    r.searchStartedAt = this.now();
    r.wave = 0;
    r.pass = 0;
    r.nextTimerAt = expiresAt;
    await this.createOffers(r, FAVOURITE_OFFER_POLICY, chosen, { wave: 0, pass: 0, expiresAt, compensation: () => r.fallbackCompensationIqd ?? 0 });
    await this.trips.offer(r.tripId, ids, seconds);
    await this.emit('dispatch.wave_sent', r, { wave: 0, driverIds: ids, seconds, radiusKm: auto ? RIDE_HABIT_RULES.favourite.autoFirstKm : null, favourite: true, ...(auto ? { auto: true } : {}) });
    await this.store.saveRequest(r);
    await this.schedule('favourite_end', r, expiresAt, 0);
  }

  /** The smart broadcast proper: re-broadcast and free-cancel clocks from now, then wave 1. */
  private async startWaves(r: DispatchRequest, cfg: DispatchConfig): Promise<void> {
    const now = this.now();
    r.status = 'searching';
    r.searchStartedAt = now;
    await this.store.saveRequest(r);
    await this.schedule('rebroadcast', r, now + cfg.rebroadcastAfterSec * 1000, 0);
    await this.schedule('free_cancel', r, now + cfg.customerFreeCancelAfterSec * 1000, 0);
    await this.sendWave(r, cfg, 0);
  }

  /** The favourite's minute is over without an answer: his offer times out and the waves start. */
  private async onFavouriteEnd(r: DispatchRequest): Promise<void> {
    if (r.status !== 'searching' || r.pass !== 0) return;
    await this.expireOpen(r, (o) => o.policy === FAVOURITE_OFFER_POLICY);
    await this.startWaves(r, this.baseConfig(r.cityId, r.vertical));
  }

  private async sendWave(r: DispatchRequest, cfg: DispatchConfig, index: number): Promise<void> {
    const waves = cfg.waves ?? DEFAULT_WAVES;
    const rebroadcastAt = (r.searchStartedAt ?? r.createdAt) + cfg.rebroadcastAfterSec * 1000;
    for (let i = index; i < waves.length; i += 1) {
      const w = waves[i]!;
      const offered = new Set((await this.repo.listByTrip(r.tripId)).map((o) => o.driverId));
      const all = await this.candidates(r, cfg, { requireIdle: true, exclude: offered, ...(w.radiusKm !== undefined ? { radiusKm: w.radiusKm } : {}) });
      // x1: on a hot (cold) day a car ride's first waves go only to cars with working AC (heating); an
      // empty one opens the next at once, and the last wave is always everyone's.
      const climate = i < Math.min(CLIMATE_DISPATCH_RULES.onlyWaves, waves.length - 1) ? await this.climateOnly(r, all) : null;
      const pool = climate?.drivers ?? all;
      // s6 «عوائل»: the first wave only to family-fit drivers when any is free; everyone from the second.
      const family = i === 0 && r.familyPreferred ? await this.familyFit(pool) : [];
      const ranked = family.length > 0 ? family : pool;
      const chosen = w.size === 'all' ? ranked : ranked.slice(0, w.size);
      r.wave = i + 1;
      r.pass = 1;
      // An empty wave does not wait out its window: the next, wider wave opens at once.
      if (chosen.length === 0) continue;
      const expiresAt = this.now() + w.seconds * 1000;
      await this.createOffers(r, 'smart_broadcast', chosen, { wave: i + 1, pass: 1, expiresAt, compensation: () => r.fallbackCompensationIqd ?? 0 });
      await this.trips.offer(r.tripId, chosen.map((c) => c.ranked.driverId), w.seconds);
      await this.emit('dispatch.wave_sent', r, { wave: i + 1, driverIds: chosen.map((c) => c.ranked.driverId), seconds: w.seconds, radiusKm: w.radiusKm ?? null, ...(climate ? { only: climate.feature } : {}) });
      r.nextTimerAt = expiresAt;
      await this.store.saveRequest(r);
      await this.schedule('wave_end', r, expiresAt, i + 1);
      return;
    }
    // Every wave sent (or empty): wait for the re-broadcast at 60 s.
    r.nextTimerAt = rebroadcastAt;
    await this.store.saveRequest(r);
  }

  private async onWaveEnd(r: DispatchRequest, wave: number): Promise<void> {
    if (r.status !== 'searching' || r.pass !== 1 || r.wave !== wave) return;
    const cfg = this.baseConfig(r.cityId, r.vertical);
    await this.expireOpen(r, (o) => o.pass === 1 && o.wave === wave);
    await this.sendWave(r, cfg, wave);
  }

  /**
   * Edge-case §6. Re-broadcast to every eligible driver in the city except those who declined or
   * ignored (seen ≥ 3 s, then let it time out). +500 only for drivers who were not in waves 1–2;
   * wave 1–2 drivers who never saw the offer may get it again, without compensation.
   */
  private async onRebroadcast(r: DispatchRequest): Promise<void> {
    if (r.status !== 'searching') return;
    const cfg = this.baseConfig(r.cityId, r.vertical);
    await this.expireOpen(r, () => true);
    const offers = await this.repo.listByTrip(r.tripId);
    const inWaves12 = new Set(offers.filter((o) => o.pass === 1 && (o.wave === 1 || o.wave === 2)).map((o) => o.driverId));
    const excluded = new Set(offers.filter(isDeclinedOrIgnored).map((o) => o.driverId));
    const ranked = await this.candidates(r, cfg, { requireIdle: true, exclude: excluded });
    const compensation = (driverId: string) => Math.max(inWaves12.has(driverId) ? 0 : cfg.rebroadcastCompensationIqd, r.fallbackCompensationIqd ?? 0);
    const expiresAt = (r.searchStartedAt ?? r.createdAt) + cfg.customerFreeCancelAfterSec * 1000;

    r.status = 'rebroadcast';
    r.red = true;
    r.pass = 2;
    r.wave = 1;
    r.compensationActive = cfg.rebroadcastCompensationIqd > 0;
    r.nextTimerAt = expiresAt;
    if (ranked.length > 0) {
      await this.createOffers(r, 'smart_broadcast', ranked, { wave: 1, pass: 2, expiresAt, compensation });
      await this.trips.offer(r.tripId, ranked.map((c) => c.ranked.driverId), Math.round((expiresAt - this.now()) / 1000));
    }
    await this.store.saveRequest(r);
    await this.emit('dispatch.rebroadcast', r, {
      driverIds: ranked.map((c) => c.ranked.driverId),
      compensated: ranked.map((c) => c.ranked.driverId).filter((id) => compensation(id) > 0),
      compensationIqd: cfg.rebroadcastCompensationIqd,
      excluded: [...excluded].sort(),
    });
  }

  private async onFreeCancel(r: DispatchRequest): Promise<void> {
    if (r.status !== 'searching' && r.status !== 'rebroadcast') return;
    await this.expireOpen(r, () => true);
    r.customerMayCancelFree = true;
    // NTF-04: carries the order so the rider hears «ما لگينا سايق هسة» with his choices.
    await this.emit('dispatch.free_cancel_available', r, { afterSec: Math.round((this.now() - (r.searchStartedAt ?? r.createdAt)) / 1000), ...(r.orderId ? { orderId: r.orderId } : {}) });
    await this.needsDispatcher(r, 'no_acceptance');
  }

  // ───────────────────────── auto_assign ─────────────────────────

  /** Spec §3: courier timed to arrive ~2 min before `ready`: start at readyAt − (ETA of the nearest eligible courier + 2 min). */
  private async autoAssignStartAt(r: DispatchRequest, cfg: DispatchConfig): Promise<number> {
    const now = this.now();
    if (r.readyAt === null) return now;
    const cands = await this.candidates(r, cfg, { requireIdle: false });
    const eta = cands.length === 0 ? 0 : Math.min(...cands.map((c) => etaMin(c.presence, r.pickup)));
    // Whole milliseconds: a fractional start time would never be reached by a millisecond clock.
    return Math.max(now, Math.ceil(r.readyAt - (eta + cfg.arriveBeforeReadyMin) * 60_000));
  }

  /**
   * The order is ready early: an auto-assign request still waiting for its timed start begins its
   * first pass now, with `readyAt` moved to now (the batching and ETA rules read it). Anything else
   * (already searching, assigned, suggest-only, scheduled departures) is left alone.
   */
  async readyNow(tripId: string): Promise<void> {
    const r = await this.store.getRequest(tripId);
    if (!r || r.status !== 'scheduled' || r.policy !== 'auto_assign') return;
    await this.uow.run(async () => {
      const now = this.now();
      r.readyAt = Math.min(r.readyAt ?? now, now);
      r.searchStartedAt = now;
      await this.startPass(r, this.baseConfig(r.cityId, r.vertical), 1);
    });
  }

  private async startPass(r: DispatchRequest, cfg: DispatchConfig, pass: number): Promise<void> {
    if (pass > cfg.passes) {
      await this.needsDispatcher(r, 'passes_exhausted');
      return;
    }
    r.status = 'searching';
    r.pass = pass;
    r.wave = 1;
    r.searchStartedAt ??= this.now();
    const offered = new Set((await this.repo.listByTrip(r.tripId)).map((o) => o.driverId));
    const cands = await this.candidates(r, cfg, { requireIdle: false, exclude: offered });
    const expiresAt = this.now() + cfg.acceptTimeoutSec * 1000;
    r.nextTimerAt = expiresAt;

    const next: BatchOrder = {
      tripId: r.tripId,
      pickup: r.pickup,
      dropoffZoneId: r.dropoffZoneId ?? r.zoneId,
      readyAt: new Date(r.readyAt ?? this.now()),
      hot: r.hot,
    };
    for (const c of cands) {
      let batchWith: string[] = [];
      let departAt: number | null = null;
      if (c.jobs.length > 0) {
        const current = await this.batchOrders(c.jobs, c.ranked.driverId);
        if (!current) continue;
        const verdict = canBatch(
          current,
          next,
          { maxBatch: batchLimit(c.presence.vehicle, cfg.maxBatch), maxDetourMin: cfg.batchMaxDetourMin, maxHotWaitMin: cfg.batchMaxHotWaitMin },
          { now: this.clock.now(), courierAt: c.presence, isAdjacent: (a, b) => this.zones.adjacent(r.cityId, a, b) },
        );
        if (!verdict.ok) continue;
        batchWith = c.jobs;
        departAt = verdict.departAt.getTime();
      }
      r.batchWith = batchWith;
      r.departAt = departAt;
      await this.createOffers(r, 'auto_assign', [c], { wave: 1, pass, expiresAt, compensation: () => 0 });
      await this.trips.offer(r.tripId, [c.ranked.driverId], cfg.acceptTimeoutSec);
      await this.emit('dispatch.offer_sent', r, { driverId: c.ranked.driverId, pass, batchWith, departAt: departAt === null ? null : new Date(departAt).toISOString() });
      break;
    }
    // A pass with nobody to offer still waits its 20 s: couriers free up.
    await this.store.saveRequest(r);
    await this.schedule('assign_timeout', r, expiresAt, pass);
  }

  /**
   * The courier's current orders as batching sees them, in the order he works them (trips' `jobOrder`,
   * the order he took them — the route the partner app and the simulator follow); null when one of them
   * is not batchable (e.g. a ride).
   */
  private async batchOrders(tripIds: string[], driverId: string): Promise<BatchOrder[] | null> {
    const order = (await this.trips.jobOrder?.(driverId)) ?? [];
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    const out: BatchOrder[] = [];
    for (const id of [...tripIds].sort((a, b) => rank(a) - rank(b))) {
      const job = await this.store.getRequest(id);
      if (!job || job.policy !== 'auto_assign' || job.readyAt === null) return null;
      out.push({ tripId: id, pickup: job.pickup, dropoffZoneId: job.dropoffZoneId ?? job.zoneId, readyAt: new Date(job.readyAt), hot: job.hot, pickedUp: job.pickedUp });
    }
    return out;
  }

  private async onAssignTimeout(r: DispatchRequest, pass: number): Promise<void> {
    if (r.status !== 'searching' || r.pass !== pass) return;
    const cfg = this.baseConfig(r.cityId, r.vertical);
    await this.expireOpen(r, (o) => o.pass === pass);
    await this.startPass(r, cfg, pass + 1);
  }

  // ───────────────────────── pre_assigned ─────────────────────────

  private async offerRouteDriver(r: DispatchRequest, cfg: DispatchConfig): Promise<void> {
    const driverId = r.routeDriverId;
    const p = driverId ? await this.presence.get(driverId) : null;
    if (!driverId || !p || (await this.caps.isOverCap(driverId))) {
      await this.openSubstituteWave(r, cfg, 1);
      return;
    }
    const expiresAt = this.now() + cfg.acceptTimeoutSec * 1000;
    r.status = 'searching';
    r.pass = 1;
    r.wave = 0;
    r.nextTimerAt = expiresAt;
    const c: Candidate = { ranked: { driverId, distanceKm: 0, activeTrips: 0, tier: p.tier, score: 0 }, presence: p, jobs: [] };
    await this.createOffers(r, 'pre_assigned', [c], { wave: 0, pass: 1, expiresAt, compensation: () => 0 });
    await this.trips.offer(r.tripId, [driverId], cfg.acceptTimeoutSec);
    await this.store.saveRequest(r);
    await this.schedule('route_driver_timeout', r, expiresAt, 1);
  }

  /** Khat substitute auction: `substituteWaves` waves of `substituteWaveSize` vetted drivers, `substituteWaveMin` minutes each. */
  private async openSubstituteWave(r: DispatchRequest, cfg: DispatchConfig, wave: number): Promise<void> {
    for (let w = wave; w <= cfg.substituteWaves; w += 1) {
      const offered = new Set((await this.repo.listByTrip(r.tripId)).map((o) => o.driverId));
      const ranked = await this.candidates(r, cfg, { requireIdle: false, onlyVetted: true, only: r.eligibleDriverIds, exclude: offered });
      const chosen = ranked.slice(0, cfg.substituteWaveSize);
      r.status = 'searching';
      r.pass = 2;
      r.wave = w;
      if (w === 1) await this.emit('substitute.auction_opened', r, { routeId: r.routeId, routeDriverId: r.routeDriverId });
      if (chosen.length === 0) continue;
      const expiresAt = this.now() + cfg.substituteWaveMin * 60_000;
      await this.createOffers(r, 'pre_assigned', chosen, { wave: w, pass: 2, expiresAt, compensation: () => 0 });
      await this.trips.offer(r.tripId, chosen.map((c) => c.ranked.driverId), cfg.substituteWaveMin * 60);
      await this.emit('dispatch.wave_sent', r, { wave: w, driverIds: chosen.map((c) => c.ranked.driverId), seconds: cfg.substituteWaveMin * 60, substitute: true });
      r.nextTimerAt = expiresAt;
      await this.store.saveRequest(r);
      await this.schedule('sub_wave_end', r, expiresAt, w);
      return;
    }
    await this.needsDispatcher(r, 'substitutes_exhausted');
  }

  private async onRouteDriverTimeout(r: DispatchRequest): Promise<void> {
    if (r.status !== 'searching' || r.pass !== 1) return;
    await this.expireOpen(r, (o) => o.pass === 1);
    await this.openSubstituteWave(r, this.baseConfig(r.cityId, r.vertical), 1);
  }

  private async onSubWaveEnd(r: DispatchRequest, wave: number): Promise<void> {
    if (r.status !== 'searching' || r.pass !== 2 || r.wave !== wave) return;
    await this.expireOpen(r, (o) => o.pass === 2 && o.wave === wave);
    await this.openSubstituteWave(r, this.baseConfig(r.cityId, r.vertical), wave + 1);
  }

  // ───────────────────────── scheduled ─────────────────────────

  /** T−30: fewer than `minSeatsByTMinus30` seats (walk-ups included) → cancelled_low_fill, riders moved by routes. */
  private async onLowFillCheck(r: DispatchRequest): Promise<void> {
    if (r.status !== 'scheduled' || r.departureId === null) return;
    const cfg = this.baseConfig(r.cityId, r.vertical);
    const seats = await this.departures.seatsFilled(r.departureId);
    r.nextTimerAt = null;
    if (seats === null) {
      r.status = 'needs_dispatcher';
      r.red = true;
      await this.store.saveRequest(r);
      await this.emit('dispatch.needs_dispatcher', r, { reason: 'departure_unknown', departureId: r.departureId });
      return;
    }
    if (seats < cfg.minSeatsByTMinus30) {
      if ((await this.departures.cancelLowFill(r.departureId)) === false) {
        // Refused by routes: too early (check again at its low-fill time) or no longer applicable.
        const next = (await this.departures.lowFillCheckAt?.(r.departureId))?.getTime() ?? null;
        if (next !== null && next > this.now()) {
          r.nextTimerAt = next;
          await this.store.saveRequest(r);
          await this.schedule('low_fill_check', r, next, 1);
          return;
        }
        r.status = 'assigned';
        await this.store.retireRequest(r);
        await this.emit('dispatch.departure_confirmed', r, { departureId: r.departureId, seats, lowFillRefused: true });
        return;
      }
      r.status = 'cancelled';
      await this.store.retireRequest(r);
      await this.emit('dispatch.low_fill_cancelled', r, { departureId: r.departureId, seats, minSeats: cfg.minSeatsByTMinus30 });
      return;
    }
    r.status = 'assigned';
    await this.store.retireRequest(r);
    await this.emit('dispatch.departure_confirmed', r, { departureId: r.departureId, seats });
  }

  // ───────────────────────── booked rides (review #28) ─────────────────────────

  /** The pre-assignment of a ride booked for later, when the city has one and the booking leaves time for it. */
  private bookedPlan(job: DispatchRequestInput, cfg: DispatchConfig, now: number): BookedJob | null {
    const rules = cfg.bookedRides;
    if (!rules || !job.scheduledFor || !job.orderId) return null;
    const w = bookedRideWindow(job.scheduledFor, new Date(now), rules);
    if (!w) return null;
    return newBookedJob({
      orderId: job.orderId,
      scheduledFor: job.scheduledFor.getTime(),
      offerAt: w.offerAt.getTime(),
      confirmBy: w.confirmBy.getTime(),
      favouriteId: job.preferDriverIds?.[0] ?? null,
      favouriteUntil: bookedFavouriteUntil(w, rules).getTime(),
    });
  }

  /** Its timers: open, the favourite's time, the deadline and the reminder (T−30 is `broadcast_start`). */
  private async scheduleBooked(r: DispatchRequest, b: BookedJob, cfg: DispatchConfig): Promise<void> {
    const reminderLeadMin = cfg.bookedRides?.reminderLeadMin ?? 0;
    await this.schedule('booked_open', r, b.offerAt, 0);
    if (b.favouriteId && b.favouriteUntil > b.offerAt) await this.schedule('booked_fav_end', r, b.favouriteUntil, 0);
    await this.schedule('booked_deadline', r, b.confirmBy, 0);
    await this.schedule('booked_remind', r, b.scheduledFor - reminderLeadMin * 60_000, 0);
  }

  private async onBookedOpen(r: DispatchRequest): Promise<void> {
    if (r.status !== 'scheduled' || !r.booked || r.booked.state !== 'waiting') return;
    r.booked = bookedStep(r.booked, { kind: 'open' }, this.now());
    await this.store.saveRequest(r);
    if (r.booked.openedAt === null && r.booked.favouriteId) {
      await this.emit('dispatch.booked_offered', r, { orderId: r.booked.orderId, scheduledFor: new Date(r.booked.scheduledFor).toISOString(), confirmBy: new Date(r.booked.confirmBy).toISOString(), driverIds: [r.booked.favouriteId], favourite: true });
      return;
    }
    await this.announceBooked(r);
  }

  private async onBookedFavouriteEnd(r: DispatchRequest): Promise<void> {
    if (r.status !== 'scheduled' || !r.booked || r.booked.state !== 'offered' || r.booked.openedAt !== null) return;
    r.booked = bookedStep(r.booked, { kind: 'open_to_all' }, this.now());
    await this.store.saveRequest(r);
    await this.announceBooked(r);
  }

  /** Everyone may confirm it now: a push to the best-placed fitting drivers online (`notifyDrivers`). */
  private async announceBooked(r: DispatchRequest): Promise<void> {
    const b = r.booked;
    if (!b) return;
    const cfg = this.baseConfig(r.cityId, r.vertical);
    const max = cfg.bookedRides?.notifyDrivers ?? 0;
    const skip = new Set([...b.passedBy, ...b.releasedBy, ...(b.favouriteId ? [b.favouriteId] : [])]);
    const pool: Array<{ p: DriverPresence; distanceKm: number; fit: number }> = [];
    for (const { presence: p, distanceKm } of await this.presence.nearby(r.cityId, r.pickup, CITY_RADIUS_KM)) {
      if (skip.has(p.driverId)) continue;
      const fit = await this.bookedFit(r, p);
      if (fit > 0) pool.push({ p, distanceKm, fit });
    }
    const ranked = this.ranker
      .withWeights(cfg.rankWeights)
      .rank(pool.map((c) => ({ driverId: c.p.driverId, distanceKm: c.distanceKm, activeTrips: 0, tier: c.p.tier, vetted: c.p.vetted, vehicleFit: c.fit, minutesInZone: 0 })));
    const driverIds = ranked.slice(0, max).map((d) => d.driverId);
    await this.emit('dispatch.booked_opened', r, { orderId: b.orderId, scheduledFor: new Date(b.scheduledFor).toISOString(), confirmBy: new Date(b.confirmBy).toISOString(), driverIds });
  }

  /** 22:00 (or the same-day deadline): nobody confirmed — the rider hears we'll find one before his time. */
  private async onBookedDeadline(r: DispatchRequest): Promise<void> {
    if (r.status !== 'scheduled' || !r.booked || (r.booked.state !== 'waiting' && r.booked.state !== 'offered')) return;
    // The deadline takes the confirm lock: a driver confirming at the same moment either won it first
    // (and the job is his) or finds it closed.
    if (!(await this.store.tryLock(bookedLockKey(r.tripId), SYSTEM, this.bookedLockTtl(r.booked)))) return;
    const fresh = (await this.store.getRequest(r.tripId)) ?? r;
    if (!fresh.booked || (fresh.booked.state !== 'waiting' && fresh.booked.state !== 'offered')) return;
    fresh.booked = bookedStep(fresh.booked, { kind: 'deadline' }, this.now());
    await this.store.saveRequest(fresh);
    await this.emit('dispatch.booked_unconfirmed', fresh, { orderId: fresh.booked.orderId, scheduledFor: new Date(fresh.booked.scheduledFor).toISOString(), searchAt: rideSearchStartsAt(new Date(fresh.booked.scheduledFor)).toISOString() });
  }

  /** T−60: the confirmed driver is reminded (a push he gets even at night: he committed to it). */
  private async onBookedRemind(r: DispatchRequest): Promise<void> {
    if (r.status !== 'scheduled' || !r.booked || r.booked.state !== 'confirmed' || !r.booked.driverId) return;
    r.booked = bookedStep(r.booked, { kind: 'remind' }, this.now());
    await this.store.saveRequest(r);
    const at = new Date(r.booked.scheduledFor);
    await this.emit('dispatch.booked_reminder', r, { orderId: r.booked.orderId, driverId: r.booked.driverId, scheduledFor: at.toISOString(), showBy: rideSearchStartsAt(at).toISOString() });
  }

  /**
   * T−30: the confirmed driver online, free and with cap room gets the trip now; otherwise the job is
   * released (`no_show`) and the fallback search starts at once (favourite first unless it was him).
   */
  private async onBookedShowTime(r: DispatchRequest): Promise<void> {
    const driverId = r.booked?.driverId;
    if (!driverId) return;
    const ready = await this.readyToStart(r, driverId);
    if (ready) {
      try {
        await this.store.withDriverLock(driverId, () => this.startBooked(r.tripId, driverId));
        return;
      } catch (err) {
        // Trips refused him (the trip moved on, his vehicle): the job goes to the search below.
        if (!(err instanceof DriverError)) throw err;
      }
    }
    const fresh = (await this.store.getRequest(r.tripId)) ?? r;
    if (!fresh.booked || !isHeld(fresh.booked) || fresh.status !== 'scheduled') return;
    fresh.booked = bookedStep(fresh.booked, { kind: 'no_show' }, this.now());
    await this.store.saveRequest(fresh);
    await this.emit('dispatch.booked_released', fresh, { orderId: fresh.booked.orderId, driverId, reason: ready ? 'refused' : 'no_show', reopened: false });
    await this.beginBroadcast(fresh, this.baseConfig(fresh.cityId, fresh.vertical));
  }

  /** Online, no job in hand, the vehicle and cap fit: he can head to the pickup now. */
  private async readyToStart(r: DispatchRequest, driverId: string): Promise<boolean> {
    const p = await this.presence.get(driverId);
    if (!p || (await this.store.driverJobs(driverId)).length > 0 || (await this.caps.isOverCap(driverId))) return false;
    return (await this.bookedFit(r, p)) > 0;
  }

  /**
   * The confirmed driver starts his booked ride: a one-driver `booked` offer accepted for him through
   * the normal accept path (first-accept lock, trips, `dispatch.assigned`). Runs under his driver lock.
   * If trips refuses, the job is his again as before and the error goes back to the caller.
   */
  private async startBooked(tripId: string, driverId: string): Promise<void> {
    const r = await this.store.getRequest(tripId);
    if (!r?.booked || r.status !== 'scheduled') throw new DriverError('booked_job_not_found');
    const before: DispatchRequest = { ...r };
    const cfg = this.baseConfig(r.cityId, r.vertical);
    const p = await this.presence.get(driverId);
    if (!p) throw new DriverError('booked_start_not_ready');
    const now = this.now();
    const expiresAt = now + cfg.acceptTimeoutSec * 1000;
    r.booked = bookedStep(r.booked, { kind: 'start', driverId }, now);
    r.status = 'searching';
    r.searchStartedAt = now;
    r.nextTimerAt = expiresAt;
    const c: Candidate = { ranked: { driverId, distanceKm: haversineKm(p, r.pickup), activeTrips: 0, tier: p.tier, score: 0 }, presence: p, jobs: [] };
    const [offer] = await this.createOffers(r, BOOKED_OFFER_POLICY, [c], { wave: 0, pass: 0, expiresAt, compensation: () => 0 });
    if (!offer) throw new DriverError('booked_job_not_found');
    await this.store.saveRequest(r);
    try {
      await this.trips.offer(r.tripId, [driverId], cfg.acceptTimeoutSec);
      await this.acceptOffer(driverId, offer.id);
    } catch (err) {
      await this.withdrawOpen(r);
      await this.store.saveRequest(before);
      throw err;
    }
  }

  /** Vehicle, roles, the tuktuk edge rule, the order cap and his cash room — normal dispatch's fit (0 = no). */
  private async bookedFit(r: DispatchRequest, p: DriverPresence): Promise<number> {
    const fit = this.staticFit(r, p);
    if (fit === 0) return 0;
    return (await this.caps.canOffer(p.driverId, this.exposure(r))) ? fit : 0;
  }

  /** The confirm lock lives until a day after the ride. */
  private bookedLockTtl(b: BookedJob): number {
    return Math.max(60_000, b.scheduledFor + LOCK_TTL_MS - this.now());
  }

  private bookedInfo(r: DispatchRequest, job: BookedJob, driverId: string): BookedJobInfo {
    const lead = this.baseConfig(r.cityId, r.vertical).bookedRides?.reminderLeadMin ?? 0;
    return { request: r, job, startFrom: new Date(job.scheduledFor - lead * 60_000), showBy: rideSearchStartsAt(new Date(job.scheduledFor)), favourite: job.favouriteId === driverId };
  }

  /** A booked job of his within `minGapMin` of this one's time (he can't be in two places). */
  private async clashes(r: DispatchRequest, at: number, driverId: string): Promise<boolean> {
    const gap = (this.baseConfig(r.cityId, r.vertical).bookedRides?.minGapMin ?? 0) * 60_000;
    for (const other of await this.store.activeRequests(r.cityId)) {
      if (other.tripId === r.tripId || !other.booked || !isHeld(other.booked) || other.booked.driverId !== driverId) continue;
      if (Math.abs(other.booked.scheduledFor - at) < gap) return true;
    }
    return false;
  }

  /**
   * «مشاوير باچر» (Partner app): the booked rides he confirmed, and — while he is online, so his vehicle
   * is known — the ones open to him that fit him and don't clash with his own. Soonest first. Read-only.
   */
  async bookedFor(driverId: string, cityId: string): Promise<{ online: boolean; mine: BookedJobInfo[]; open: BookedJobInfo[] }> {
    const p = await this.presence.get(driverId);
    const now = this.now();
    const mine: BookedJobInfo[] = [];
    const open: BookedJobInfo[] = [];
    for (const r of await this.store.activeRequests(p?.cityId ?? cityId)) {
      const job = r.booked;
      if (!job || r.status !== 'scheduled') continue;
      if (isHeld(job) && job.driverId === driverId) mine.push(this.bookedInfo(r, job, driverId));
      else if (p && openTo(job, driverId, now) && (await this.bookedFit(r, p)) > 0 && !(await this.clashes(r, job.scheduledFor, driverId))) open.push(this.bookedInfo(r, job, driverId));
    }
    const soonest = (a: BookedJobInfo, b: BookedJobInfo) => a.job.scheduledFor - b.job.scheduledFor;
    return { online: p !== null, mine: mine.sort(soonest), open: open.sort(soonest) };
  }

  /**
   * His answer on a booked ride: `confirm` (first confirm wins; online and fitting, no clash), `pass`
   * («مو إلي»), `release` («ما أگدر أجي»: before the deadline it goes back on offer, after it the T−30
   * search), `start` («طالع هسة», from the reminder on, online and free).
   */
  async answerBooked(driverId: string, tripId: string, answer: PartnerBookedAnswer): Promise<void> {
    const r = await this.store.getRequest(tripId);
    const job = r?.booked;
    if (!r || !job || r.status !== 'scheduled') throw new DriverError('booked_job_not_found');
    const now = this.now();
    switch (answer) {
      case 'confirm':
        return this.uow.run(() => this.confirmBooked(r, job, driverId));
      case 'pass':
        return this.uow.run(async () => {
          if (!openTo(job, driverId, now)) throw new DriverError('booked_job_not_found');
          r.booked = bookedStep(job, { kind: 'pass', driverId }, now);
          await this.store.saveRequest(r);
          await this.emit('dispatch.booked_passed', r, { orderId: job.orderId, driverId }, driverId);
          // The favourite said no: everyone may take it now.
          if (job.openedAt === null && r.booked.openedAt !== null) await this.announceBooked(r);
        });
      case 'release':
        return this.uow.run(async () => {
          const next = bookedStep(job, { kind: 'release', driverId }, now);
          r.booked = next;
          await this.store.saveRequest(r);
          await this.store.unlock(bookedLockKey(tripId));
          const reopened = next.state === 'offered';
          await this.emit('dispatch.booked_released', r, { orderId: next.orderId, driverId, reason: 'driver', reopened }, driverId);
          if (reopened) await this.announceBooked(r);
        });
      case 'start': {
        if (!isHeld(job) || job.driverId !== driverId) throw new DriverError('booked_job_not_found');
        if (now < this.bookedInfo(r, job, driverId).startFrom.getTime()) throw new DriverError('booked_start_too_early');
        if (!(await this.readyToStart(r, driverId))) throw new DriverError('booked_start_not_ready');
        return this.store.withDriverLock(driverId, () => this.startBooked(tripId, driverId));
      }
    }
  }

  private async confirmBooked(r: DispatchRequest, job: BookedJob, driverId: string): Promise<void> {
    const now = this.now();
    if (isHeld(job) && job.driverId === driverId) return;
    // Refusals in the machine's words first (taken, closed, not his yet), then his fit.
    bookedStep(job, { kind: 'confirm', driverId }, now);
    const p = await this.presence.get(driverId);
    if (!p || (await this.bookedFit(r, p)) === 0) throw new DriverError('booked_job_not_fit');
    if (await this.clashes(r, job.scheduledFor, driverId)) throw new DriverError('booked_job_clash');
    // First confirm wins (SET NX), and the 22:00 deadline takes the same lock.
    if (!(await this.store.tryLock(bookedLockKey(r.tripId), driverId, this.bookedLockTtl(job)))) {
      const fresh = (await this.store.getRequest(r.tripId))?.booked;
      if (fresh && isHeld(fresh) && fresh.driverId === driverId) return;
      throw new DriverError(fresh && isHeld(fresh) ? 'booked_job_taken' : 'booked_job_closed');
    }
    const fresh = (await this.store.getRequest(r.tripId)) ?? r;
    let next: BookedJob;
    try {
      next = bookedStep(fresh.booked ?? job, { kind: 'confirm', driverId }, now);
    } catch (err) {
      await this.store.unlock(bookedLockKey(r.tripId));
      throw err;
    }
    fresh.booked = next;
    await this.store.saveRequest(fresh);
    await this.emit('dispatch.booked_confirmed', fresh, { orderId: next.orderId, driverId, scheduledFor: new Date(next.scheduledFor).toISOString(), favourite: next.favouriteId === driverId }, driverId);
  }

  /** The rider's view of his booked ride: the pre-assignment (if any) and when the search starts. Read-only. */
  async bookedRide(tripId: string): Promise<BookedRideInfo | null> {
    const r = await this.store.getRequest(tripId);
    if (!r || r.startAt == null) return null;
    const scheduledFor = new Date(r.scheduledFor ?? r.startAt + RIDE_HABIT_RULES.schedule.searchLeadMin * 60_000);
    return { job: r.booked ?? null, scheduledFor, searchAt: new Date(r.startAt) };
  }

  // ───────────────────────── driver responses ─────────────────────────

  /** Edge-case §6: an offer counts as seen only after `offerSeenAfterSec` (3 s) in the foreground. */
  async offerSeen(driverId: string, offerId: string, foregroundMs: number): Promise<boolean> {
    const { offer, r } = await this.loadOffer(driverId, offerId);
    if (offer.state === 'seen') return true;
    const cfg = this.baseConfig(r.cityId, r.vertical);
    if (foregroundMs < cfg.offerSeenAfterSec * 1000) return false;
    return this.uow.run(async (tx) => {
      const updated = await this.repo.updateOffer(offerId, ['sent'], { state: 'seen', seenAt: this.clock.now() }, tx);
      if (!updated) return false;
      await this.emit('dispatch.offer_seen', r, { offerId, driverId, foregroundMs }, driverId);
      return true;
    });
  }

  /**
   * The single public path for a driver's answer to an offer (`dispatch.respond`); trips' accept and
   * decline are internal and reached only from here. An accept runs under the driver's lock (M2
   * review follow-up), so two accepts of different trips by the same driver are serialised: the
   * second sees the first one's job and must pass the one-job / batching rules against it.
   */
  async respond(driverId: string, offerId: string, accept: boolean): Promise<{ outcome: 'assigned' | 'declined'; tripId: string; compensationIqd: number }> {
    if (!accept) {
      const { offer, r } = await this.openOfferOf(driverId, offerId);
      return this.decline(r, offer);
    }
    return this.store.withDriverLock(driverId, () => this.acceptOffer(driverId, offerId));
  }

  /** The driver's offer and its request, refused unless the offer is still open and unexpired. */
  private async openOfferOf(driverId: string, offerId: string): Promise<{ offer: OfferRecord; r: DispatchRequest }> {
    const { offer, r } = await this.loadOffer(driverId, offerId);
    if (!OPEN_STATES.includes(offer.state) || this.now() >= offer.expiresAt.getTime()) {
      if (r.assignedDriverId && r.assignedDriverId !== driverId) throw new DriverError('offer_taken');
      throw new DriverError('offer_expired');
    }
    return { offer, r };
  }

  /** Runs under the driver's lock: everything below reads his jobs as they are now. */
  private async acceptOffer(driverId: string, offerId: string): Promise<{ outcome: 'assigned'; tripId: string; compensationIqd: number }> {
    const { offer, r } = await this.openOfferOf(driverId, offerId);
    if (await this.caps.isOverCap(driverId)) throw new DriverError('over_cap');
    if (!(await this.fitsCurrentJobs(r, offer, driverId))) {
      // Two offers reached him while he was free and he took the other one first: this one is
      // declined for him (the request moves on) instead of becoming an unchecked batch or a second ride.
      await this.decline(r, offer);
      throw new DriverError('offer_conflicts_current_job');
    }

    // First accept wins: SET dispatch:lock:{tripId} driverId NX.
    const won = await this.store.tryLock(lockKey(r.tripId), driverId, LOCK_TTL_MS);
    if (!won) {
      await this.repo.updateOffer(offer.id, OPEN_STATES, { state: 'withdrawn', respondedAt: this.clock.now() });
      throw new DriverError('offer_taken');
    }
    const vehicle = (await this.presence.get(driverId))?.vehicle;
    return this.uow.run(async (tx) => {
      const accepted = await this.repo.updateOffer(offer.id, OPEN_STATES, { state: 'accepted', respondedAt: this.clock.now() }, tx);
      if (!accepted) {
        await this.store.unlock(lockKey(r.tripId));
        throw new DriverError('offer_expired');
      }
      const fresh = (await this.store.getRequest(r.tripId)) ?? r;
      const batchWith = fresh.policy === 'auto_assign' ? await this.store.driverJobs(driverId) : [];
      // Trips first: if it refuses (vehicle too small for the order, trip gone) nobody is told he won.
      try {
        await this.trips.assign(fresh.tripId, driverId, { compensationIqd: offer.compensationIqd, batchWith, ...(vehicle ? { vehicleClass: vehicle } : {}) });
      } catch (err) {
        await this.repo.updateOffer(offer.id, ['accepted'], { state: 'withdrawn' }, tx);
        await this.store.unlock(lockKey(r.tripId));
        throw err;
      }
      await this.withdrawOpen(fresh, offer.id);
      fresh.status = 'assigned';
      fresh.assignedDriverId = driverId;
      fresh.compensationIqd = offer.compensationIqd;
      fresh.batchWith = batchWith;
      fresh.red = false;
      fresh.nextTimerAt = null;
      fresh.epoch += 1;
      await this.store.addDriverJob(driverId, fresh.tripId);
      await this.store.saveRequest(fresh);
      await this.presence.resetZoneClock(driverId);
      const payload = {
        driverId,
        offerId: offer.id,
        policy: offer.policy,
        wave: offer.wave,
        pass: offer.pass,
        compensationIqd: offer.compensationIqd,
        compensationFundedBy: offer.compensationIqd > 0 ? 'platform' : null,
        batchWith,
        departAt: fresh.departAt === null ? null : new Date(fresh.departAt).toISOString(),
        via: 'dispatch',
      };
      await this.emit('dispatch.assigned', fresh, payload, driverId);
      if (offer.policy === 'pre_assigned' && offer.pass === 2) await this.emit('substitute.assigned', fresh, { driverId, routeId: fresh.routeId }, driverId);
      return { outcome: 'assigned' as const, tripId: fresh.tripId, compensationIqd: offer.compensationIqd };
    });
  }

  /**
   * Offers are checked against the courier's jobs when they are sent, but two can be open at once
   * for a courier who was free (two kitchens, two waves). By the time he accepts the second he may
   * hold the first: a broadcast (ride) needs him idle, an auto-assign job must still pass the batching
   * rules against what he now carries. Dispatcher overrides and route offers are not second-guessed.
   */
  private async fitsCurrentJobs(r: DispatchRequest, offer: OfferRecord, driverId: string): Promise<boolean> {
    const broadcast = offer.policy === 'smart_broadcast' || offer.policy === FAVOURITE_OFFER_POLICY;
    if (!broadcast && offer.policy !== 'auto_assign') return true;
    const jobs = (await this.store.driverJobs(driverId)).filter((id) => id !== r.tripId);
    if (jobs.length === 0) return true;
    if (broadcast) return false;
    const cfg = this.baseConfig(r.cityId, r.vertical);
    const p = await this.presence.get(driverId);
    if (jobs.length >= batchLimit(p?.vehicle ?? 'bike', cfg.maxBatch)) return false;
    const current = await this.batchOrders(jobs, driverId);
    if (!current) return false;
    const verdict = canBatch(
      current,
      { tripId: r.tripId, pickup: r.pickup, dropoffZoneId: r.dropoffZoneId ?? r.zoneId, readyAt: new Date(r.readyAt ?? this.now()), hot: r.hot },
      { maxBatch: batchLimit(p?.vehicle ?? 'bike', cfg.maxBatch), maxDetourMin: cfg.batchMaxDetourMin, maxHotWaitMin: cfg.batchMaxHotWaitMin },
      { now: this.clock.now(), courierAt: p ?? r.pickup, isAdjacent: (a, b) => this.zones.adjacent(r.cityId, a, b) },
    );
    return verdict.ok;
  }

  private async decline(r: DispatchRequest, offer: OfferRecord, opts: { notifyTrips: boolean } = { notifyTrips: true }) {
    return this.uow.run(async (tx) => {
      const declined = await this.repo.updateOffer(offer.id, OPEN_STATES, { state: 'declined', respondedAt: this.clock.now() }, tx);
      if (!declined) return { outcome: 'declined' as const, tripId: offer.tripId, compensationIqd: 0 };
      if (opts.notifyTrips) await this.trips.decline(offer.tripId, offer.driverId, { othersPending: await this.hasOpen(offer.tripId) });
      await this.emit('dispatch.offer_declined', r, { offerId: offer.id, driverId: offer.driverId, wave: offer.wave, pass: offer.pass }, offer.driverId);
      const fresh = (await this.store.getRequest(r.tripId)) ?? r;
      const cfg = this.baseConfig(fresh.cityId, fresh.vertical);
      // Single-driver offers move on at once; broadcasts wait for the others in the wave.
      if (offer.policy === 'auto_assign' && fresh.status === 'searching' && fresh.pass === offer.pass) await this.startPass(fresh, cfg, offer.pass + 1);
      else if (offer.policy === 'pre_assigned' && offer.pass === 1 && fresh.status === 'searching' && fresh.pass === 1) await this.openSubstituteWave(fresh, cfg, 1);
      else if (offer.policy === 'override' && fresh.status === 'searching') await this.needsDispatcher(fresh, 'override_declined');
      // Joy l9: the favourite said no — the normal waves start now, not after his minute.
      else if (offer.policy === FAVOURITE_OFFER_POLICY && fresh.status === 'searching' && fresh.pass === 0) await this.startWaves(fresh, cfg);
      return { outcome: 'declined' as const, tripId: offer.tripId, compensationIqd: 0 };
    });
  }

  private async loadOffer(driverId: string, offerId: string): Promise<{ offer: OfferRecord; r: DispatchRequest }> {
    const offer = await this.repo.getOffer(offerId);
    if (!offer) throw new DriverError('offer_not_found');
    if (offer.driverId !== driverId) throw new DriverError('offer_not_yours');
    const r = await this.store.getRequest(offer.tripId);
    if (!r) throw new DriverError('dispatch_not_found');
    return { offer, r };
  }

  // ───────────────────────── trips → dispatch ─────────────────────────

  /**
   * Trips says a driver accepted. Normally the echo of an assignment `respond` made (a no-op). Trips
   * no longer exposes accept publicly and only lets a driver with an open offer accept, so the claim
   * branch below is a safety net for an internal accept that bypassed `respond`: it claims the
   * first-accept lock and assigns the request exactly as `respond` would, without calling trips again.
   * (Not under the driver lock: it runs from the outbox drain, possibly inside `respond`'s own lock.)
   */
  async onTripAccepted(tripId: string, driverId: string): Promise<void> {
    const r = await this.store.getRequest(tripId);
    if (!r || r.status === 'cancelled' || r.status === 'assigned') return;
    if (!(await this.store.tryLock(lockKey(tripId), driverId, LOCK_TTL_MS))) return;
    await this.uow.run(async (tx) => {
      const mine = (await this.repo.listByTrip(tripId)).find((o) => o.driverId === driverId && OPEN_STATES.includes(o.state)) ?? null;
      if (mine) await this.repo.updateOffer(mine.id, OPEN_STATES, { state: 'accepted', respondedAt: this.clock.now() }, tx);
      await this.withdrawOpen(r, mine?.id);
      const batchWith = r.policy === 'auto_assign' ? await this.store.driverJobs(driverId) : [];
      r.status = 'assigned';
      r.assignedDriverId = driverId;
      r.compensationIqd = mine?.compensationIqd ?? 0;
      r.batchWith = batchWith;
      r.red = false;
      r.nextTimerAt = null;
      r.epoch += 1;
      await this.store.addDriverJob(driverId, tripId);
      await this.store.saveRequest(r);
      await this.presence.resetZoneClock(driverId);
      await this.emit(
        'dispatch.assigned',
        r,
        {
          driverId,
          offerId: mine?.id ?? null,
          policy: mine?.policy ?? r.policy,
          wave: mine?.wave ?? r.wave,
          pass: mine?.pass ?? r.pass,
          compensationIqd: r.compensationIqd,
          compensationFundedBy: r.compensationIqd > 0 ? 'platform' : null,
          batchWith,
          departAt: r.departAt === null ? null : new Date(r.departAt).toISOString(),
          via: 'trip',
        },
        driverId,
      );
    });
  }

  /**
   * Trips says a driver declined (Partner app → `trips.decline`, or the echo of `respond`): same as
   * `respond(…, false)`. A decline made straight on trips does not know the wave is still open
   * (`othersPending: false` moved the trip to `declined`), so the trip is put back on offer to the
   * drivers who still hold an open offer; otherwise their accept would hit a non-offered trip.
   */
  async onTripDeclined(tripId: string, driverId: string, opts: { othersPendingOnTrip?: boolean } = {}): Promise<void> {
    const r = await this.store.getRequest(tripId);
    if (!r) return;
    const offers = await this.repo.listByTrip(tripId);
    const mine = offers.find((o) => o.driverId === driverId && OPEN_STATES.includes(o.state));
    if (!mine) return;
    const others = offers.filter((o) => o.id !== mine.id && OPEN_STATES.includes(o.state));
    await this.decline(r, mine, { notifyTrips: false });
    if (others.length > 0 && !opts.othersPendingOnTrip) {
      const until = Math.max(...others.map((o) => o.expiresAt.getTime()));
      await this.trips.offer(tripId, others.map((o) => o.driverId), Math.max(1, Math.round((until - this.now()) / 1000)));
    }
  }

  // ───────────────────────── dispatcher ─────────────────────────

  /**
   * Dispatcher assigns by hand (review J116): the driver must be online, under cap and fit the
   * vehicle, unless forced with a reason. The driver still accepts or declines; other open offers
   * are withdrawn and pending timers die with the epoch bump.
   */
  async override(actorId: string, input: { tripId: string; driverId: string; reason?: string; force?: boolean }): Promise<{ offerId: string; warnings: string[] }> {
    const r = await this.store.getRequest(input.tripId);
    if (!r) throw new DriverError('dispatch_not_found');
    if (r.status === 'assigned' || r.status === 'cancelled') throw new DriverError('override_invalid');
    const cfg = this.baseConfig(r.cityId, r.vertical);
    const p = await this.presence.get(input.driverId);
    const warnings: string[] = [];
    if (!p) warnings.push('offline');
    if (await this.caps.isOverCap(input.driverId)) warnings.push('over_cap');
    // Review #20: his roles on his registered vehicle do not cover this vertical — the same warning.
    if (p && (vehicleFit(r.vertical, p.vehicle) === 0 || (p.verticals && !p.verticals.includes(r.vertical)))) warnings.push('vehicle_fit');
    if (p && this.edgeBlocked(r, p)) warnings.push('edge_zone');
    // s5: the rider said never again — not even a forced override sends him this ride.
    if (r.avoidDriverIds?.includes(input.driverId)) throw new DriverError('override_invalid');
    if (warnings.length > 0 && !input.force) throw new DriverError('override_invalid');
    if (input.force && !input.reason?.trim()) throw new DriverError('override_reason_required');

    return this.uow.run(async () => {
      await this.withdrawOpen(r);
      const prior = await this.repo.listByTrip(r.tripId);
      const inWaves12 = prior.some((o) => o.driverId === input.driverId && o.policy === 'smart_broadcast' && o.pass === 1 && o.wave <= 2);
      const compensationIqd = r.compensationActive && !inWaves12 ? cfg.rebroadcastCompensationIqd : 0;
      const expiresAt = this.now() + cfg.acceptTimeoutSec * 1000;
      r.epoch += 1;
      r.status = 'searching';
      r.searchStartedAt ??= this.now();
      r.nextTimerAt = expiresAt;
      const c: Candidate = {
        ranked: { driverId: input.driverId, distanceKm: p ? haversineKm(p, r.pickup) : 0, activeTrips: 0, tier: p?.tier ?? 'bronze', score: 0 },
        presence: p ?? ({ lat: r.pickup.lat, lng: r.pickup.lng } as DriverPresence),
        jobs: [],
      };
      const [offer] = await this.createOffers(r, 'override', [c], { wave: 0, pass: r.pass, expiresAt, compensation: () => compensationIqd });
      await this.trips.offer(r.tripId, [input.driverId], cfg.acceptTimeoutSec);
      await this.store.saveRequest(r);
      await this.schedule('override_timeout', r, expiresAt, 0);
      await this.emit('dispatch.override', r, { driverId: input.driverId, reason: input.reason ?? null, forced: Boolean(input.force), warnings }, actorId);
      return { offerId: offer!.id, warnings };
    });
  }

  private async onOverrideTimeout(r: DispatchRequest): Promise<void> {
    if (r.status !== 'searching') return;
    await this.expireOpen(r, (o) => o.policy === 'override');
    await this.needsDispatcher(r, 'override_timed_out');
  }

  /** Customer or platform cancelled the trip: withdraw everything, release the lock and the driver. */
  async cancel(tripId: string, actorId: string = SYSTEM): Promise<void> {
    const r = await this.store.getRequest(tripId);
    if (!r || r.status === 'cancelled') return;
    await this.uow.run(async () => {
      await this.withdrawOpen(r);
      if (r.assignedDriverId) await this.store.removeDriverJob(r.assignedDriverId, tripId);
      await this.store.unlock(lockKey(tripId));
      // Review #28: the driver who confirmed this booked ride hears it is off.
      const holder = r.booked && isHeld(r.booked) ? r.booked.driverId : null;
      if (r.booked) {
        r.booked = bookedStep(r.booked, { kind: 'cancel' }, this.now());
        await this.store.unlock(bookedLockKey(tripId));
      }
      r.status = 'cancelled';
      r.epoch += 1;
      r.nextTimerAt = null;
      await this.store.retireRequest(r);
      await this.emit('dispatch.cancelled', r, { freeCancel: r.customerMayCancelFree }, actorId);
      if (holder && r.booked) await this.emit('dispatch.booked_cancelled', r, { orderId: r.booked.orderId, driverId: holder, scheduledFor: new Date(r.booked.scheduledFor).toISOString() }, actorId);
    });
  }

  /** Trips tells us the courier has the order in the bag (batching skips its pickup from now on). */
  async markPickedUp(tripId: string): Promise<void> {
    const r = await this.store.getRequest(tripId);
    if (!r || r.pickedUp) return;
    r.pickedUp = true;
    await this.store.saveRequest(r);
  }

  /** The job is done: the driver's load drops and the card leaves the board. Over-cap drivers stop here. */
  async jobFinished(tripId: string): Promise<void> {
    const r = await this.store.getRequest(tripId);
    if (!r) return;
    if (r.assignedDriverId) {
      await this.store.removeDriverJob(r.assignedDriverId, tripId);
      await this.presence.resetZoneClock(r.assignedDriverId);
    }
    await this.store.retireRequest(r);
  }

  async board(cityId: string): Promise<DispatchBoard> {
    const city = this.config.city(cityId);
    if (!city) throw new DriverError('dispatch_not_found');
    const now = this.now();
    const policies: BoardPolicy[] = [];
    for (const vertical of Object.keys(city.dispatch) as Vertical[]) {
      const { cfg, override } = await this.effectiveConfig(cityId, vertical);
      policies.push({ vertical, policy: cfg.policy, suggestOnly: cfg.suggestOnly, overridden: override !== null });
    }
    const cards = [];
    for (const r of await this.store.activeRequests(cityId)) {
      cards.push(buildCard(r, await this.repo.listByTrip(r.tripId), this.baseConfig(cityId, r.vertical), now));
    }
    return { cityId, at: new Date(now), policies, cards: sortCards(cards) };
  }

  getRequest(tripId: string): Promise<DispatchRequest | null> {
    return this.store.getRequest(tripId);
  }

  /** No job in hand (the customer's "free vehicles nearby" map, maps program c10). Read-only. */
  async idle(driverId: string): Promise<boolean> {
    return (await this.store.driverJobs(driverId)).length === 0;
  }

  /**
   * Who is busy on the city's live board (Console map): the trip each driver is assigned to, and
   * the trip each driver holds an unanswered offer for. Read-only.
   */
  async liveJobs(cityId: string): Promise<LiveJobs> {
    const assigned = new Map<string, string>();
    const offered = new Map<string, string>();
    for (const r of await this.store.activeRequests(cityId)) {
      if (r.status === 'cancelled') continue;
      if (r.assignedDriverId) {
        if (!assigned.has(r.assignedDriverId)) assigned.set(r.assignedDriverId, r.tripId);
        continue;
      }
      for (const o of await this.repo.listByTrip(r.tripId)) {
        if (OPEN_STATES.includes(o.state) && !offered.has(o.driverId)) offered.set(o.driverId, r.tripId);
      }
    }
    return { assigned, offered };
  }

  /**
   * The driver's own open, unexpired offer in the city with its request (Partner app's offer card).
   * Newest first when two reached him at once. Read-only.
   */
  async openOfferFor(driverId: string, cityId: string): Promise<{ offer: OfferRecord; request: DispatchRequest } | null> {
    const now = this.now();
    let best: { offer: OfferRecord; request: DispatchRequest } | null = null;
    for (const r of await this.store.activeRequests(cityId)) {
      if (r.status === 'cancelled' || r.assignedDriverId) continue;
      for (const o of await this.repo.listByTrip(r.tripId)) {
        if (o.driverId !== driverId || !OPEN_STATES.includes(o.state) || o.expiresAt.getTime() <= now) continue;
        if (!best || o.sentAt.getTime() > best.offer.sentAt.getTime()) best = { offer: o, request: r };
      }
    }
    return best;
  }

  // ───────────────────────── the rider's side (ride step 3) ─────────────────────────

  /**
   * n3: the ride's request and every offer sent for it, while it is still looking for its driver; null
   * once it was assigned, cancelled or before its search started. Read-only.
   */
  async searchOf(tripId: string): Promise<{ request: DispatchRequest; offers: OfferRecord[] } | null> {
    const r = await this.store.getRequest(tripId);
    if (!r || !SEARCHING.has(r.status) || r.assignedDriverId) return null;
    return { request: r, offers: await this.repo.listByTrip(tripId) };
  }

  /** n5: a driver's accepted offers, newest first (where each job was when he took it). Read-only. */
  acceptedBy(driverId: string, limit: number): Promise<OfferRecord[]> {
    return this.repo.acceptedByDriver(driverId, limit);
  }

  /**
   * n4 «نبّهه»: the waiting rider nudges one driver who holds an open offer of this ride. Once per driver
   * per ride (`NUDGE_RULES.perDriver`); refused for a ride no longer searching, an offer of another ride,
   * and a declined, expired or withdrawn offer. The notify module sends him a soft `ride_nudge` push
   * and his offer card re-reads with «راكب ينتظرك» (the live fan-out of `dispatch.offer_nudged`).
   */
  async nudge(tripId: string, offerId: string, riderId: string): Promise<Date> {
    const search = await this.searchOf(tripId);
    if (!search) throw new DriverError('ride_not_searching');
    const offer = search.offers.find((o) => o.id === offerId);
    if (!offer) throw new DriverError('nudge_offer_closed');
    const nudges = search.offers.filter((o) => o.driverId === offer.driverId && o.nudgedAt !== null).length;
    if (nudges >= NUDGE_RULES.perDriver) throw new DriverError('nudge_already');
    if (!OPEN_STATES.includes(offer.state) || this.now() >= offer.expiresAt.getTime()) throw new DriverError('nudge_offer_closed');
    return this.uow.run(async (tx) => {
      const at = this.clock.now();
      const marked = await this.repo.markNudged(offer.id, at, tx);
      if (!marked) {
        // Lost a race: a second tap nudged him first, or he answered / the wave moved on meanwhile.
        const fresh = await this.repo.getOffer(offer.id, tx);
        throw new DriverError(fresh?.nudgedAt ? 'nudge_already' : 'nudge_offer_closed');
      }
      await this.emit('dispatch.offer_nudged', search.request, { offerId: offer.id, driverId: offer.driverId, wave: offer.wave, pass: offer.pass }, riderId);
      return at;
    });
  }

  /** Offers accepted since `since` and the mean seconds from send to accept (Console right-now bar). */
  /** Offers sent since `since`, by outcome (launch wall: acceptance rate = accepted / answered). */
  /** Offers sent in `[since, to)` by how they ended (`to` defaults to now: the wall's "vs yesterday" passes now − 24 h). */
  async offerOutcomes(since: Date, to?: Date): Promise<{ accepted: number; declined: number; timedOut: number; open: number }> {
    const rows = (await this.repo.sentSince(since)).filter((o) => !to || o.sentAt.getTime() < to.getTime());
    const n = (st: string) => rows.filter((o) => o.state === st).length;
    return { accepted: n('accepted'), declined: n('declined'), timedOut: n('timed_out'), open: n('sent') + n('seen') };
  }

  async acceptStats(since: Date): Promise<{ accepted: number; avgSec: number | null }> {
    const rows = (await this.repo.acceptedSince(since)).filter((o) => o.respondedAt !== null);
    if (rows.length === 0) return { accepted: 0, avgSec: null };
    const total = rows.reduce((s, o) => s + Math.max(0, o.respondedAt!.getTime() - o.sentAt.getTime()), 0);
    return { accepted: rows.length, avgSec: Math.round(total / rows.length / 1000) };
  }

  // ───────────────────────── timers ─────────────────────────

  async onTimer(job: TimerJob): Promise<void> {
    const r = await this.store.getRequest(job.tripId);
    if (!r || r.epoch !== job.epoch) return;
    await this.uow.run(async () => {
      switch (job.kind) {
        case 'wave_end':
          return this.onWaveEnd(r, job.step);
        case 'rebroadcast':
          return this.onRebroadcast(r);
        case 'free_cancel':
          return this.onFreeCancel(r);
        case 'assign_start':
          if (r.status !== 'scheduled') return;
          r.searchStartedAt = this.now();
          return this.startPass(r, this.baseConfig(r.cityId, r.vertical), 1);
        case 'assign_timeout':
          return this.onAssignTimeout(r, job.step);
        case 'route_driver_timeout':
          return this.onRouteDriverTimeout(r);
        case 'sub_wave_end':
          return this.onSubWaveEnd(r, job.step);
        case 'override_timeout':
          return this.onOverrideTimeout(r);
        case 'low_fill_check':
          return this.onLowFillCheck(r);
        case 'broadcast_start':
          if (r.status !== 'scheduled') return;
          // Review #28: T−30 — the confirmed driver's trip starts, or the fallback search does.
          if (r.booked && isHeld(r.booked)) return this.onBookedShowTime(r);
          if (r.booked && (r.booked.state === 'waiting' || r.booked.state === 'offered')) r.booked = bookedStep(r.booked, { kind: 'deadline' }, this.now());
          // NTF-05: the rider who booked yesterday hears that the search for his driver started now.
          if (r.orderId && r.scheduledFor) await this.emit('dispatch.booked_search_started', r, { orderId: r.orderId, scheduledFor: new Date(r.scheduledFor).toISOString() });
          return this.beginBroadcast(r, this.baseConfig(r.cityId, r.vertical));
        case 'favourite_end':
          return this.onFavouriteEnd(r);
        case 'booked_open':
          return this.onBookedOpen(r);
        case 'booked_fav_end':
          return this.onBookedFavouriteEnd(r);
        case 'booked_deadline':
          return this.onBookedDeadline(r);
        case 'booked_remind':
          return this.onBookedRemind(r);
      }
    });
  }

  // ───────────────────────── helpers ─────────────────────────

  private now(): number {
    return this.clock.now().getTime();
  }

  private async schedule(kind: TimerKind, r: DispatchRequest, atMs: number, step: number): Promise<void> {
    // BullMQ custom ids may not contain ':'.
    const jobId = `${r.tripId}.${kind}.${r.epoch}.${step}`;
    const delayMs = Math.max(0, atMs - this.now());
    const data: TimerJob = { kind, tripId: r.tripId, epoch: r.epoch, step };
    if (this.timers && delayMs >= DURABLE_TIMER_MIN_DELAY_MS) {
      data.durable = true;
      // Same transaction as the request it belongs to: rolled back together.
      await this.timers.schedule({ queue: DISPATCH_QUEUE_NAME, name: kind, jobId, data, dueAt: new Date(atMs + DURABLE_TIMER_GRACE_MS) }, this.uow.current());
    }
    await this.queue.add(kind, data, { delayMs, jobId });
  }

  /** Tuktuks never get edge-zone jobs (pickup or drop-off) unless they opted in. */
  private edgeBlocked(r: DispatchRequest, p: DriverPresence): boolean {
    if (p.vehicle !== 'tuktuk' || p.edgeOptIn) return false;
    return this.zones.isEdge(r.cityId, r.zoneId) || this.zones.isEdge(r.cityId, r.dropoffZoneId ?? undefined);
  }

  /**
   * The vehicle fits the vertical (0 = not at all), his roles allow it on his registered vehicle (review
   * 2026-10-04 #20, set at goOnline), the tuktuk edge rule and the order cap. Cap room is checked apart.
   */
  private staticFit(r: DispatchRequest, p: DriverPresence): number {
    const fit = vehicleFit(r.vertical, p.vehicle);
    if (fit === 0) return 0;
    if (p.verticals && !p.verticals.includes(r.vertical)) return 0;
    if (this.edgeBlocked(r, p)) return 0;
    if (!vehicleFits(p.vehicle, r.minVehicleClass ?? null)) return 0;
    return fit;
  }

  /**
   * Eligible drivers, ranked: online (TTL), vehicle fits the vertical and the order cap, tuktuk edge
   * rule, cap room for this job's cash (money & ops §4: over-cap drivers finish the current job and
   * get nothing new), not excluded, idle when required, and within the batch limit otherwise.
   */
  private async candidates(r: DispatchRequest, cfg: DispatchConfig, f: CandidateFilter): Promise<Candidate[]> {
    const nearby = await this.presence.nearby(r.cityId, r.pickup, f.radiusKm ?? CITY_RADIUS_KM);
    const pool: Array<{ presence: DriverPresence; jobs: string[]; distanceKm: number; fit: number }> = [];
    const avoided = new Set(r.avoidDriverIds ?? []);
    for (const { presence: p, distanceKm } of nearby) {
      if (f.exclude?.has(p.driverId)) continue;
      if (avoided.has(p.driverId)) continue;
      if (f.only && !f.only.includes(p.driverId)) continue;
      if (f.onlyVetted && !p.vetted) continue;
      const fit = this.staticFit(r, p);
      if (fit === 0) continue;
      const jobs = await this.store.driverJobs(p.driverId);
      if (f.requireIdle && jobs.length > 0) continue;
      if (jobs.length > 0 && jobs.length >= batchLimit(p.vehicle, cfg.maxBatch)) continue;
      if (!(await this.caps.canOffer(p.driverId, this.exposure(r)))) continue;
      pool.push({ presence: p, jobs, distanceKm, fit });
    }
    const byId = new Map(pool.map((c) => [c.presence.driverId, c]));
    const ranked = this.ranker.withWeights(cfg.rankWeights).rank(
      pool.map((c) => ({
        driverId: c.presence.driverId,
        distanceKm: c.distanceKm,
        activeTrips: c.jobs.length,
        tier: c.presence.tier,
        vetted: c.presence.vetted,
        vehicleFit: c.fit,
        minutesInZone: this.presence.minutesInZone(c.presence),
      })),
    );
    const ordered = await this.weatherFirst(r, ranked);
    return ordered.map((d) => ({ ranked: d, presence: byId.get(d.driverId)!.presence, jobs: byId.get(d.driverId)!.jobs }));
  }

  /**
   * n6: on a hot or cold day (Aziziyah's calendar and clock, `climateAt`) a ride goes first to cars
   * whose AC / heating ops confirmed; each group keeps its rank order, so waves still fill nearest-best.
   * Rides only; the price never changes.
   */
  private async weatherFirst(r: DispatchRequest, ranked: RankedDriver[]): Promise<RankedDriver[]> {
    const feature = climateFeature(climateAt(this.clock.now()));
    if (!feature || !this.facts || !RIDE_VERTICALS.has(r.vertical) || ranked.length < 2) return ranked;
    const features = await this.facts.confirmedFeatures(ranked.map((d) => d.driverId));
    return preferFirst(ranked, (id) => features.get(id)?.includes(feature) ?? false);
  }

  /**
   * x1: on a hot or cold day, a taxi ride's candidates whose car has the climate's feature confirmed and
   * not said off this shift (`VehicleFactsPort` already leaves a «لا» out), in rank order; null when the
   * rule does not apply (mild weather, tuktuks, no vehicle facts bound).
   */
  private async climateOnly(r: DispatchRequest, cands: readonly Candidate[]): Promise<{ feature: VehicleFeature; drivers: Candidate[] } | null> {
    const feature = climateFeature(climateAt(this.clock.now()));
    if (!feature || !this.facts || r.vertical !== 'taxi') return null;
    const features = await this.facts.confirmedFeatures(cands.map((c) => c.ranked.driverId));
    return { feature, drivers: cands.filter((c) => features.get(c.ranked.driverId)?.includes(feature)) };
  }

  /** s6: the candidates fit for a «عوائل» ride (`familyFit`), in their rank order. */
  private async familyFit(cands: readonly Candidate[]): Promise<Candidate[]> {
    if (!this.facts || !this.riders || cands.length === 0) return [];
    const features = await this.facts.confirmedFeatures(cands.map((c) => c.ranked.driverId));
    const tagged = cands.filter((c) => features.get(c.ranked.driverId)?.includes('family'));
    if (tagged.length === 0) return [];
    const standing = await this.riders.standing(tagged.map((c) => c.ranked.driverId));
    const now = this.clock.now();
    return tagged.filter((c) => {
      const s = standing.get(c.ranked.driverId);
      return familyFit({ features: features.get(c.ranked.driverId) ?? [], rating: s?.rating ?? null, driverSince: s?.driverSince ?? null }, now);
    });
  }

  /** s5 / s4: the rider's avoid list and favourites, when the job is a rider's and ride habits are bound. */
  private async riderLists(job: DispatchJob): Promise<{ avoidDriverIds: string[]; favouriteDriverIds: string[] }> {
    if (!job.riderId || !this.riders) return { avoidDriverIds: [], favouriteDriverIds: [] };
    const [avoid, favourites] = await Promise.all([this.riders.avoided(job.riderId), this.riders.favourites(job.riderId)]);
    return { avoidDriverIds: avoid, favouriteDriverIds: favourites.filter((id) => !avoid.includes(id)) };
  }

  private async createOffers(
    r: DispatchRequest,
    policy: string,
    chosen: readonly Candidate[],
    o: { wave: number; pass: number; expiresAt: number; compensation: (driverId: string) => number },
  ): Promise<OfferRecord[]> {
    const sentAt = this.clock.now();
    const rows: NewOffer[] = chosen.map((c, i) => ({
      tripId: r.tripId,
      driverId: c.ranked.driverId,
      policy,
      wave: o.wave,
      pass: o.pass,
      rank: i + 1,
      distanceKm: Math.round(c.ranked.distanceKm * 1000) / 1000,
      compensationIqd: o.compensation(c.ranked.driverId),
      sentAt,
      expiresAt: new Date(o.expiresAt),
    }));
    return this.uow.run((tx) => this.repo.createOffers(rows, tx));
  }

  /** Times out open offers matching `which`. Seen-then-silent offers are "ignored" (edge-case §6). */
  private async expireOpen(r: DispatchRequest, which: (o: OfferRecord) => boolean): Promise<void> {
    for (const o of await this.repo.listByTrip(r.tripId)) {
      if (!OPEN_STATES.includes(o.state) || !which(o)) continue;
      const updated = await this.repo.updateOffer(o.id, OPEN_STATES, { state: 'timed_out' });
      if (!updated) continue;
      await this.trips.timeout(r.tripId, o.driverId, { othersPending: await this.hasOpen(r.tripId) });
      await this.emit('dispatch.offer_timed_out', r, { offerId: o.id, driverId: o.driverId, wave: o.wave, pass: o.pass, ignored: o.seenAt !== null });
    }
  }

  private async hasOpen(tripId: string): Promise<boolean> {
    return (await this.repo.listByTrip(tripId)).some((o) => OPEN_STATES.includes(o.state));
  }

  /** Cash the job puts in the driver's hand (a cash order's total); none = prepaid. */
  private exposure(r: DispatchRequest): JobExposure {
    const cash = r.cashIqd ?? 0;
    return cash > 0 ? { valueIqd: cash, prepaid: false } : { valueIqd: 0, prepaid: true };
  }

  private async withdrawOpen(r: DispatchRequest, exceptOfferId?: string): Promise<void> {
    for (const o of await this.repo.listByTrip(r.tripId)) {
      if (o.id === exceptOfferId || !OPEN_STATES.includes(o.state)) continue;
      await this.repo.updateOffer(o.id, OPEN_STATES, { state: 'withdrawn' });
    }
  }

  private async needsDispatcher(r: DispatchRequest, reason: string): Promise<void> {
    r.status = 'needs_dispatcher';
    r.red = true;
    r.nextTimerAt = null;
    await this.store.saveRequest(r);
    await this.emit('dispatch.needs_dispatcher', r, { reason });
  }

  private async emit(type: string, r: DispatchRequest, payload: Record<string, unknown>, actorId: string = SYSTEM): Promise<void> {
    await this.uow.run((tx) =>
      this.events.emit(tx, { actorId, type, occurredAt: this.clock.now(), tripId: r.tripId, payload: { cityId: r.cityId, vertical: r.vertical, ...payload } }, { name: 'trip', id: r.tripId }),
    );
  }
}

/** Declined, or seen (≥ 3 s foreground) and left to time out: excluded from the re-broadcast. */
export function isDeclinedOrIgnored(o: OfferRecord): boolean {
  return o.state === 'declined' || (o.state === 'timed_out' && o.seenAt !== null);
}
