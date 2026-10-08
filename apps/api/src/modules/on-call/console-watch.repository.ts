import { randomUUID } from 'node:crypto';
import type { ConsoleLiveState, ConsoleWatchAlert, ConsoleWatchKind } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** `console_presence`: one open staff screen (a browser tab) and its live updates. */
export interface PresenceRecord {
  cityId: string;
  tabId: string;
  personId: string;
  live: ConsoleLiveState;
  /** When `live` last changed. */
  liveSince: Date;
  lastSeenAt: Date;
}

export interface ConsoleWatchRepository {
  /** A tab's heartbeat: keeps `liveSince` while the state is unchanged, resets it when it changes. */
  touch(input: Omit<PresenceRecord, 'liveSince' | 'lastSeenAt'>, at: Date): Promise<void>;
  /** The city's tabs seen at or after `since`. */
  presentSince(cityId: string, since: Date): Promise<PresenceRecord[]>;
  /** The newest heartbeat in the city, or null when no screen was ever open. */
  lastSeen(cityId: string): Promise<Date | null>;
  /** Drops heartbeats older than `before`; returns how many. */
  dropBefore(before: Date): Promise<number>;

  /** Opens the city's alert of this kind; null when one is already open (the open key is the claim). */
  open(cityId: string, kind: ConsoleWatchKind, at: Date, tx?: Tx): Promise<ConsoleWatchAlert | null>;
  setPaged(id: string, paged: number, tx?: Tx): Promise<void>;
  /** Closes the city's open alert of this kind; true when this call did it. */
  close(cityId: string, kind: ConsoleWatchKind, at: Date, tx?: Tx): Promise<boolean>;
  openFor(cityId: string): Promise<ConsoleWatchAlert[]>;
}

export const CONSOLE_WATCH_REPOSITORY = Symbol('CONSOLE_WATCH_REPOSITORY');

const newId = () => `cwa_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const openKey = (cityId: string, kind: ConsoleWatchKind) => `${cityId}:${kind}`;

export class InMemoryConsoleWatchRepository implements ConsoleWatchRepository {
  private readonly tabs = new Map<string, PresenceRecord>();
  private readonly alerts = new Map<string, ConsoleWatchAlert>();

  async touch(input: Omit<PresenceRecord, 'liveSince' | 'lastSeenAt'>, at: Date): Promise<void> {
    const key = `${input.cityId}:${input.tabId}`;
    const was = this.tabs.get(key);
    this.tabs.set(key, {
      ...input,
      liveSince: was && was.live === input.live ? was.liveSince : at,
      lastSeenAt: at,
    });
  }
  async presentSince(cityId: string, since: Date): Promise<PresenceRecord[]> {
    return [...this.tabs.values()]
      .filter((t) => t.cityId === cityId && t.lastSeenAt.getTime() >= since.getTime())
      .map((t) => ({ ...t }));
  }
  async lastSeen(cityId: string): Promise<Date | null> {
    let last: Date | null = null;
    for (const t of this.tabs.values())
      if (t.cityId === cityId && (!last || t.lastSeenAt.getTime() > last.getTime()))
        last = t.lastSeenAt;
    return last;
  }
  async dropBefore(before: Date): Promise<number> {
    let n = 0;
    for (const [k, t] of this.tabs)
      if (t.lastSeenAt.getTime() < before.getTime()) {
        this.tabs.delete(k);
        n += 1;
      }
    return n;
  }
  async open(cityId: string, kind: ConsoleWatchKind, at: Date): Promise<ConsoleWatchAlert | null> {
    if (this.alerts.has(openKey(cityId, kind))) return null;
    const rec: ConsoleWatchAlert = { id: newId(), cityId, kind, openedAt: at, paged: 0, closedAt: null };
    this.alerts.set(openKey(cityId, kind), rec);
    return { ...rec };
  }
  async setPaged(id: string, paged: number): Promise<void> {
    for (const a of this.alerts.values()) if (a.id === id) a.paged = paged;
  }
  async close(cityId: string, kind: ConsoleWatchKind, at: Date): Promise<boolean> {
    const a = this.alerts.get(openKey(cityId, kind));
    if (!a) return false;
    a.closedAt = at;
    this.alerts.delete(openKey(cityId, kind));
    return true;
  }
  async openFor(cityId: string): Promise<ConsoleWatchAlert[]> {
    return [...this.alerts.values()].filter((a) => a.cityId === cityId).map((a) => ({ ...a }));
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row ↔ record mapping */
const presenceFrom = (r: any): PresenceRecord => ({
  cityId: r.cityId,
  tabId: r.tabId,
  personId: r.personId,
  live: r.live,
  liveSince: r.liveSince,
  lastSeenAt: r.lastSeenAt,
});
const alertFrom = (r: any): ConsoleWatchAlert => ({
  id: r.id,
  cityId: r.cityId,
  kind: r.kind,
  openedAt: r.openedAt,
  paged: r.paged,
  closedAt: r.closedAt,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export class PrismaConsoleWatchRepository implements ConsoleWatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async touch(input: Omit<PresenceRecord, 'liveSince' | 'lastSeenAt'>, at: Date): Promise<void> {
    const db = this.db();
    // Same state as last time: only the time moves (the common case, one write).
    const same = await db.consolePresence.updateMany({
      where: { cityId: input.cityId, tabId: input.tabId, live: input.live },
      data: { personId: input.personId, lastSeenAt: at },
    });
    if (same.count > 0) return;
    await db.consolePresence.upsert({
      where: { cityId_tabId: { cityId: input.cityId, tabId: input.tabId } },
      create: { ...input, liveSince: at, lastSeenAt: at },
      update: { personId: input.personId, live: input.live, liveSince: at, lastSeenAt: at },
    });
  }
  async presentSince(cityId: string, since: Date): Promise<PresenceRecord[]> {
    const rows = await this.db().consolePresence.findMany({
      where: { cityId, lastSeenAt: { gte: since } },
      take: 500,
    });
    return rows.map(presenceFrom);
  }
  async lastSeen(cityId: string): Promise<Date | null> {
    const r = await this.db().consolePresence.findFirst({
      where: { cityId },
      orderBy: { lastSeenAt: 'desc' },
      select: { lastSeenAt: true },
    });
    return r?.lastSeenAt ?? null;
  }
  async dropBefore(before: Date): Promise<number> {
    const res = await this.db().consolePresence.deleteMany({
      where: { lastSeenAt: { lt: before } },
    });
    return res.count;
  }
  async open(
    cityId: string,
    kind: ConsoleWatchKind,
    at: Date,
    tx?: Tx,
  ): Promise<ConsoleWatchAlert | null> {
    const id = newId();
    // ON CONFLICT DO NOTHING: a unique violation would abort the caller's transaction.
    const res = await this.db(tx).consoleWatchAlert.createMany({
      data: [{ id, cityId, kind, openKey: openKey(cityId, kind), openedAt: at }],
      skipDuplicates: true,
    });
    if (res.count !== 1) return null;
    return alertFrom(await this.db(tx).consoleWatchAlert.findUniqueOrThrow({ where: { id } }));
  }
  async setPaged(id: string, paged: number, tx?: Tx): Promise<void> {
    await this.db(tx).consoleWatchAlert.update({ where: { id }, data: { paged } });
  }
  async close(cityId: string, kind: ConsoleWatchKind, at: Date, tx?: Tx): Promise<boolean> {
    const res = await this.db(tx).consoleWatchAlert.updateMany({
      where: { openKey: openKey(cityId, kind) },
      data: { openKey: null, closedAt: at },
    });
    return res.count === 1;
  }
  async openFor(cityId: string): Promise<ConsoleWatchAlert[]> {
    const rows = await this.db().consoleWatchAlert.findMany({
      where: { cityId, openKey: { not: null } },
      orderBy: { openedAt: 'asc' },
    });
    return rows.map(alertFrom);
  }
}
