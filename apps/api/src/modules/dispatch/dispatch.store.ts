import { randomUUID } from 'node:crypto';
import { DriverError, type DispatchPolicyKind, type DispatchStatus, type LatLng, type VehicleClass, type Vertical } from '@driver/contracts';
import type { Redis } from 'ioredis';

/**
 * Live state of one trip's dispatch (Redis `dispatch:req:{tripId}`). Timestamps are epoch ms so
 * the record round-trips through JSON unchanged.
 */
export interface DispatchRequest {
  tripId: string;
  cityId: string;
  vertical: Vertical;
  policy: DispatchPolicyKind;
  /** Suggest-only: nothing goes to drivers until the dispatcher overrides. */
  suggestOnly: boolean;
  zoneId: string;
  dropoffZoneId: string | null;
  pickup: LatLng;
  status: DispatchStatus;
  createdAt: number;
  /** When the search proper started (auto_assign starts at readyAt − (ETA + 2 min)). */
  searchStartedAt: number | null;
  /** 1-based current wave (broadcast / substitute auction); 0 before the first. */
  wave: number;
  /** 1-based pass (auto_assign passes; smart_broadcast: 1 = waves, 2 = re-broadcast). */
  pass: number;
  /** Bumped whenever timers must be invalidated (override, cancel, re-dispatch). */
  epoch: number;
  /** When the next timer fires; the board's countdown. */
  nextTimerAt: number | null;
  red: boolean;
  compensationActive: boolean;
  customerMayCancelFree: boolean;
  assignedDriverId: string | null;
  compensationIqd: number;
  suggestion: string[];
  // auto_assign
  readyAt: number | null;
  hot: boolean;
  batchWith: string[];
  departAt: number | null;
  /** The courier has the order in the bag (trips tells us); batching then skips its pickup. */
  pickedUp: boolean;
  /** Order cap (review A.16): smaller vehicles are not offered the job. Absent on records saved before M2 wiring. */
  minVehicleClass?: VehicleClass | null;
  /** Cash exposure checked against the driver's cap room (0 = prepaid). Absent on records saved before M2 wiring. */
  cashIqd?: number;
  // scheduled / pre_assigned
  routeId: string | null;
  routeDriverId: string | null;
  departureId: string | null;
  departureAt: number | null;
  eligibleDriverIds: string[] | null;
  /** Joy J7d: a ride booked for later starts its search then (epoch ms); null/absent = at once. */
  startAt?: number | null;
  /** Joy l9: the rider's favourite, offered the job alone for a minute when the search starts. */
  preferDriverIds?: string[];
  /** Ride step 3: who asked for the ride (its orderer); null/absent for jobs that are not a rider's. */
  riderId?: string | null;
  /** s5: drivers the rider keeps off his rides, read when the request starts; never offered this job. */
  avoidDriverIds?: string[];
  /** s4: the rider's favourites; one free within `autoFirstKm` of the pickup gets the ride first, alone. */
  favouriteDriverIds?: string[];
  /** s6 «عوائل»: the first wave goes to family-tagged, long-standing, well-rated drivers only. */
  familyPreferred?: boolean;
}

export interface PolicyOverride {
  policy?: DispatchPolicyKind;
  suggestOnly?: boolean;
  setBy: string;
  setAt: number;
}

/**
 * Dispatch runtime state: requests, the first-accept lock (SET NX), runtime policy overrides and
 * each driver's active jobs. Redis in production; the in-memory twin for tests and dev.
 */
export interface DispatchStore {
  getRequest(tripId: string): Promise<DispatchRequest | null>;
  saveRequest(r: DispatchRequest): Promise<void>;
  /** Drops the request from the city's board (finished or cancelled); the record lingers for a day. */
  retireRequest(r: DispatchRequest): Promise<void>;
  activeRequests(cityId: string): Promise<DispatchRequest[]>;
  /** SET key owner NX PX ttl — true only for the first caller. */
  tryLock(key: string, owner: string, ttlMs: number): Promise<boolean>;
  unlock(key: string): Promise<void>;
  getPolicyOverride(cityId: string, vertical: Vertical): Promise<PolicyOverride | null>;
  setPolicyOverride(cityId: string, vertical: Vertical, o: PolicyOverride | null): Promise<void>;
  driverJobs(driverId: string): Promise<string[]>;
  addDriverJob(driverId: string, tripId: string): Promise<void>;
  removeDriverJob(driverId: string, tripId: string): Promise<void>;
  /**
   * M2 review follow-up: runs `fn` while holding the driver's lock, so two accepts by the same driver
   * (different trips, two devices or two pods) cannot both pass the one-job / batching check before
   * either records its job. Redis: SET dispatch:driver-lock:{id} token NX PX, released by token.
   * In memory: a per-driver mutex. Not re-entrant — never call it from inside itself.
   */
  withDriverLock<T>(driverId: string, fn: () => Promise<T>): Promise<T>;
}

/** How long a driver lock may be held (a crashed holder frees it after this) and how long to wait for one. */
export const DRIVER_LOCK = { ttlMs: 10_000, waitMs: 5_000, retryMs: 20 } as const;

export const DISPATCH_STORE = Symbol('DISPATCH_STORE');

const RETIRED_TTL_SEC = 24 * 3600;
const reqKey = (tripId: string) => `dispatch:req:${tripId}`;
const activeKey = (cityId: string) => `dispatch:active:${cityId}`;
const policyKey = (cityId: string) => `dispatch:policy:${cityId}`;
const jobsKey = (driverId: string) => `dispatch:jobs:${driverId}`;
export const lockKey = (tripId: string) => `dispatch:lock:${tripId}`;
export const driverLockKey = (driverId: string) => `dispatch:driver-lock:${driverId}`;

/** Deletes the lock only if we still own it (a lock that expired and was re-taken is not ours). */
const RELEASE_IF_OWNER = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ───────────────────────── Redis ─────────────────────────

export class RedisDispatchStore implements DispatchStore {
  constructor(private readonly redis: Redis) {}

  async getRequest(tripId: string): Promise<DispatchRequest | null> {
    const raw = await this.redis.get(reqKey(tripId));
    return raw ? (JSON.parse(raw) as DispatchRequest) : null;
  }

  async saveRequest(r: DispatchRequest): Promise<void> {
    await this.redis.multi().set(reqKey(r.tripId), JSON.stringify(r)).sadd(activeKey(r.cityId), r.tripId).exec();
  }

  async retireRequest(r: DispatchRequest): Promise<void> {
    await this.redis
      .multi()
      .set(reqKey(r.tripId), JSON.stringify(r), 'EX', RETIRED_TTL_SEC)
      .srem(activeKey(r.cityId), r.tripId)
      .exec();
  }

  async activeRequests(cityId: string): Promise<DispatchRequest[]> {
    const ids = await this.redis.smembers(activeKey(cityId));
    if (ids.length === 0) return [];
    const raws = await this.redis.mget(...ids.map(reqKey));
    return raws.filter((r): r is string => Boolean(r)).map((r) => JSON.parse(r) as DispatchRequest);
  }

  async tryLock(key: string, owner: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(key, owner, 'PX', ttlMs, 'NX')) === 'OK';
  }

  async unlock(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async getPolicyOverride(cityId: string, vertical: Vertical): Promise<PolicyOverride | null> {
    const raw = await this.redis.hget(policyKey(cityId), vertical);
    return raw ? (JSON.parse(raw) as PolicyOverride) : null;
  }

  async setPolicyOverride(cityId: string, vertical: Vertical, o: PolicyOverride | null): Promise<void> {
    if (o) await this.redis.hset(policyKey(cityId), vertical, JSON.stringify(o));
    else await this.redis.hdel(policyKey(cityId), vertical);
  }

  async driverJobs(driverId: string): Promise<string[]> {
    return (await this.redis.smembers(jobsKey(driverId))).sort();
  }

  async addDriverJob(driverId: string, tripId: string): Promise<void> {
    await this.redis.sadd(jobsKey(driverId), tripId);
  }

  async removeDriverJob(driverId: string, tripId: string): Promise<void> {
    await this.redis.srem(jobsKey(driverId), tripId);
  }

  async withDriverLock<T>(driverId: string, fn: () => Promise<T>): Promise<T> {
    const key = driverLockKey(driverId);
    const token = randomUUID();
    const deadline = Date.now() + DRIVER_LOCK.waitMs;
    while ((await this.redis.set(key, token, 'PX', DRIVER_LOCK.ttlMs, 'NX')) !== 'OK') {
      // Another accept for this driver is in flight; after it he holds a job, so this one would
      // fail the one-job check anyway. Wait briefly, then give up with that answer.
      if (Date.now() >= deadline) throw new DriverError('offer_conflicts_current_job');
      await sleep(DRIVER_LOCK.retryMs);
    }
    try {
      return await fn();
    } finally {
      await this.redis.eval(RELEASE_IF_OWNER, 1, key, token);
    }
  }
}

// ───────────────────────── In-memory ─────────────────────────

export class InMemoryDispatchStore implements DispatchStore {
  private readonly requests = new Map<string, DispatchRequest>();
  private readonly active = new Map<string, Set<string>>();
  private readonly locks = new Map<string, { owner: string; until: number }>();
  private readonly policies = new Map<string, PolicyOverride>();
  private readonly jobs = new Map<string, Set<string>>();
  /** Tail of each driver's lock queue: the next holder waits for it. */
  private readonly driverLocks = new Map<string, Promise<void>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async getRequest(tripId: string): Promise<DispatchRequest | null> {
    const r = this.requests.get(tripId);
    return r ? structuredClone(r) : null;
  }

  async saveRequest(r: DispatchRequest): Promise<void> {
    this.requests.set(r.tripId, structuredClone(r));
    const set = this.active.get(r.cityId) ?? new Set<string>();
    set.add(r.tripId);
    this.active.set(r.cityId, set);
  }

  async retireRequest(r: DispatchRequest): Promise<void> {
    this.requests.set(r.tripId, structuredClone(r));
    this.active.get(r.cityId)?.delete(r.tripId);
  }

  async activeRequests(cityId: string): Promise<DispatchRequest[]> {
    return [...(this.active.get(cityId) ?? [])].map((id) => structuredClone(this.requests.get(id)!)).filter(Boolean);
  }

  async tryLock(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = this.now().getTime();
    const held = this.locks.get(key);
    if (held && held.until > now) return false;
    this.locks.set(key, { owner, until: now + ttlMs });
    return true;
  }

  async unlock(key: string): Promise<void> {
    this.locks.delete(key);
  }

  async getPolicyOverride(cityId: string, vertical: Vertical): Promise<PolicyOverride | null> {
    return this.policies.get(`${cityId}:${vertical}`) ?? null;
  }

  async setPolicyOverride(cityId: string, vertical: Vertical, o: PolicyOverride | null): Promise<void> {
    if (o) this.policies.set(`${cityId}:${vertical}`, { ...o });
    else this.policies.delete(`${cityId}:${vertical}`);
  }

  async driverJobs(driverId: string): Promise<string[]> {
    return [...(this.jobs.get(driverId) ?? [])].sort();
  }

  async addDriverJob(driverId: string, tripId: string): Promise<void> {
    const set = this.jobs.get(driverId) ?? new Set<string>();
    set.add(tripId);
    this.jobs.set(driverId, set);
  }

  async removeDriverJob(driverId: string, tripId: string): Promise<void> {
    this.jobs.get(driverId)?.delete(tripId);
  }

  async withDriverLock<T>(driverId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.driverLocks.get(driverId) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const tail = prev.then(() => mine);
    this.driverLocks.set(driverId, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.driverLocks.get(driverId) === tail) this.driverLocks.delete(driverId);
    }
  }
}
