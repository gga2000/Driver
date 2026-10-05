import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  type AckDeliveryInput,
  type Actor,
  type DeliveryLogRow,
  type LaunchDemandRow,
  type LaunchInterestInput,
  LaunchService,
  type MyLaunchInterests,
  type NotifyApp,
  type NotifyLogInput,
  type NotifyPort,
  type NotifyPreferences,
  type RegisterDeviceInput,
  type SetNotifyPreferencesInput,
  type UnregisterDeviceInput,
} from '@driver/contracts';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { NotifyEngine, NotifyRequest } from './notify.engine.js';
import { NOTIFY_REPOSITORY, type DeliveryRecord, type NotifyRepository } from './notify.repository.js';

export type Channel = 'push' | 'sms' | 'whatsapp';

/** A ready-made message (the chat module's push: its own title and preview). */
export interface Notification {
  to: string;
  channel: Channel;
  title_ar: string;
  body_ar: string;
  data?: Record<string, string>;
}

export interface Transport {
  send(n: Notification): Promise<void>;
}

export const NOTIFY_TRANSPORT = Symbol('NOTIFY_TRANSPORT');
export const NOTIFY_ENGINE = Symbol('NOTIFY_ENGINE');

/** Test transport: keeps an inspectable log of ready-made messages (bypasses routing). */
export class RecordingTransport implements Transport {
  readonly sent: Notification[] = [];
  async send(n: Notification): Promise<void> {
    this.sent.push(n);
  }
}

/**
 * A notification recipient that is a person's emergency contact rather than a person (SOS, scoring &
 * safety §3): `ec:<personId>`. Notify resolves the number through identity's logged vault read; the
 * delivery log keeps the recipient as written, so the Console can tell the contact's message apart.
 */
export const emergencyContactRecipient = (personId: string): string => `ec:${personId}`;

/** The person whose emergency contact a recipient names, or null for an ordinary person id. */
export function emergencyContactOwner(recipient: string): string | null {
  return recipient.startsWith('ec:') && recipient.length > 3 ? recipient.slice(3) : null;
}

/** Expo push tokens look like `ExponentPushToken[…]` (or `ExpoPushToken[…]`). */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

/**
 * The notify module's public service. Other modules ask for a notification with `dispatch` (a
 * template, a person, params, the event id it comes from) — usually from the module's own outbox
 * subscriber (`notify.subscribers.ts`), never inline — or hand over a ready-made push with `send`
 * (chat). The apps register push tokens and set preferences through the `notify` router; support
 * reads the delivery log.
 *
 * Constructed with only a `Transport` (tests), `send` goes straight to it, as before routing existed.
 */
@Injectable()
export class NotifyService implements NotifyPort {
  private readonly transport: Transport | null;
  private readonly clock: Clock;

  constructor(
    @Optional() @Inject(NOTIFY_TRANSPORT) transport?: Transport,
    @Optional() @Inject(NOTIFY_ENGINE) private readonly engine?: NotifyEngine,
    @Optional() @Inject(NOTIFY_REPOSITORY) private readonly repo?: NotifyRepository,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.transport = transport ?? (engine ? null : new RecordingTransport());
    this.clock = clock ?? new SystemClock();
  }

  private wired(): { engine: NotifyEngine; repo: NotifyRepository } {
    if (!this.engine || !this.repo) throw new Error('NotifyService: routing is not wired (construct it through NotifyModule)');
    return { engine: this.engine, repo: this.repo };
  }

  /**
   * A ready-made message. With routing wired it becomes a `chat_message` delivery (deduped by
   * `opts.eventId`, preferences applied, logged); with a bare transport it is handed over as is, and
   * `fallback` is tried when the transport throws.
   */
  async send(n: Notification, fallback?: Channel, opts: { eventId?: string; app?: NotifyApp } = {}): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.send(n);
      } catch (err) {
        if (!fallback) throw err;
        await this.transport.send({ ...n, channel: fallback });
      }
      return;
    }
    await this.dispatch({
      eventId: opts.eventId ?? randomUUID(),
      template: 'chat_message',
      to: n.to,
      content: { title: n.title_ar, body: n.body_ar },
      ...(n.data ? { data: n.data, orderId: n.data['orderId'] ?? null } : {}),
      channels: [n.channel],
      ...(opts.app ? { app: opts.app } : {}),
    });
  }

  /** Plans, logs and queues one notification (see `NotifyEngine.dispatch`). */
  dispatch(req: NotifyRequest, tx?: Tx): Promise<DeliveryRecord[]> {
    return this.wired().engine.dispatch(req, tx);
  }

  // ───────────────────────── NotifyPort (router) ─────────────────────────

  async registerDevice(actor: Actor, input: RegisterDeviceInput): Promise<{ registered: boolean }> {
    const { repo } = this.wired();
    if (input.kind === 'expo' && !EXPO_TOKEN.test(input.token)) throw new DriverError('invalid_input');
    await repo.upsertToken({ token: input.token, kind: input.kind, personId: actor.personId, sessionId: actor.sessionId, app: input.app, platform: input.platform, appVersion: input.appVersion ?? null }, this.clock.now());
    return { registered: true };
  }

  async unregisterDevice(actor: Actor, input: UnregisterDeviceInput): Promise<{ registered: boolean }> {
    await this.wired().repo.deleteToken(input.token, actor.personId);
    return { registered: false };
  }

  preferences(actor: Actor): Promise<NotifyPreferences> {
    return this.wired().engine.preferencesOf(actor.personId);
  }

  async setPreferences(actor: Actor, input: SetNotifyPreferencesInput): Promise<NotifyPreferences> {
    const { engine, repo } = this.wired();
    const current = await engine.preferencesOf(actor.personId);
    const next: NotifyPreferences = { ...current, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
    return repo.setPreferences(actor.personId, next, this.clock.now());
  }

  async ack(actor: Actor, input: AckDeliveryInput): Promise<{ ok: boolean }> {
    return { ok: await this.wired().engine.ack(actor.personId, input.deliveryId, input.opened) };
  }

  async launchInterest(actor: Actor, input: LaunchInterestInput): Promise<MyLaunchInterests> {
    const { repo } = this.wired();
    await repo.saveLaunchInterest({ personId: actor.personId, service: input.service, zoneKey: input.zoneKey ?? null }, this.clock.now());
    return this.myLaunchInterests(actor);
  }

  async myLaunchInterests(actor: Actor): Promise<MyLaunchInterests> {
    const mine = new Set(await this.wired().repo.launchInterestsOf(actor.personId));
    return { services: LaunchService.options.filter((s) => mine.has(s)) };
  }

  async launchDemand(_actor: Actor): Promise<LaunchDemandRow[]> {
    const rows = await this.wired().repo.launchInterests();
    return LaunchService.options
      .map((service): LaunchDemandRow => {
        const mine = rows.filter((r) => r.service === service);
        const zones = new Map<string | null, number>();
        for (const r of mine) zones.set(r.zoneKey, (zones.get(r.zoneKey) ?? 0) + 1);
        const lastAt = mine.reduce<Date | null>((at, r) => (!at || r.updatedAt > at ? r.updatedAt : at), null);
        return {
          service,
          people: mine.length,
          byZone: [...zones.entries()].map(([zoneKey, people]) => ({ zoneKey, people })).sort((a, b) => b.people - a.people || String(a.zoneKey).localeCompare(String(b.zoneKey))),
          lastAt,
        };
      })
      .sort((a, b) => b.people - a.people);
  }

  async log(_actor: Actor, input: NotifyLogInput): Promise<DeliveryLogRow[]> {
    const rows = await this.wired().repo.log({ personId: input.personId, orderId: input.orderId, limit: input.limit });
    return rows.map(toLogRow);
  }

  // ───────────────────────── module hooks ─────────────────────────

  /** A session signed out: its push tokens go with it. */
  removeSessionTokens(sessionId: string): Promise<number> {
    return this.wired().repo.deleteSessionTokens(sessionId);
  }

  whatsAppStatus(messageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', at: Date, error: string | null): Promise<boolean> {
    return this.wired().engine.whatsAppStatus(messageId, status, at, error);
  }
}

export function toLogRow(r: DeliveryRecord): DeliveryLogRow {
  return {
    id: r.id,
    eventId: r.eventId,
    template: r.template,
    personId: r.personId,
    orderId: r.orderId,
    channel: r.channel,
    status: r.status,
    reason: r.reason,
    provider: r.provider,
    attempts: r.attempts,
    twin: r.twin,
    title: r.payload.title,
    body: r.payload.body,
    createdAt: r.createdAt,
    sentAt: r.sentAt,
    deliveredAt: r.deliveredAt,
    updatedAt: r.updatedAt,
  };
}
