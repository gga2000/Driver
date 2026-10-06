import { Logger } from '@nestjs/common';
import {
  ANDROID_CHANNELS,
  DEFAULT_NOTIFY_PREFERENCES,
  MARKETING_MAX_PER_WEEK,
  NOTIFY_TEMPLATES,
  OFFER_SOUND,
  preferenceFor,
  QUIET_HOURS,
  type DeliveryStatus,
  type NotifyApp,
  type NotifyChannel,
  type NotifyPreferences,
  type NotifyTemplateDef,
  type NotifyTemplateId,
} from '@driver/contracts';
import type { Locale } from '@driver/i18n';
import type { Clock } from '../../shared/clock.js';
import { afterCommit, type Tx } from '../../shared/db/unit-of-work.js';
import { localHour, startOfLocalDay } from '../../shared/local-time.js';
import { isProviderError } from '../../shared/messaging/http.js';
import type { SmsPort } from '../../shared/messaging/sms.js';
import { jobKey, type Queue } from '../../shared/queue.js';
import type { PushMessage, PushPorts, PushTicket } from './providers/push.js';
import type { WhatsAppPort } from './providers/whatsapp.js';
import type { DeliveryPayload, DeliveryRecord, NewDelivery, NotifyRepository, TicketRecord } from './notify.repository.js';
import { render } from './render.js';

/** One notification to one person, as a subscriber (or the chat module) asks for it. */
export interface NotifyRequest {
  /** The domain event behind it: with the template and the person, the dedupe key. */
  eventId: string;
  template: NotifyTemplateId;
  /** Person id. */
  to: string;
  params?: Record<string, string | number>;
  orderId?: string | null;
  /** Extra push data (ids the app needs to open the screen). */
  data?: Record<string, string>;
  /** Caller-rendered push text (chat previews). */
  content?: { title: string; body: string };
  /** Narrow the template's channels (legacy single-channel sends). */
  channels?: readonly NotifyChannel[];
  /** Which app's tokens for an `any` template. */
  app?: NotifyApp;
}

/** Where a person can be reached: locale (always) and the number (only when asked; vault-logged). */
export interface NotifyContacts {
  contact(personId: string, opts: { phone: boolean; purpose: string }): Promise<{ locale: Locale; phoneE164: string | null } | null>;
}

export interface NotifyProviders {
  push: PushPorts;
  sms: SmsPort;
  whatsapp: WhatsAppPort;
}

export type NotifyJob =
  | { kind: 'send'; deliveryId: string }
  /** The SMS-twin check of one message (`final`: the deadline passed; otherwise an early check after a failure). */
  | { kind: 'twin'; dedupeKey: string; final: boolean }
  /** Late Expo receipt poll: prune dead tokens, settle the status. */
  | { kind: 'receipts'; deliveryId: string };

export interface NotifyEngineOptions {
  /** First retry delay; doubles per attempt (2 s, 4 s, 8 s…), capped at 10 min. */
  retryBaseMs: number;
  maxAttempts: number;
  /** When a push without an SMS twin gets its receipts polled (Expo keeps them 24 h). */
  receiptDelaySec: number;
}

export const DEFAULT_ENGINE_OPTIONS: NotifyEngineOptions = { retryBaseMs: 2_000, maxAttempts: 6, receiptDelaySec: 15 * 60 };

const FINAL: readonly DeliveryStatus[] = ['delivered', 'read', 'failed', 'suppressed', 'skipped'];
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Inside quiet hours (Baghdad local 23:00–08:00)? */
export function inQuietHours(at: Date): boolean {
  const h = localHour(at);
  return QUIET_HOURS.startHour > QUIET_HOURS.endHour ? h >= QUIET_HOURS.startHour || h < QUIET_HOURS.endHour : h >= QUIET_HOURS.startHour && h < QUIET_HOURS.endHour;
}

/** The next end of quiet hours (08:00 local) after `at`. */
export function quietHoursEnd(at: Date): Date {
  const today = new Date(startOfLocalDay(at).getTime() + QUIET_HOURS.endHour * 3_600_000);
  return today.getTime() > at.getTime() ? today : new Date(today.getTime() + DAY_MS);
}

/** Categories whose SMS twin ignores the person's `smsFallback` switch. */
const ALWAYS_TWIN = new Set(['safety', 'money', 'work']);

/**
 * Routing and delivery. `dispatch` decides channels (template policy, preferences, quiet hours, the
 * marketing cap) and writes one delivery-log row per channel (deduped by event + template + person);
 * the `notify` queue then sends each row through its provider with retries and backoff, polls push
 * receipts, prunes dead tokens and sends the SMS twin when nothing was delivered in time.
 */
export class NotifyEngine {
  private readonly logger = new Logger('Notify');

  constructor(
    private readonly repo: NotifyRepository,
    private readonly providers: NotifyProviders,
    private readonly contacts: NotifyContacts,
    private readonly queue: Queue<NotifyJob>,
    private readonly clock: Clock,
    private readonly opts: NotifyEngineOptions = DEFAULT_ENGINE_OPTIONS,
    /** Mourning days set in the Console (`ControlsService.isQuietDay`): no offers then. */
    private readonly isQuietDay: (at: Date) => Promise<boolean> = async () => false,
  ) {}

  // ───────────────────────── routing ─────────────────────────

  async preferencesOf(personId: string): Promise<NotifyPreferences> {
    return (await this.repo.preferences(personId)) ?? { ...DEFAULT_NOTIFY_PREFERENCES };
  }

  /**
   * Plans and records the deliveries of one request. With `tx` (an outbox subscriber's transaction)
   * the rows commit with the subscriber's delivery record and the jobs are queued after the commit.
   * A repeated request (same event, template, person) inserts nothing and queues nothing.
   */
  async dispatch(req: NotifyRequest, tx?: Tx): Promise<DeliveryRecord[]> {
    const def = NOTIFY_TEMPLATES[req.template];
    const now = this.clock.now();
    const prefs = await this.preferencesOf(req.to);
    const dedupeKey = `${req.eventId}:${req.template}:${req.to}`;
    const params = Object.fromEntries(Object.entries(req.params ?? {}).map(([k, v]) => [k, String(v)]));
    const preview = render(req.template, params, 'ar-IQ', req.content ?? null);
    const payload: DeliveryPayload = {
      params,
      content: req.content ?? null,
      ...(req.data ? { data: req.data } : {}),
      app: req.app ?? def.app,
      title: preview.title,
      body: preview.whatsapp && !def.push ? preview.whatsapp.text : preview.body,
    };
    const channels = req.channels ?? def.primary;
    const capped = def.category === 'marketing' && (await this.repo.countMarketingSince(req.to, new Date(now.getTime() - WEEK_MS))) >= MARKETING_MAX_PER_WEEK;
    const quietDay = def.category === 'marketing' && (await this.isQuietDay(now));
    const deferred = def.quietHours === 'defer' && inQuietHours(now);
    const rows: NewDelivery[] = channels.map((channel) => {
      const pref = preferenceFor(def.category, channel);
      let status: DeliveryStatus = 'queued';
      let reason: string | null = null;
      let notBefore: Date | null = null;
      if (channel === 'whatsapp' && !def.whatsapp) [status, reason] = ['skipped', 'no_template'];
      else if (pref && !prefs[pref]) [status, reason] = ['suppressed', `preference:${pref}`];
      else if (quietDay) [status, reason] = ['suppressed', 'quiet_day'];
      else if (capped) [status, reason] = ['suppressed', 'weekly_cap'];
      else if (deferred) [status, reason, notBefore] = ['deferred', 'quiet_hours', quietHoursEnd(now)];
      return { dedupeKey, eventId: req.eventId, template: req.template, personId: req.to, orderId: req.orderId ?? null, channel, status, reason, twin: false, payload: channel === 'whatsapp' && preview.whatsapp ? { ...payload, body: preview.whatsapp.text } : payload, notBefore };
    });
    const inserted = await this.repo.insertDeliveries(rows, now, tx);
    if (inserted.length === 0) return [];
    const schedule = async () => {
      for (const row of inserted) {
        if (row.status === 'queued') await this.enqueue({ kind: 'send', deliveryId: row.id }, jobKey('send', row.id, 0));
        else if (row.status === 'deferred' && row.notBefore) await this.enqueue({ kind: 'send', deliveryId: row.id }, jobKey('send', row.id, 'deferred'), row.notBefore.getTime() - now.getTime());
      }
      if (def.smsTwinAfterSec !== undefined && inserted.some((r) => r.status === 'queued')) {
        await this.enqueue({ kind: 'twin', dedupeKey, final: true }, jobKey('twin', inserted[0]!.id, 'final'), def.smsTwinAfterSec * 1000);
      }
    };
    if (!afterCommit(tx, schedule)) await schedule();
    return inserted;
  }

  private async enqueue(job: NotifyJob, jobId: string, delayMs = 0): Promise<void> {
    await this.queue.add(job.kind, job, { jobId, ...(delayMs > 0 ? { delayMs } : {}) });
  }

  // ───────────────────────── jobs ─────────────────────────

  async process(job: NotifyJob): Promise<void> {
    if (job.kind === 'send') await this.send(job.deliveryId);
    else if (job.kind === 'twin') await this.twin(job.dedupeKey, job.final);
    else await this.pollReceipts(job.deliveryId);
  }

  private async send(deliveryId: string): Promise<void> {
    const row = await this.repo.delivery(deliveryId);
    if (!row || (row.status !== 'queued' && row.status !== 'deferred')) return;
    const def = NOTIFY_TEMPLATES[row.template];
    const now = this.clock.now();
    if (row.status === 'deferred') {
      const pref = preferenceFor(def.category, row.channel);
      if (pref && !(await this.preferencesOf(row.personId))[pref]) {
        await this.repo.updateDelivery(row.id, { status: 'suppressed', reason: `preference:${pref}` }, now);
        return;
      }
      if (inQuietHours(now)) {
        const at = quietHoursEnd(now);
        await this.repo.updateDelivery(row.id, { notBefore: at }, now);
        await this.enqueue({ kind: 'send', deliveryId: row.id }, jobKey('send', row.id, 'deferred', at.getTime()), at.getTime() - now.getTime());
        return;
      }
    }
    if (def.category === 'marketing' && (await this.isQuietDay(now))) {
      await this.repo.updateDelivery(row.id, { status: 'suppressed', reason: 'quiet_day' }, now);
      return;
    }
    try {
      if (row.channel === 'push') await this.sendPush(row, def);
      else if (row.channel === 'sms') await this.sendSms(row);
      else await this.sendWhatsApp(row, def);
    } catch (err) {
      await this.failed(row, err);
    }
  }

  /** Transient: retry with exponential backoff until `maxAttempts`; permanent: fail now. */
  private async failed(row: DeliveryRecord, err: unknown): Promise<void> {
    const now = this.clock.now();
    const attempts = row.attempts + 1;
    const permanent = isProviderError(err) ? err.permanent : false;
    const reason = isProviderError(err) ? err.code : (err as Error).message.slice(0, 200);
    if (!permanent && attempts < this.opts.maxAttempts) {
      const delay = Math.min(this.opts.retryBaseMs * 2 ** (attempts - 1), 10 * 60_000);
      await this.repo.updateDelivery(row.id, { status: 'queued', attempts, reason: `retry:${reason}` }, now);
      await this.enqueue({ kind: 'send', deliveryId: row.id }, jobKey('send', row.id, attempts), delay);
      return;
    }
    this.logger.warn(`${row.template} ${row.channel} to ${row.personId} failed: ${reason}`);
    await this.repo.updateDelivery(row.id, { status: 'failed', attempts, reason }, now);
    await this.earlyTwin(row);
  }

  private async locale(personId: string, purpose: string): Promise<Locale> {
    return (await this.contacts.contact(personId, { phone: false, purpose }))?.locale ?? 'ar-IQ';
  }

  private async sendPush(row: DeliveryRecord, def: NotifyTemplateDef): Promise<void> {
    const now = this.clock.now();
    const app = row.payload.app === 'any' ? undefined : row.payload.app;
    const tokens = await this.repo.tokensOf(row.personId, app);
    if (tokens.length === 0) {
      await this.repo.updateDelivery(row.id, { status: 'skipped', reason: 'no_device', attempts: row.attempts + 1 }, now);
      await this.earlyTwin(row);
      return;
    }
    const r = render(row.template, row.payload.params, await this.locale(row.personId, row.template), row.payload.content ?? null);
    const channel = def.push?.androidChannel ?? 'orders';
    const sound = ANDROID_CHANNELS[channel].sound;
    const base = {
      title: r.title ?? '',
      body: r.body ?? '',
      data: { ...(row.payload.data ?? {}), deliveryId: row.id, template: row.template, ...(r.deepLink && !row.payload.data?.['deepLink'] ? { deepLink: r.deepLink } : {}) },
      channelId: channel,
      sound: sound === OFFER_SOUND ? OFFER_SOUND : sound ? 'default' : null,
      priority: def.category === 'marketing' ? ('normal' as const) : ('high' as const),
      ...(def.category === 'work' ? { ttlSec: 120 } : {}),
      // Data-only (the الرجعة lock-screen card): nothing shows or rings; the app reads `data`.
      ...(def.push?.silent ? { silent: true } : {}),
    };
    const tickets: TicketRecord[] = [];
    for (const kind of ['expo', 'fcm'] as const) {
      const mine = tokens.filter((t) => t.kind === kind);
      if (mine.length === 0) continue;
      const messages: PushMessage[] = mine.map((t) => ({ ...base, token: t.token }));
      const sent: PushTicket[] = await this.providers.push[kind].send(messages);
      for (const t of sent) tickets.push({ token: t.token, kind, id: t.id, ok: t.ok, ...(t.error ? { error: t.error } : {}) });
      const dead = sent.filter((t) => t.invalidToken).map((t) => t.token);
      if (dead.length > 0) await this.repo.deleteTokens(dead);
    }
    const ok = tickets.filter((t) => t.ok);
    const provider = [...new Set(tokens.map((t) => this.providers.push[t.kind].name))].join('+');
    if (ok.length === 0) {
      const allDead = tickets.every((t) => t.error === 'DeviceNotRegistered' || t.error === 'UNREGISTERED' || t.error === 'NOT_FOUND');
      await this.repo.updateDelivery(row.id, { status: 'failed', reason: allDead ? 'invalid_token' : (tickets[0]?.error ?? 'push_failed'), provider, tickets, attempts: row.attempts + 1, payload: { ...row.payload, title: r.title, body: r.body } }, now);
      await this.earlyTwin(row);
      return;
    }
    await this.repo.updateDelivery(row.id, { status: 'sent', reason: null, provider, providerRef: ok[0]!.id, tickets, attempts: row.attempts + 1, sentAt: now, payload: { ...row.payload, title: r.title, body: r.body } }, now);
    // With a twin, the twin check polls the receipts at its deadline; otherwise poll later to prune.
    if (def.smsTwinAfterSec === undefined && ok.some((t) => this.providers.push[t.kind].hasReceipts)) {
      await this.enqueue({ kind: 'receipts', deliveryId: row.id }, jobKey('receipts', row.id), this.opts.receiptDelaySec * 1000);
    }
  }

  private async sendSms(row: DeliveryRecord): Promise<void> {
    const now = this.clock.now();
    const contact = await this.contacts.contact(row.personId, { phone: true, purpose: `notify:${row.template}` });
    if (!contact?.phoneE164) {
      await this.repo.updateDelivery(row.id, { status: 'skipped', reason: 'no_phone', attempts: row.attempts + 1 }, now);
      return;
    }
    const r = render(row.template, row.payload.params, contact.locale, row.payload.content ?? null);
    const res = await this.providers.sms.send({ to: contact.phoneE164, body: r.sms });
    await this.repo.updateDelivery(row.id, { status: 'sent', reason: null, provider: res.provider, providerRef: res.messageId, attempts: row.attempts + 1, sentAt: now, payload: { ...row.payload, title: null, body: r.sms } }, now);
  }

  private async sendWhatsApp(row: DeliveryRecord, def: NotifyTemplateDef): Promise<void> {
    const now = this.clock.now();
    const contact = await this.contacts.contact(row.personId, { phone: true, purpose: `notify:${row.template}` });
    if (!contact?.phoneE164) {
      await this.repo.updateDelivery(row.id, { status: 'skipped', reason: 'no_phone', attempts: row.attempts + 1 }, now);
      await this.earlyTwin(row);
      return;
    }
    const r = render(row.template, row.payload.params, contact.locale, null);
    if (!r.whatsapp || !def.whatsapp) {
      await this.repo.updateDelivery(row.id, { status: 'skipped', reason: 'no_template' }, now);
      return;
    }
    const res = await this.providers.whatsapp.send({ to: contact.phoneE164, template: r.whatsapp.template, language: r.whatsapp.language, params: r.whatsapp.params, preview: r.whatsapp.text });
    // Without status callbacks Meta's acceptance is all we will hear: count it as delivered.
    const delivered = !this.providers.whatsapp.statusCallbacks;
    await this.repo.updateDelivery(
      row.id,
      { status: delivered ? 'delivered' : 'sent', reason: null, provider: res.provider, providerRef: res.messageId, attempts: row.attempts + 1, sentAt: now, ...(delivered ? { deliveredAt: now } : {}), payload: { ...row.payload, title: r.whatsapp.template, body: r.whatsapp.text } },
      now,
    );
  }

  // ───────────────────────── receipts and the SMS twin ─────────────────────────

  /** Polls receipts of a sent push: ok → delivered; DeviceNotRegistered → token pruned. */
  private async pollReceipts(deliveryId: string): Promise<DeliveryRecord | null> {
    const row = await this.repo.delivery(deliveryId);
    if (!row || row.channel !== 'push' || row.status !== 'sent' || !row.tickets) return row;
    const tickets = row.tickets.map((t) => ({ ...t }));
    const dead: string[] = [];
    for (const kind of ['expo', 'fcm'] as const) {
      const port = this.providers.push[kind];
      const pending = tickets.filter((t) => t.kind === kind && t.ok && t.id && !t.receipt);
      if (!port.hasReceipts || pending.length === 0) continue;
      let receipts;
      try {
        receipts = await port.receipts(pending.map((t) => t.id!));
      } catch (err) {
        this.logger.warn(`push receipts for ${row.id}: ${(err as Error).message}`);
        continue;
      }
      for (const rc of receipts) {
        const t = tickets.find((x) => x.id === rc.id);
        if (!t) continue;
        t.receipt = rc.ok ? 'ok' : 'error';
        if (!rc.ok) t.error = rc.error ?? 'error';
        if (rc.invalidToken) dead.push(t.token);
      }
    }
    if (dead.length > 0) await this.repo.deleteTokens(dead);
    const now = this.clock.now();
    const anyOk = tickets.some((t) => t.receipt === 'ok');
    const allSettled = tickets.filter((t) => t.ok).every((t) => t.receipt !== undefined);
    const patch = anyOk
      ? { status: 'delivered' as const, deliveredAt: now, tickets }
      : allSettled
        ? { status: 'failed' as const, reason: dead.length > 0 ? 'invalid_token' : (tickets.find((t) => t.error)?.error ?? 'push_failed'), tickets }
        : { tickets };
    return this.repo.updateDelivery(row.id, patch, now);
  }

  /** A primary channel failed or had nowhere to go: check now whether the twin should not wait. */
  private async earlyTwin(row: DeliveryRecord): Promise<void> {
    if (row.twin || row.channel === 'sms') return;
    if (NOTIFY_TEMPLATES[row.template].smsTwinAfterSec === undefined) return;
    await this.enqueue({ kind: 'twin', dedupeKey: row.dedupeKey, final: false }, jobKey('twin', row.id, 'early'));
  }

  /** Was this row delivered, as far as its provider will ever tell? */
  private delivered(row: DeliveryRecord): boolean {
    if (row.status === 'delivered' || row.status === 'read') return true;
    if (row.status !== 'sent') return false;
    if (row.channel === 'whatsapp') return !this.providers.whatsapp.statusCallbacks;
    if (row.channel === 'push') return (row.tickets ?? []).some((t) => t.ok && !this.providers.push[t.kind].hasReceipts);
    return true;
  }

  /**
   * The SMS twin: when none of a message's primary channels was delivered by the template's deadline
   * (or, early, when every one has already failed or had nowhere to go), the same message goes by SMS
   * — once (the twin row shares the dedupe key). The person's `smsFallback` switch governs receipts
   * and order updates; safety, money and work messages always get their twin.
   */
  private async twin(dedupeKey: string, final: boolean): Promise<void> {
    let rows = await this.repo.byDedupe(dedupeKey);
    if (rows.length === 0 || rows.some((r) => r.channel === 'sms')) return;
    // Settle push receipts first: a push Expo delivered needs no twin.
    for (const r of rows) if (r.channel === 'push' && r.status === 'sent') await this.pollReceipts(r.id);
    rows = await this.repo.byDedupe(dedupeKey);
    const attempted = rows.filter((r) => r.status !== 'suppressed' && !(r.status === 'skipped' && r.reason === 'no_template'));
    if (attempted.length === 0) return;
    if (attempted.some((r) => this.delivered(r))) return;
    if (!final && !attempted.every((r) => FINAL.includes(r.status))) return;
    const first = rows[0]!;
    const def = NOTIFY_TEMPLATES[first.template];
    const now = this.clock.now();
    const prefs = await this.preferencesOf(first.personId);
    const pref = preferenceFor(def.category, 'sms');
    const allowed = ALWAYS_TWIN.has(def.category) || pref === null || prefs[pref];
    const [created] = await this.repo.insertDeliveries(
      [{ dedupeKey, eventId: first.eventId, template: first.template, personId: first.personId, orderId: first.orderId, channel: 'sms', status: allowed ? 'queued' : 'suppressed', reason: allowed ? null : `preference:${pref}`, twin: true, payload: { ...first.payload }, notBefore: null }],
      now,
    );
    if (created?.status === 'queued') await this.enqueue({ kind: 'send', deliveryId: created.id }, jobKey('send', created.id, 0));
  }

  // ───────────────────────── callbacks ─────────────────────────

  /** The app received / opened a push: delivered (or read). Only the recipient may ack. */
  async ack(personId: string, deliveryId: string, opened: boolean): Promise<boolean> {
    const row = await this.repo.delivery(deliveryId);
    if (!row || row.personId !== personId || row.channel !== 'push') return false;
    const now = this.clock.now();
    if (row.status === 'read' || (row.status === 'delivered' && !opened)) return true;
    await this.repo.updateDelivery(row.id, { status: opened ? 'read' : 'delivered', deliveredAt: row.deliveredAt ?? now }, now);
    return true;
  }

  /** A WhatsApp status from the webhook; a `failed` one triggers the twin check at once. */
  async whatsAppStatus(messageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', at: Date, error: string | null): Promise<boolean> {
    const row = await this.repo.byProviderRef(messageId);
    if (!row || row.channel !== 'whatsapp') return false;
    const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
    if ((rank[status] ?? 0) <= (rank[row.status] ?? 0) && status !== 'failed') return true;
    const now = this.clock.now();
    const updated = await this.repo.updateDelivery(row.id, { status, ...(status === 'delivered' || status === 'read' ? { deliveredAt: row.deliveredAt ?? at } : {}), ...(error ? { reason: error } : {}) }, now);
    if (status === 'failed') await this.earlyTwin(updated);
    return true;
  }
}
