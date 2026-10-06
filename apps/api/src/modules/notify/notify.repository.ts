import { randomUUID } from 'node:crypto';
import {
  NOTIFY_TEMPLATES,
  type DeliveryStatus,
  type NotifyApp,
  type NotifyChannel,
  type NotifyPreferences,
  type NotifyTemplateId,
  type PushPlatform,
  type PushTokenKind,
} from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

export interface PushTokenRecord {
  id: string;
  token: string;
  kind: PushTokenKind;
  personId: string;
  sessionId: string | null;
  app: NotifyApp;
  platform: PushPlatform;
  appVersion: string | null;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface TicketRecord {
  token: string;
  kind: PushTokenKind;
  id: string | null;
  ok: boolean;
  error?: string;
  /** Filled by the receipts poll. */
  receipt?: 'ok' | 'error';
}

/** What a delivery carries: the template params (never a phone number) and what was rendered. */
export interface DeliveryPayload {
  params: Record<string, string>;
  /** Caller-supplied push text (chat). */
  content?: { title: string; body: string } | null;
  /** Extra push data (deep-link ids…). */
  data?: Record<string, string>;
  /** Which app's tokens (`any`: every app). */
  app: NotifyApp | 'any';
  title: string | null;
  body: string | null;
}

export interface DeliveryRecord {
  id: string;
  dedupeKey: string;
  eventId: string;
  template: NotifyTemplateId;
  personId: string;
  orderId: string | null;
  channel: NotifyChannel;
  status: DeliveryStatus;
  reason: string | null;
  provider: string | null;
  providerRef: string | null;
  tickets: TicketRecord[] | null;
  attempts: number;
  twin: boolean;
  payload: DeliveryPayload;
  notBefore: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewDelivery = Omit<DeliveryRecord, 'id' | 'createdAt' | 'updatedAt' | 'provider' | 'providerRef' | 'tickets' | 'attempts' | 'sentAt' | 'deliveredAt'>;
export type DeliveryPatch = Partial<Pick<DeliveryRecord, 'status' | 'reason' | 'provider' | 'providerRef' | 'tickets' | 'attempts' | 'payload' | 'notBefore' | 'sentAt' | 'deliveredAt'>>;

export interface RegisterTokenInput {
  token: string;
  kind: PushTokenKind;
  personId: string;
  sessionId: string | null;
  app: NotifyApp;
  platform: PushPlatform;
  appVersion: string | null;
}

/**
 * The notify module's own tables (`push_tokens`, `notify_preferences`, `notify_deliveries`).
 * `insertDeliveries` is the dedupe point: a row whose (dedupe key, channel) exists is skipped, and
 * only the rows actually inserted come back.
 */
export interface NotifyRepository {
  upsertToken(input: RegisterTokenInput, now: Date): Promise<PushTokenRecord>;
  /** Deletes a token; with `personId`, only when it is that person's. */
  deleteToken(token: string, personId?: string): Promise<boolean>;
  deleteTokens(tokens: readonly string[]): Promise<number>;
  deleteSessionTokens(sessionId: string): Promise<number>;
  tokensOf(personId: string, app?: NotifyApp): Promise<PushTokenRecord[]>;
  preferences(personId: string): Promise<NotifyPreferences | null>;
  setPreferences(personId: string, prefs: NotifyPreferences, now: Date): Promise<NotifyPreferences>;
  insertDeliveries(rows: readonly NewDelivery[], now: Date, tx?: Tx): Promise<DeliveryRecord[]>;
  delivery(id: string): Promise<DeliveryRecord | null>;
  byDedupe(dedupeKey: string): Promise<DeliveryRecord[]>;
  byProviderRef(ref: string): Promise<DeliveryRecord | null>;
  updateDelivery(id: string, patch: DeliveryPatch, now: Date): Promise<DeliveryRecord>;
  /** Marketing messages that went (or are going) to a person since `since`, one per dedupe key. */
  countMarketingSince(personId: string, since: Date): Promise<number>;
  log(filter: { personId?: string | undefined; orderId?: string | undefined; limit: number }): Promise<DeliveryRecord[]>;
  /** "خبرني لمن ينفتح": one row per person and service; asking again refreshes the zone and time. */
  saveLaunchInterest(input: { personId: string; service: string; zoneKey: string | null }, now: Date): Promise<void>;
  launchInterestsOf(personId: string): Promise<string[]>;
  /** Every interest row (the Console aggregates them; a few thousand rows at most per city). */
  launchInterests(): Promise<LaunchInterestRecord[]>;
}

export interface LaunchInterestRecord {
  personId: string;
  service: string;
  zoneKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const NOTIFY_REPOSITORY = Symbol('NOTIFY_REPOSITORY');

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const MARKETING_TEMPLATES = Object.values(NOTIFY_TEMPLATES)
  .filter((d) => d.category === 'marketing')
  .map((d) => d.id);
const COUNTED: readonly DeliveryStatus[] = ['queued', 'deferred', 'sent', 'delivered', 'read'];

// ───────────────────────── in memory ─────────────────────────

export class InMemoryNotifyRepository implements NotifyRepository {
  readonly tokens = new Map<string, PushTokenRecord>();
  readonly prefs = new Map<string, NotifyPreferences>();
  readonly deliveries = new Map<string, DeliveryRecord>();
  readonly interests = new Map<string, LaunchInterestRecord>();
  private readonly byKey = new Map<string, string>();
  /** Insertion order: the log's tie-break for rows created in the same millisecond. */
  private readonly seqOf = new Map<string, number>();

  async upsertToken(input: RegisterTokenInput, now: Date): Promise<PushTokenRecord> {
    const prior = this.tokens.get(input.token);
    const row: PushTokenRecord = { id: prior?.id ?? newId('ptk'), createdAt: prior?.createdAt ?? now, lastSeenAt: now, ...input };
    this.tokens.set(input.token, row);
    return row;
  }

  async deleteToken(token: string, personId?: string): Promise<boolean> {
    const row = this.tokens.get(token);
    if (!row || (personId !== undefined && row.personId !== personId)) return false;
    return this.tokens.delete(token);
  }

  async deleteTokens(tokens: readonly string[]): Promise<number> {
    let n = 0;
    for (const t of tokens) if (this.tokens.delete(t)) n += 1;
    return n;
  }

  async deleteSessionTokens(sessionId: string): Promise<number> {
    let n = 0;
    for (const [t, row] of this.tokens) {
      if (row.sessionId === sessionId) {
        this.tokens.delete(t);
        n += 1;
      }
    }
    return n;
  }

  async tokensOf(personId: string, app?: NotifyApp): Promise<PushTokenRecord[]> {
    return [...this.tokens.values()].filter((r) => r.personId === personId && (app === undefined || r.app === app));
  }

  async preferences(personId: string): Promise<NotifyPreferences | null> {
    return this.prefs.get(personId) ?? null;
  }

  async saveLaunchInterest(input: { personId: string; service: string; zoneKey: string | null }, now: Date): Promise<void> {
    const key = `${input.personId}|${input.service}`;
    const prior = this.interests.get(key);
    this.interests.set(key, { ...input, createdAt: prior?.createdAt ?? now, updatedAt: now });
  }

  async launchInterestsOf(personId: string): Promise<string[]> {
    return [...this.interests.values()].filter((r) => r.personId === personId).map((r) => r.service);
  }

  async launchInterests(): Promise<LaunchInterestRecord[]> {
    return [...this.interests.values()].map((r) => ({ ...r }));
  }

  async setPreferences(personId: string, prefs: NotifyPreferences): Promise<NotifyPreferences> {
    this.prefs.set(personId, { ...prefs });
    return { ...prefs };
  }

  async insertDeliveries(rows: readonly NewDelivery[], now: Date): Promise<DeliveryRecord[]> {
    const out: DeliveryRecord[] = [];
    for (const r of rows) {
      const key = `${r.dedupeKey}|${r.channel}`;
      if (this.byKey.has(key)) continue;
      const row: DeliveryRecord = { ...r, id: newId('ntf'), provider: null, providerRef: null, tickets: null, attempts: 0, sentAt: null, deliveredAt: null, createdAt: now, updatedAt: now };
      this.deliveries.set(row.id, row);
      this.byKey.set(key, row.id);
      this.seqOf.set(row.id, this.seqOf.size + 1);
      out.push(structuredClone(row));
    }
    return out;
  }

  async delivery(id: string): Promise<DeliveryRecord | null> {
    const r = this.deliveries.get(id);
    return r ? structuredClone(r) : null;
  }

  async byDedupe(dedupeKey: string): Promise<DeliveryRecord[]> {
    return [...this.deliveries.values()].filter((r) => r.dedupeKey === dedupeKey).map((r) => structuredClone(r));
  }

  async byProviderRef(ref: string): Promise<DeliveryRecord | null> {
    const r = [...this.deliveries.values()].find((d) => d.providerRef === ref);
    return r ? structuredClone(r) : null;
  }

  async updateDelivery(id: string, patch: DeliveryPatch, now: Date): Promise<DeliveryRecord> {
    const r = this.deliveries.get(id);
    if (!r) throw new Error(`delivery ${id} not found`);
    const next = { ...r, ...structuredClone(patch), updatedAt: now };
    this.deliveries.set(id, next);
    return structuredClone(next);
  }

  async countMarketingSince(personId: string, since: Date): Promise<number> {
    const keys = new Set<string>();
    for (const r of this.deliveries.values()) {
      if (r.personId === personId && MARKETING_TEMPLATES.includes(r.template) && COUNTED.includes(r.status) && r.createdAt >= since) keys.add(r.dedupeKey);
    }
    return keys.size;
  }

  async log(filter: { personId?: string | undefined; orderId?: string | undefined; limit: number }): Promise<DeliveryRecord[]> {
    return [...this.deliveries.values()]
      .filter((r) => (filter.personId === undefined || r.personId === filter.personId) && (filter.orderId === undefined || r.orderId === filter.orderId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (this.seqOf.get(b.id) ?? 0) - (this.seqOf.get(a.id) ?? 0))
      .slice(0, filter.limit)
      .map((r) => structuredClone(r));
  }
}

// ───────────────────────── Prisma ─────────────────────────

interface TokenRow {
  id: string;
  token: string;
  kind: string;
  personId: string;
  sessionId: string | null;
  app: string;
  platform: string;
  appVersion: string | null;
  lastSeenAt: Date;
  createdAt: Date;
}

interface DeliveryRow {
  id: string;
  dedupeKey: string;
  eventId: string;
  template: string;
  personId: string;
  orderId: string | null;
  channel: string;
  status: string;
  reason: string | null;
  provider: string | null;
  providerRef: string | null;
  tickets: unknown;
  attempts: number;
  twin: boolean;
  payload: unknown;
  notBefore: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const tokenOf = (r: TokenRow): PushTokenRecord => ({
  id: r.id,
  token: r.token,
  kind: r.kind as PushTokenKind,
  personId: r.personId,
  sessionId: r.sessionId,
  app: r.app as NotifyApp,
  platform: r.platform as PushPlatform,
  appVersion: r.appVersion,
  lastSeenAt: r.lastSeenAt,
  createdAt: r.createdAt,
});

const deliveryOf = (r: DeliveryRow): DeliveryRecord => ({
  ...r,
  template: r.template as NotifyTemplateId,
  channel: r.channel as NotifyChannel,
  status: r.status as DeliveryStatus,
  tickets: (r.tickets as TicketRecord[] | null) ?? null,
  payload: r.payload as DeliveryPayload,
});

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as never;

export class PrismaNotifyRepository implements NotifyRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async upsertToken(input: RegisterTokenInput, now: Date): Promise<PushTokenRecord> {
    const data = { kind: input.kind, personId: input.personId, sessionId: input.sessionId, app: input.app, platform: input.platform, appVersion: input.appVersion, lastSeenAt: now };
    const row = await this.db().pushToken.upsert({ where: { token: input.token }, create: { id: newId('ptk'), token: input.token, ...data }, update: data });
    return tokenOf(row);
  }

  async deleteToken(token: string, personId?: string): Promise<boolean> {
    const res = await this.db().pushToken.deleteMany({ where: { token, ...(personId !== undefined ? { personId } : {}) } });
    return res.count > 0;
  }

  async deleteTokens(tokens: readonly string[]): Promise<number> {
    if (tokens.length === 0) return 0;
    return (await this.db().pushToken.deleteMany({ where: { token: { in: [...tokens] } } })).count;
  }

  async deleteSessionTokens(sessionId: string): Promise<number> {
    return (await this.db().pushToken.deleteMany({ where: { sessionId } })).count;
  }

  async tokensOf(personId: string, app?: NotifyApp): Promise<PushTokenRecord[]> {
    return (await this.db().pushToken.findMany({ where: { personId, ...(app ? { app } : {}) }, orderBy: { lastSeenAt: 'desc' } })).map(tokenOf);
  }

  async saveLaunchInterest(input: { personId: string; service: string; zoneKey: string | null }): Promise<void> {
    await this.db().launchInterest.upsert({
      where: { personId_service: { personId: input.personId, service: input.service } },
      create: { id: newId('lin'), personId: input.personId, service: input.service, zoneKey: input.zoneKey },
      update: { zoneKey: input.zoneKey },
    });
  }

  async launchInterestsOf(personId: string): Promise<string[]> {
    return (await this.db().launchInterest.findMany({ where: { personId }, orderBy: { createdAt: 'asc' } })).map((r) => r.service);
  }

  async launchInterests(): Promise<LaunchInterestRecord[]> {
    return (await this.db().launchInterest.findMany({ orderBy: { updatedAt: 'desc' } })).map((r) => ({ personId: r.personId, service: r.service, zoneKey: r.zoneKey, createdAt: r.createdAt, updatedAt: r.updatedAt }));
  }

  async preferences(personId: string): Promise<NotifyPreferences | null> {
    const r = await this.db().notifyPreference.findUnique({ where: { personId } });
    return r ? { orderUpdates: r.orderUpdates, chat: r.chat, whatsappReceipts: r.whatsappReceipts, smsFallback: r.smsFallback, marketing: r.marketing, dishPots: r.dishPots } : null;
  }

  async setPreferences(personId: string, prefs: NotifyPreferences): Promise<NotifyPreferences> {
    const r = await this.db().notifyPreference.upsert({ where: { personId }, create: { id: newId('npf'), personId, ...prefs }, update: prefs });
    return { orderUpdates: r.orderUpdates, chat: r.chat, whatsappReceipts: r.whatsappReceipts, smsFallback: r.smsFallback, marketing: r.marketing, dishPots: r.dishPots };
  }

  async insertDeliveries(rows: readonly NewDelivery[], now: Date, tx?: Tx): Promise<DeliveryRecord[]> {
    if (rows.length === 0) return [];
    const withIds = rows.map((r) => ({ ...r, id: newId('ntf') }));
    const db = this.db(tx);
    await db.notifyDelivery.createMany({
      data: withIds.map((r) => ({ id: r.id, dedupeKey: r.dedupeKey, eventId: r.eventId, template: r.template, personId: r.personId, orderId: r.orderId, channel: r.channel, status: r.status, reason: r.reason, twin: r.twin, payload: json(r.payload), notBefore: r.notBefore, createdAt: now })),
      skipDuplicates: true,
    });
    return (await db.notifyDelivery.findMany({ where: { id: { in: withIds.map((r) => r.id) } } })).map(deliveryOf);
  }

  async delivery(id: string): Promise<DeliveryRecord | null> {
    const r = await this.db().notifyDelivery.findUnique({ where: { id } });
    return r ? deliveryOf(r) : null;
  }

  async byDedupe(dedupeKey: string): Promise<DeliveryRecord[]> {
    return (await this.db().notifyDelivery.findMany({ where: { dedupeKey }, orderBy: { createdAt: 'asc' } })).map(deliveryOf);
  }

  async byProviderRef(ref: string): Promise<DeliveryRecord | null> {
    const r = await this.db().notifyDelivery.findFirst({ where: { providerRef: ref } });
    return r ? deliveryOf(r) : null;
  }

  async updateDelivery(id: string, patch: DeliveryPatch): Promise<DeliveryRecord> {
    const { tickets, payload, ...rest } = patch;
    const r = await this.db().notifyDelivery.update({
      where: { id },
      data: { ...rest, ...(tickets !== undefined ? { tickets: json(tickets) } : {}), ...(payload !== undefined ? { payload: json(payload) } : {}) },
    });
    return deliveryOf(r);
  }

  async countMarketingSince(personId: string, since: Date): Promise<number> {
    const rows = await this.db().notifyDelivery.findMany({
      where: { personId, template: { in: MARKETING_TEMPLATES }, status: { in: [...COUNTED] }, createdAt: { gte: since } },
      select: { dedupeKey: true },
      distinct: ['dedupeKey'],
    });
    return rows.length;
  }

  async log(filter: { personId?: string | undefined; orderId?: string | undefined; limit: number }): Promise<DeliveryRecord[]> {
    const rows = await this.db().notifyDelivery.findMany({
      where: { ...(filter.personId !== undefined ? { personId: filter.personId } : {}), ...(filter.orderId !== undefined ? { orderId: filter.orderId } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.limit,
    });
    return rows.map(deliveryOf);
  }
}
