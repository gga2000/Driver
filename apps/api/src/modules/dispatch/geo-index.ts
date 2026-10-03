import type { LatLng, VehicleClass } from '@driver/contracts';
import type { Redis } from 'ioredis';
import { haversineKm } from './geo.js';

/** Presence TTL: a driver silent for 90 s drops out of every search (plan Step 5). */
export const PRESENCE_TTL_SEC = 90;
/** "All city" waves search this far from the pickup. */
export const CITY_RADIUS_KM = 50;

/** What dispatch knows about an online driver; stored in the `driver:{id}` hash. */
export interface DriverPresence {
  driverId: string;
  cityId: string;
  lat: number;
  lng: number;
  vehicle: VehicleClass;
  tier: 'bronze' | 'silver' | 'gold';
  /** Vetted for khat substitute auctions. */
  vetted: boolean;
  /** Tuktuks never get edge-zone jobs unless they opted in (edge-case decisions, "edge zones opt-in for tuktuks"). */
  edgeOptIn: boolean;
  zoneId: string | null;
  /** Epoch ms the driver entered `zoneId`; the anti-camping clock (review J112). */
  zoneSince: number;
  lastSeenAt: number;
}

export interface NearbyDriver {
  presence: DriverPresence;
  distanceKm: number;
}

/**
 * Online-driver index. Redis: `GEOADD drivers:{cityId}` for position, `HSET driver:{id}` for the
 * rest, `EXPIRE driver:{id} 90` refreshed on every heartbeat. A geo member whose hash expired is
 * stale: searches skip it and remove it lazily. The in-memory twin runs the same contract on a clock.
 */
export interface GeoIndex {
  put(p: DriverPresence, ttlSec?: number): Promise<void>;
  get(driverId: string): Promise<DriverPresence | null>;
  remove(cityId: string, driverId: string): Promise<void>;
  /** Live drivers within `radiusKm` of `at`, nearest first. */
  search(cityId: string, at: LatLng, radiusKm: number, count?: number): Promise<NearbyDriver[]>;
  /** Every live driver in the city, by id (the Console map). */
  list(cityId: string): Promise<DriverPresence[]>;
}

export const GEO_INDEX = Symbol('GEO_INDEX');

export const geoKey = (cityId: string) => `drivers:${cityId}`;
export const driverKey = (driverId: string) => `driver:${driverId}`;

function toHash(p: DriverPresence): Record<string, string> {
  return {
    driverId: p.driverId,
    cityId: p.cityId,
    lat: String(p.lat),
    lng: String(p.lng),
    vehicle: p.vehicle,
    tier: p.tier,
    vetted: p.vetted ? '1' : '0',
    edgeOptIn: p.edgeOptIn ? '1' : '0',
    zoneId: p.zoneId ?? '',
    zoneSince: String(p.zoneSince),
    lastSeenAt: String(p.lastSeenAt),
  };
}

function fromHash(h: Record<string, string>): DriverPresence | null {
  if (!h['driverId'] || !h['cityId']) return null;
  return {
    driverId: h['driverId'],
    cityId: h['cityId'],
    lat: Number(h['lat']),
    lng: Number(h['lng']),
    vehicle: h['vehicle'] as VehicleClass,
    tier: h['tier'] as DriverPresence['tier'],
    vetted: h['vetted'] === '1',
    edgeOptIn: h['edgeOptIn'] === '1',
    zoneId: h['zoneId'] ? h['zoneId'] : null,
    zoneSince: Number(h['zoneSince']),
    lastSeenAt: Number(h['lastSeenAt']),
  };
}

// ───────────────────────── Redis ─────────────────────────

export class RedisGeoIndex implements GeoIndex {
  constructor(private readonly redis: Redis) {}

  async put(p: DriverPresence, ttlSec = PRESENCE_TTL_SEC): Promise<void> {
    const prev = await this.redis.hget(driverKey(p.driverId), 'cityId');
    const multi = this.redis.multi();
    if (prev && prev !== p.cityId) multi.zrem(geoKey(prev), p.driverId);
    multi.geoadd(geoKey(p.cityId), p.lng, p.lat, p.driverId);
    multi.hset(driverKey(p.driverId), toHash(p));
    multi.expire(driverKey(p.driverId), ttlSec);
    await multi.exec();
  }

  async get(driverId: string): Promise<DriverPresence | null> {
    return fromHash(await this.redis.hgetall(driverKey(driverId)));
  }

  async remove(cityId: string, driverId: string): Promise<void> {
    await this.redis.multi().zrem(geoKey(cityId), driverId).del(driverKey(driverId)).exec();
  }

  async search(cityId: string, at: LatLng, radiusKm: number, count?: number): Promise<NearbyDriver[]> {
    const args: Array<string | number> = ['FROMLONLAT', at.lng, at.lat, 'BYRADIUS', radiusKm, 'km', 'ASC', 'WITHDIST'];
    if (count !== undefined) args.push('COUNT', count);
    const rows = (await this.redis.geosearch(geoKey(cityId), ...args)) as Array<[string, string]>;
    if (rows.length === 0) return [];
    const pipe = this.redis.pipeline();
    for (const [member] of rows) pipe.hgetall(driverKey(member));
    const hashes = (await pipe.exec()) ?? [];
    const out: NearbyDriver[] = [];
    const stale: string[] = [];
    rows.forEach(([member, dist], i) => {
      const presence = fromHash((hashes[i]?.[1] as Record<string, string> | undefined) ?? {});
      if (!presence || presence.cityId !== cityId) stale.push(member);
      else out.push({ presence, distanceKm: Number(dist) });
    });
    if (stale.length > 0) await this.redis.zrem(geoKey(cityId), ...stale);
    return out;
  }

  async list(cityId: string): Promise<DriverPresence[]> {
    const members = await this.redis.zrange(geoKey(cityId), '0', '-1');
    if (members.length === 0) return [];
    const pipe = this.redis.pipeline();
    for (const m of members) pipe.hgetall(driverKey(m));
    const hashes = (await pipe.exec()) ?? [];
    const out: DriverPresence[] = [];
    const stale: string[] = [];
    members.forEach((m, i) => {
      const p = fromHash((hashes[i]?.[1] as Record<string, string> | undefined) ?? {});
      if (!p || p.cityId !== cityId) stale.push(m);
      else out.push(p);
    });
    if (stale.length > 0) await this.redis.zrem(geoKey(cityId), ...stale);
    return out.sort((a, b) => a.driverId.localeCompare(b.driverId));
  }
}

// ───────────────────────── In-memory ─────────────────────────

export class InMemoryGeoIndex implements GeoIndex {
  private readonly cities = new Map<string, Set<string>>();

  private readonly hashes = new Map<string, { p: DriverPresence; expiresAt: number }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  private live(driverId: string): DriverPresence | null {
    const h = this.hashes.get(driverId);
    if (!h) return null;
    if (h.expiresAt <= this.now().getTime()) {
      this.hashes.delete(driverId);
      return null;
    }
    return h.p;
  }

  async put(p: DriverPresence, ttlSec = PRESENCE_TTL_SEC): Promise<void> {
    const prev = this.hashes.get(p.driverId)?.p.cityId;
    if (prev && prev !== p.cityId) this.cities.get(prev)?.delete(p.driverId);
    const set = this.cities.get(p.cityId) ?? new Set<string>();
    set.add(p.driverId);
    this.cities.set(p.cityId, set);
    this.hashes.set(p.driverId, { p: { ...p }, expiresAt: this.now().getTime() + ttlSec * 1000 });
  }

  async get(driverId: string): Promise<DriverPresence | null> {
    const p = this.live(driverId);
    return p ? { ...p } : null;
  }

  async remove(cityId: string, driverId: string): Promise<void> {
    this.cities.get(cityId)?.delete(driverId);
    this.hashes.delete(driverId);
  }

  async search(cityId: string, at: LatLng, radiusKm: number, count?: number): Promise<NearbyDriver[]> {
    const members = this.cities.get(cityId) ?? new Set<string>();
    const out: NearbyDriver[] = [];
    for (const id of [...members]) {
      const p = this.live(id);
      if (!p) {
        members.delete(id);
        continue;
      }
      const distanceKm = haversineKm(at, p);
      if (distanceKm <= radiusKm) out.push({ presence: { ...p }, distanceKm: Math.round(distanceKm * 10_000) / 10_000 });
    }
    out.sort((a, b) => a.distanceKm - b.distanceKm || a.presence.driverId.localeCompare(b.presence.driverId));
    return count === undefined ? out : out.slice(0, count);
  }

  async list(cityId: string): Promise<DriverPresence[]> {
    const members = this.cities.get(cityId) ?? new Set<string>();
    const out: DriverPresence[] = [];
    for (const id of [...members]) {
      const p = this.live(id);
      if (p) out.push({ ...p });
      else members.delete(id);
    }
    return out.sort((a, b) => a.driverId.localeCompare(b.driverId));
  }
}
