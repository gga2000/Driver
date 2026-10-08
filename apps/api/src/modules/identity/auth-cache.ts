import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Clock } from '../../shared/clock.js';
import { afterCommit, type Tx } from '../../shared/db/unit-of-work.js';
import type { IdentityRepository, RoleRecord, SessionRecord } from './identity.repository.js';

/**
 * How long a signed-in person's session row and roles are kept in this machine's memory (speed
 * round four, x4). Every signed-in call checks the session and most check roles; at a full evening
 * those reads are a large share of the database's work. Any change to a session or a role drops the
 * entry at once, here and on every other API machine, so 30 seconds is only the fallback bound.
 * `AUTH_CACHE_TTL_SEC=0` turns the cache off; larger values are capped at 30.
 */
export const AUTH_CACHE_MAX_TTL_SEC = 30;

/** Entries kept per kind before the oldest are dropped (a person's session and roles are small). */
const MAX_ENTRIES = 20_000;

export function authCacheTtlMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['AUTH_CACHE_TTL_SEC'];
  const sec = raw === undefined || raw === '' ? AUTH_CACHE_MAX_TTL_SEC : Number(raw);
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.min(sec, AUTH_CACHE_MAX_TTL_SEC) * 1000;
}

/** What one machine tells the others to forget: one session, or everything of one person. */
export type AuthDrop = { session: string } | { person: string };

/** Carries drops between API machines. The in-process bus is for one machine (dev, tests). */
export interface AuthDropBus {
  publish(drop: AuthDrop): Promise<void>;
  /** `onDrop` for drops from other machines; `onGap` when drops may have been missed (reconnect). */
  listen(onDrop: (drop: AuthDrop) => void, onGap: () => void): void;
  close(): Promise<void>;
}

export class InProcessDropBus implements AuthDropBus {
  async publish(): Promise<void> {}
  listen(): void {}
  async close(): Promise<void> {}
}

/**
 * Redis pub/sub between API machines: one connection publishes, a second (subscriber mode)
 * listens. A drop published by this machine comes back to it too and is ignored by its origin id.
 * After the subscriber reconnects, drops sent meanwhile are lost, so the whole cache is cleared.
 */
export class RedisDropBus implements AuthDropBus {
  static readonly CHANNEL = 'driver:identity:auth-drop';
  private readonly logger = new Logger(RedisDropBus.name);
  private readonly origin = randomUUID();
  private connectedOnce = false;

  constructor(
    private readonly pub: Redis,
    private readonly sub: Redis,
  ) {}

  async publish(drop: AuthDrop): Promise<void> {
    try {
      await this.pub.publish(RedisDropBus.CHANNEL, JSON.stringify({ o: this.origin, ...drop }));
    } catch (err) {
      // Other machines then keep the old entry until it expires (at most the TTL).
      this.logger.warn(`auth cache drop not sent: ${(err as Error).message}`);
    }
  }

  listen(onDrop: (drop: AuthDrop) => void, onGap: () => void): void {
    this.sub.on('message', (channel: string, raw: string) => {
      if (channel !== RedisDropBus.CHANNEL) return;
      try {
        const msg = JSON.parse(raw) as { o?: string; session?: unknown; person?: unknown };
        if (msg.o === this.origin) return;
        if (typeof msg.session === 'string') onDrop({ session: msg.session });
        else if (typeof msg.person === 'string') onDrop({ person: msg.person });
      } catch {
        onGap();
      }
    });
    this.sub.on('ready', () => {
      if (this.connectedOnce) onGap();
      this.connectedOnce = true;
    });
    this.sub.subscribe(RedisDropBus.CHANNEL).catch((err: Error) => {
      this.logger.warn(`auth cache drops not received: ${err.message}`);
      onGap();
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}

interface Entry<T> {
  value: T;
  until: number;
  personId: string;
}

/**
 * The memory itself. A read stores its answer only if nothing was dropped while it was in flight
 * (`epoch`), so a slow read that started before a sign-out can never put the old row back.
 */
export class AuthCache {
  private readonly sessions = new Map<string, Entry<SessionRecord>>();
  private readonly roles = new Map<string, Entry<RoleRecord[]>>();
  private epoch = 0;

  constructor(
    private readonly clock: Clock,
    readonly ttlMs: number,
    private readonly bus: AuthDropBus = new InProcessDropBus(),
  ) {
    bus.listen(
      (drop) => this.apply(drop),
      () => this.clear(),
    );
  }

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  async session(id: string, load: () => Promise<SessionRecord | null>): Promise<SessionRecord | null> {
    const hit = this.fresh(this.sessions, id);
    if (hit) return { ...hit.value };
    const started = this.epoch;
    const row = await load();
    // A missing session is not kept: the next call asks the database again.
    if (row && started === this.epoch) this.put(this.sessions, id, { ...row }, row.personId);
    return row;
  }

  async rolesOf(personId: string, load: () => Promise<RoleRecord[]>): Promise<RoleRecord[]> {
    const hit = this.fresh(this.roles, personId);
    if (hit) return hit.value.map((r) => ({ ...r }));
    const started = this.epoch;
    const rows = await load();
    // Copies in and out: nobody holding a returned row can change what the next caller reads.
    if (started === this.epoch) this.put(this.roles, personId, rows.map((r) => ({ ...r })), personId);
    return rows;
  }

  /** Forgets here and tells the other machines. */
  async drop(drop: AuthDrop): Promise<void> {
    this.apply(drop);
    await this.bus.publish(drop);
  }

  clear(): void {
    this.epoch++;
    this.sessions.clear();
    this.roles.clear();
  }

  close(): Promise<void> {
    return this.bus.close();
  }

  private apply(drop: AuthDrop): void {
    this.epoch++;
    if ('session' in drop) {
      this.sessions.delete(drop.session);
      return;
    }
    this.roles.delete(drop.person);
    for (const [id, e] of this.sessions) if (e.personId === drop.person) this.sessions.delete(id);
  }

  private fresh<T>(map: Map<string, Entry<T>>, key: string): Entry<T> | null {
    const e = map.get(key);
    if (!e) return null;
    if (e.until > this.clock.now().getTime()) return e;
    map.delete(key);
    return null;
  }

  private put<T>(map: Map<string, Entry<T>>, key: string, value: T, personId: string): void {
    map.delete(key);
    if (map.size >= MAX_ENTRIES) {
      const oldest = map.keys().next();
      if (!oldest.done) map.delete(oldest.value);
    }
    map.set(key, { value, until: this.clock.now().getTime() + this.ttlMs, personId });
  }
}

/**
 * Wraps the identity repository so the two reads every signed-in call makes (`findSessionById`,
 * `rolesOf`) come from `AuthCache`, and every write to a session or a role drops what it touched.
 * Only reads outside a transaction are cached; a read inside one always goes to the database. A
 * write inside a transaction drops at once and again after the commit, so no read in between can
 * keep the old row. Only this repository writes sessions and roles, so these are all the writes.
 */
export function cachedIdentityRepository(inner: IdentityRepository, cache: AuthCache): IdentityRepository {
  if (!cache.enabled) return inner;
  const dropAfter = async (tx: Tx | undefined, drop: AuthDrop) => {
    await cache.drop(drop);
    afterCommit(tx, () => cache.drop(drop));
  };
  const overrides: Partial<IdentityRepository> = {
    findSessionById: (id, tx) => (tx ? inner.findSessionById(id, tx) : cache.session(id, () => inner.findSessionById(id))),
    rolesOf: (personId, tx) => (tx ? inner.rolesOf(personId, tx) : cache.rolesOf(personId, () => inner.rolesOf(personId))),
    updateSession: async (id, patch, tx) => {
      const row = await inner.updateSession(id, patch, tx);
      await dropAfter(tx, { session: id });
      return row;
    },
    rotateSession: async (id, expect, patch, tx) => {
      const row = await inner.rotateSession(id, expect, patch, tx);
      await dropAfter(tx, { session: id });
      return row;
    },
    revokeSessionsOf: async (personId, now, tx) => {
      const n = await inner.revokeSessionsOf(personId, now, tx);
      await dropAfter(tx, { person: personId });
      return n;
    },
    upsertRole: async (input, tx) => {
      const out = await inner.upsertRole(input, tx);
      await dropAfter(tx, { person: input.personId });
      return out;
    },
    revokeRole: async (id, now, tx) => {
      const role = await inner.revokeRole(id, now, tx);
      await dropAfter(tx, { person: role.personId });
      return role;
    },
    setRolesFrozen: async (personId, kinds, frozenAt, tx) => {
      const n = await inner.setRolesFrozen(personId, kinds, frozenAt, tx);
      await dropAfter(tx, { person: personId });
      return n;
    },
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop as keyof IdentityRepository];
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
