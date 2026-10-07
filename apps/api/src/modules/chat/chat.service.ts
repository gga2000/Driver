import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { t } from '@driver/i18n';
import {
  CHAT_CLOSE_AFTER_MIN,
  CHAT_LOST_ITEM_H,
  CHAT_SUPPORT_CLOSE_AFTER_H,
  CHAT_SUPPORT_OPENS_PER_DAY,
  CHAT_THREAD_PARTIES,
  ChatMessageSentPayload,
  DriverError,
  quickRepliesFor,
  quickReplyText,
  voiceAllowedIn,
  type Actor,
  type CallSession,
  type ChatMarkReadInput,
  type ChatLostItemInput,
  type ChatLostItemResult,
  type ChatLostItemThread,
  type ChatMarkReadOutput,
  type ChatMessage,
  type ChatParticipant,
  type ChatPort,
  type ChatRequestCallInput,
  type ChatRole,
  type ChatSendInput,
  type ChatThreadInput,
  type ChatThreadKind,
  type ChatThreadsInput,
  type ChatThreadStatus,
  type ChatThreadSummary,
  type ChatThreadView,
  type ChatVoiceUploadInput,
  type Order,
  type OrderState,
  type RoleKind,
  type Trip,
  type TripState,
  type VoiceUploadTicket,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { EventsService } from '../events/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { CALL_BRIDGE, type CallBridgePort } from './call-bridge.js';
import { CHAT_REPOSITORY, type ChatMessageRecord, type ChatRepository, type ChatThreadRecord, type ChatVoiceThread } from './chat.repository.js';
import { InMemoryWindowCounter, WINDOW_COUNTER, type WindowCounter } from '../../shared/window-counter.js';
import { maskIraqiPhones } from './mask.js';
import { SharedSlidingWindowLimiter } from './rate-limit.js';

// ───────────────────────── ports ─────────────────────────

/** The slices of orders / trips / identity / orgs the chat reads (it owns only its own tables). */
export interface ChatOrdersPort {
  get(orderId: string): Promise<Order>;
  /** Ride ideas c9/s3: the rider of a ride booked for someone else and the name the booker gave them (logged read). */
  riderOf?(orderId: string, accessorId: string, purpose: string): Promise<{ personId: string; name: string } | null>;
}
export interface ChatTripsPort {
  activeForOrder(orderId: string): Promise<Trip | null>;
  courierOf(orderId: string): Promise<{ tripId: string; courierId: string } | null>;
  get(tripId: string): Promise<Trip>;
}
export interface ChatIdentityPort {
  hasRole(personId: string, kind: RoleKind, orgId?: string): Promise<boolean>;
  /** First names only; every read of another person is a logged vault access. */
  firstNamesFor(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string | null>>;
  orgRoleHolders(orgId: string, kinds: readonly RoleKind[]): Promise<Array<{ personId: string; kind: RoleKind; frozen: boolean }>>;
}
export interface ChatStoresPort {
  /** The kitchen's display name; null when unknown. */
  storeName(orgId: string): Promise<string | null>;
}

export const CHAT_ORDERS = Symbol('CHAT_ORDERS');
export const CHAT_TRIPS = Symbol('CHAT_TRIPS');
export const CHAT_IDENTITY = Symbol('CHAT_IDENTITY');
export const CHAT_STORES = Symbol('CHAT_STORES');

/** Limits: sends per person per minute; masked calls per person per 10 minutes. */
export const CHAT_RULES = { sendsPerMinute: 20, callsPer10Min: 5, pageSize: 200, supportOpensPerDay: CHAT_SUPPORT_OPENS_PER_DAY } as const;

const MERCHANT_ROLES: readonly RoleKind[] = ['merchant_owner', 'merchant_staff'];
const SUPPORT_ROLES: readonly RoleKind[] = ['support', 'dispatcher', 'admin'];
const ALL_KINDS: readonly ChatThreadKind[] = ['customer_courier', 'merchant_courier', 'customer_merchant', 'customer_support'];

/** Order states in which the order is over (delivered, done, or ended without delivery). */
const DONE_ORDER_STATES: ReadonlySet<OrderState> = new Set(['delivered', 'closed', 'completed', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'failed', 'disputed']);
/** Trip states in which the accepted courier is (or was, until the thread closes) a party. */
const COURIER_PARTY_STATES: ReadonlySet<TripState> = new Set(['accepted', 'en_route_to_pickup', 'arrived_pickup', 'in_transit', 'arrived_dropoff', 'completed', 'failed', 'customer_cancelled', 'platform_cancelled']);

/** Everything the access and status rules need about one order, read fresh on every call. */
interface OrderContext {
  order: Order;
  ride: boolean;
  customerIds: ReadonlySet<string>;
  /** c9/s3: on a ride booked for someone else, the rider (the person the driver picks up). */
  riderId: string | null;
  courierId: string | null;
  courierAcceptedAt: Date | null;
  doneAt: Date | null;
  /** A ride whose trip completed: when (s7 «نسيت غرض» counts from it); null otherwise. */
  rideCompletedAt: Date | null;
  /** s7: the driver chat reopened for a lost item until then; null when never reopened. */
  lostItemUntil: Date | null;
}

const NAME_CACHE_MAX = 2000;

/**
 * In-order chat (notifications & support §2; customer app §4) and masked calls. Threads are keyed by
 * order and pair; who is a party is derived from the order on every call (the courier changes on a
 * reassign; a kitchen's staff come and go), so no participant list is stored. Messages are persisted
 * with a per-thread seq; a new message emits `chat.message_sent` in the same transaction, and the
 * module's outbox subscriber pushes it to the other party through `NotifyService`.
 */
@Injectable()
export class ChatService implements ChatPort {
  private readonly logger = new Logger(ChatService.name);
  private readonly sendLimiter: SharedSlidingWindowLimiter;
  private readonly callLimiter: SharedSlidingWindowLimiter;
  /** New support chats per customer per 24 h (one per order; spam would flood the desk's queue). */
  private readonly supportOpenLimiter: SharedSlidingWindowLimiter;
  /** First names per order and reader, so a 3-second poll logs one vault read, not one per poll. */
  private readonly names = new Map<string, Record<string, string | null>>();

  constructor(
    @Inject(CHAT_REPOSITORY) private readonly repo: ChatRepository,
    @Inject(CHAT_ORDERS) private readonly orders: ChatOrdersPort,
    @Inject(CHAT_TRIPS) private readonly trips: ChatTripsPort,
    @Inject(CHAT_IDENTITY) private readonly identity: ChatIdentityPort,
    @Inject(CHAT_STORES) private readonly stores: ChatStoresPort,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Inject(CALL_BRIDGE) private readonly bridge: CallBridgePort,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    // Shared by every API instance (Redis with REDIS_URL; review 2026-10-04 #22); in process otherwise.
    @Optional() @Inject(WINDOW_COUNTER) counter?: WindowCounter,
  ) {
    const shared = counter ?? new InMemoryWindowCounter(clock);
    this.sendLimiter = new SharedSlidingWindowLimiter(shared, 'send', CHAT_RULES.sendsPerMinute, 60_000);
    this.callLimiter = new SharedSlidingWindowLimiter(shared, 'call', CHAT_RULES.callsPer10Min, 10 * 60_000);
    this.supportOpenLimiter = new SharedSlidingWindowLimiter(shared, 'support_open', CHAT_RULES.supportOpensPerDay, 24 * 3_600_000, 'chat_support_limit');
  }

  // ───────────────────────── reads ─────────────────────────

  async threads(actor: Actor, input: ChatThreadsInput): Promise<ChatThreadSummary[]> {
    const ctx = await this.context(input.orderId);
    const now = this.clock.now();
    const support = await this.isSupport(actor.personId);
    const out: ChatThreadSummary[] = [];
    const stored = new Map((await this.repo.threadsOfOrder(ctx.order.id)).map((t) => [t.kind, t]));
    for (const kind of this.applicableKinds(ctx)) {
      const role = (await this.partyRole(actor.personId, ctx, kind)) ?? (support ? 'support' : null);
      if (!role) continue;
      const status = this.status(ctx, kind, now);
      const thread = stored.get(kind) ?? null;
      const unread = thread ? await this.unreadOf(thread, role, actor.personId) : 0;
      out.push({
        kind,
        status,
        myRole: role,
        counterpart: counterpartOf(kind, role),
        unread,
        lastMessageAt: thread ? await this.repo.lastMessageAt(thread.id) : null,
        canCall: canCallIn(kind, role, status),
      });
    }
    if (out.length === 0) throw new DriverError('chat_not_party');
    return out;
  }

  async thread(actor: Actor, input: ChatThreadInput): Promise<ChatThreadView> {
    const ctx = await this.context(input.orderId);
    const role = await this.roleIn(actor.personId, ctx, input.kind);
    return this.viewAs(actor.personId, ctx, role, input);
  }

  /**
   * The order's support chat as the desk sees it (the support case in the Console). The caller is the
   * `support.*` router, which already admitted the desk roles (finance included), so no party check.
   */
  async deskThread(personId: string, orderId: string): Promise<ChatThreadView> {
    const ctx = await this.context(orderId);
    return this.viewAs(personId, ctx, 'support', { orderId, kind: 'customer_support' });
  }

  /** The desk's answer on the order's support chat (`support.reply` on a chat case); a retry with the same `clientId` stores it once. */
  async deskReply(personId: string, orderId: string, text: string, clientId: string): Promise<ChatMessage> {
    const ctx = await this.context(orderId);
    return this.sendAs(personId, ctx, 'support', { orderId, kind: 'customer_support', clientId, text });
  }

  /** The desk has read the support chat up to `seq` (the customer's «شافها» tick). */
  async deskMarkRead(orderId: string, seq: number): Promise<void> {
    const thread = await this.repo.findThread(orderId, 'customer_support');
    if (!thread) return;
    await this.uow.run((tx) => this.repo.markRead(thread.id, 'support', Math.min(seq, thread.lastSeq), tx));
  }

  private async viewAs(personId: string, ctx: OrderContext, role: ChatRole, input: ChatThreadInput): Promise<ChatThreadView> {
    const actor = { personId };
    const now = this.clock.now();
    const status = this.status(ctx, input.kind, now);
    const thread = await this.repo.findThread(ctx.order.id, input.kind);
    const reads = thread ? await this.repo.readSeqs(thread.id) : new Map<string, number>();
    const myKey = readerKey(role, actor.personId, input.kind);
    const myReadSeq = reads.get(myKey) ?? 0;
    const otherRead = this.counterpartReadSeq(input.kind, role, ctx, reads);
    const records = thread ? await this.repo.messages(thread.id, { ...(input.afterSeq !== undefined ? { afterSeq: input.afterSeq } : {}), limit: CHAT_RULES.pageSize }) : [];
    return {
      threadId: thread?.id ?? null,
      orderId: ctx.order.id,
      kind: input.kind,
      status,
      closesAt: this.closesAt(ctx, input.kind),
      myRole: role,
      ride: ctx.ride,
      participants: await this.participants(actor.personId, ctx, input.kind, role),
      messages: records.map((m) => this.messageView(m, role, otherRead)),
      lastSeq: thread?.lastSeq ?? 0,
      myReadSeq,
      unread: thread ? await this.repo.countUnread(thread.id, myReadSeq, role) : 0,
      quickReplies: status === 'open' && role !== 'support' ? quickRepliesFor(role, input.kind, ctx.ride) : [],
      canCall: canCallIn(input.kind, role, status),
      serverNow: now,
    };
  }

  // ───────────────────────── writes ─────────────────────────

  async send(actor: Actor, input: ChatSendInput): Promise<ChatMessage> {
    const ctx = await this.context(input.orderId);
    const role = await this.roleIn(actor.personId, ctx, input.kind);
    return this.sendAs(actor.personId, ctx, role, input);
  }

  /**
   * A signed upload for a voice note (ride ideas n7/n8), in the customer ↔ courier and support chats:
   * only for someone who may write in the thread right now, so nobody fills storage through a closed or foreign chat. The bytes are checked on
   * arrival (an audio container of the declared type, at most `VOICE_RULES.maxBytes`).
   */
  async voiceUpload(actor: Actor, input: ChatVoiceUploadInput): Promise<VoiceUploadTicket> {
    if (!voiceAllowedIn(input.kind)) throw new DriverError('chat_voice_unavailable');
    const ctx = await this.context(input.orderId);
    const role = await this.roleIn(actor.personId, ctx, input.kind);
    if (!(input.kind === 'customer_support' && role === 'support')) this.assertOpen(this.status(ctx, input.kind, this.clock.now()));
    return this.blobs.createUpload({ ownerId: actor.personId, contentType: input.contentType, sizeBytes: input.sizeBytes });
  }

  private async sendAs(personId: string, ctx: OrderContext, role: ChatRole, input: ChatSendInput): Promise<ChatMessage> {
    const actor = { personId };
    const now = this.clock.now();
    // The desk always has the last word on a support chat, even after it closed for the customer.
    if (!(input.kind === 'customer_support' && role === 'support')) this.assertOpen(this.status(ctx, input.kind, now));
    await this.sendLimiter.hit(actor.personId);
    if (input.kind === 'customer_support' && role === 'customer' && !(await this.repo.findThread(ctx.order.id, input.kind))) {
      await this.supportOpenLimiter.hit(actor.personId);
    }

    let body: string | null = null;
    let masked = false;
    let kind: ChatMessage['kind'];
    let photoRef: string | null = null;
    let voiceRef: string | null = null;
    if (input.text !== undefined) {
      const m = maskIraqiPhones(input.text.trim());
      body = m.text;
      masked = m.masked;
      kind = 'text';
    } else if (input.quickReplyKey !== undefined) {
      if (!quickRepliesFor(role, input.kind, ctx.ride).includes(input.quickReplyKey)) throw new DriverError('chat_quick_reply_invalid');
      body = quickReplyText(input.quickReplyKey);
      kind = 'quick_reply';
    } else if (input.photoUploadId !== undefined) {
      const blob = await this.blobs.get(input.photoUploadId);
      if (!blob || blob.ownerId !== actor.personId || blob.state !== 'stored') throw new DriverError('upload_invalid');
      photoRef = blob.id;
      kind = 'photo';
    } else if (input.voiceUploadId !== undefined) {
      if (!voiceAllowedIn(input.kind)) throw new DriverError('chat_voice_unavailable');
      const blob = await this.blobs.getVoice(input.voiceUploadId);
      if (!blob || blob.ownerId !== actor.personId || blob.state !== 'stored') throw new DriverError('upload_invalid');
      voiceRef = blob.id;
      kind = 'voice';
    } else {
      kind = 'location';
    }

    const recipients = await this.recipients(ctx, input.kind, role, actor.personId);
    const record = await this.uow.run(async (tx) => {
      const thread = await this.repo.ensureThread(ctx.order.id, input.kind, now, tx);
      const { message, inserted } = await this.repo.append(
        thread.id,
        {
          senderId: actor.personId,
          senderRole: role,
          kind,
          body,
          quickReplyKey: input.quickReplyKey ?? null,
          photoRef,
          voiceRef,
          durationSec: voiceRef ? (input.durationSec ?? null) : null,
          lat: input.location?.lat ?? null,
          lng: input.location?.lng ?? null,
          masked,
          clientId: input.clientId,
          createdAt: now,
        },
        tx,
      );
      if (inserted) {
        // The sender has obviously read everything up to their own message.
        await this.repo.markRead(thread.id, readerKey(role, actor.personId, input.kind), message.seq, tx);
        const payload = ChatMessageSentPayload.parse({
          threadId: thread.id,
          orderId: ctx.order.id,
          kind: input.kind,
          messageId: message.id,
          seq: message.seq,
          senderRole: role,
          messageKind: kind,
          ride: ctx.ride,
          recipientIds: recipients,
          preview: body ? body.slice(0, 80) : null,
        });
        await this.events.emit(
          tx,
          { type: 'chat.message_sent', actorId: actor.personId, occurredAt: now, orderId: ctx.order.id, payload, idempotencyKey: `chat:${thread.id}:${actor.personId}:${input.clientId}` },
          { name: 'chat_thread', id: thread.id },
        );
      }
      return message;
    });
    return this.messageView(record, role, 0);
  }

  async markRead(actor: Actor, input: ChatMarkReadInput): Promise<ChatMarkReadOutput> {
    const ctx = await this.context(input.orderId);
    const role = await this.roleIn(actor.personId, ctx, input.kind);
    const thread = await this.repo.findThread(ctx.order.id, input.kind);
    if (!thread) return { myReadSeq: 0, unread: 0 };
    const seq = Math.min(input.seq, thread.lastSeq);
    const myReadSeq = await this.uow.run((tx) => this.repo.markRead(thread.id, readerKey(role, actor.personId, input.kind), seq, tx));
    return { myReadSeq, unread: await this.repo.countUnread(thread.id, myReadSeq, role) };
  }

  /**
   * A masked call to the other party of the thread. Every request is logged (an event on the
   * thread plus the server log), allowed or not past the party check.
   */
  async requestCall(actor: Actor, input: ChatRequestCallInput): Promise<CallSession> {
    const ctx = await this.context(input.orderId);
    const role = await this.roleIn(actor.personId, ctx, input.kind);
    const now = this.clock.now();
    const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const counterpart = counterpartOf(input.kind, role);
    const log = (outcome: string, mode: string | null) => {
      this.logger.log(`call ${callId} order=${ctx.order.id} kind=${input.kind} ${role}→${counterpart} by=${actor.personId} ${outcome}${mode ? ` mode=${mode}` : ''}`);
      return this.events.emit(
        undefined,
        { type: 'chat.call_requested', actorId: actor.personId, occurredAt: now, orderId: ctx.order.id, payload: { callId, orderId: ctx.order.id, kind: input.kind, callerRole: role, calleeRole: counterpart, outcome, mode } },
        { name: 'order', id: ctx.order.id },
      );
    };
    try {
      if (role === 'support' || input.kind === 'customer_support') throw new DriverError('chat_not_party');
      this.assertOpen(this.status(ctx, input.kind, now));
      await this.callLimiter.hit(actor.personId);
      const calleeId = await this.calleeOf(ctx, counterpart);
      if (!calleeId) throw new DriverError('call_unavailable');
      const session = await this.bridge.open({ callId, orderId: ctx.order.id, callerId: actor.personId, calleeId }, now);
      await log('opened', session.mode);
      return { callId, mode: session.mode, dial: session.dial, counterpart, expiresAt: session.expiresAt };
    } catch (err) {
      await log(`refused:${err instanceof DriverError ? err.code : 'error'}`, null);
      throw err;
    }
  }

  // ───────────────────────── retention ─────────────────────────

  /**
   * Voice notes go with the chat (ride ideas n7/n8): every file of a thread that is closed now is
   * deleted and its message keeps only its length (the bubble says the note is gone). Threads are
   * walked in id order, `batch` at a time, so open ones never block the rest. Returns the files deleted.
   */
  async purgeClosedVoice(batch: number): Promise<number> {
    const now = this.clock.now();
    let deleted = 0;
    let after: string | undefined;
    for (;;) {
      const page = await this.repo.threadsWithVoice({ ...(after !== undefined ? { afterThreadId: after } : {}), limit: batch });
      for (const t of page) deleted += await this.purgeVoiceIfClosed(t, now);
      if (page.length < batch) return deleted;
      after = page[page.length - 1]!.threadId;
    }
  }

  private async purgeVoiceIfClosed(t: ChatVoiceThread, now: Date): Promise<number> {
    let ctx: OrderContext;
    try {
      ctx = await this.context(t.orderId);
    } catch (err) {
      // An order that cannot be read is skipped this round, never purged on a guess.
      this.logger.warn(`voice retention: order ${t.orderId} unreadable: ${(err as Error).message}`);
      return 0;
    }
    if (this.status(ctx, t.kind, now) !== 'closed') return 0;
    for (const v of t.voices) {
      await this.blobs.remove(v.voiceRef);
      await this.repo.clearVoice(v.messageId);
    }
    return t.voices.length;
  }

  // ───────────────────────── «نسيت غرض» (s7) ─────────────────────────

  /**
   * s7 «نسيت غرض»: within `CHAT_LOST_ITEM_H` of a completed ride, its orderer or rider reopens the chat
   * with the driver until the ride's end + `CHAT_LOST_ITEM_H`, and the thread gets one line the server
   * writes («الراكب يدور على غرض نساه») — which also pushes the driver. Asking again is safe: the window
   * stays the same and the line is written once.
   */
  async lostItem(actor: Actor, input: ChatLostItemInput): Promise<ChatLostItemResult> {
    const ctx = await this.context(input.orderId);
    if (!ctx.customerIds.has(actor.personId)) throw new DriverError('chat_not_party');
    const now = this.clock.now();
    const until = ctx.rideCompletedAt ? new Date(ctx.rideCompletedAt.getTime() + CHAT_LOST_ITEM_H * 3_600_000) : null;
    if (!ctx.ride || !until || !ctx.courierId || now.getTime() >= until.getTime()) throw new DriverError('chat_lost_item_unavailable');
    await this.sendLimiter.hit(actor.personId);
    const kind: ChatThreadKind = 'customer_courier';
    const recipients = await this.recipients(ctx, kind, 'customer', actor.personId);
    const body = t('chat.lost_item_line', {}, 'ar-IQ');
    const thread = await this.uow.run(async (tx) => {
      const opened = await this.repo.reopenForLostItem((await this.repo.ensureThread(ctx.order.id, kind, now, tx)).id, until, now, tx);
      const { message, inserted } = await this.repo.append(
        opened.id,
        { senderId: actor.personId, senderRole: 'customer', kind: 'system', body, quickReplyKey: null, photoRef: null, voiceRef: null, durationSec: null, lat: null, lng: null, masked: false, clientId: LOST_ITEM_CLIENT_ID, createdAt: now },
        tx,
      );
      if (inserted) {
        await this.repo.markRead(opened.id, readerKey('customer', actor.personId, kind), message.seq, tx);
        const payload = ChatMessageSentPayload.parse({
          threadId: opened.id,
          orderId: ctx.order.id,
          kind,
          messageId: message.id,
          seq: message.seq,
          senderRole: 'customer',
          messageKind: 'system',
          ride: true,
          recipientIds: recipients,
          preview: body.slice(0, 80),
        });
        await this.events.emit(
          tx,
          { type: 'chat.message_sent', actorId: actor.personId, occurredAt: now, orderId: ctx.order.id, payload, idempotencyKey: `chat:${opened.id}:${actor.personId}:${LOST_ITEM_CLIENT_ID}` },
          { name: 'chat_thread', id: opened.id },
        );
      }
      return opened;
    });
    return { threadId: thread.id, openUntil: until };
  }

  /** s7: the driver's reopened «نسيت غرض» chats still open, newest ask first (the partner app's list). */
  async lostItems(actor: Actor): Promise<ChatLostItemThread[]> {
    const out: ChatLostItemThread[] = [];
    for (const thread of await this.repo.lostItemThreadsOpen(this.clock.now())) {
      if (thread.kind !== 'customer_courier' || !thread.lostItemUntil) continue;
      const ctx = await this.context(thread.orderId).catch(() => null);
      if (!ctx || ctx.courierId !== actor.personId) continue;
      out.push({ orderId: thread.orderId, threadId: thread.id, openUntil: thread.lostItemUntil, askedAt: thread.lostItemAskedAt ?? thread.createdAt, unread: await this.unreadOf(thread, 'courier', actor.personId) });
    }
    return out.sort((a, b) => b.askedAt.getTime() - a.askedAt.getTime());
  }

  // ───────────────────────── rules ─────────────────────────

  private async context(orderId: string): Promise<OrderContext> {
    const order = await this.orders.get(orderId);
    let trip = await this.trips.activeForOrder(orderId);
    if (!trip) {
      const carried = await this.trips.courierOf(orderId);
      trip = carried ? await this.trips.get(carried.tripId) : null;
    }
    const courierOn = trip && trip.courierId && trip.acceptedAt && COURIER_PARTY_STATES.has(trip.state);
    const customerIds = new Set<string>([order.ordererId, ...order.participants.map((p) => p.personId).filter((p): p is string => p !== null)]);
    let doneAt: Date | null = null;
    if (DONE_ORDER_STATES.has(order.state)) {
      doneAt = order.deliveredAt ?? order.cancelledAt ?? (trip?.state === 'completed' ? trip.completedAt : null) ?? trip?.cancelledAt ?? order.closedAt ?? order.placedAt;
    } else if (trip?.state === 'completed' && trip.completedAt) {
      doneAt = trip.completedAt;
    }
    const ride = order.type === 'ride';
    const lostItem = ride ? await this.repo.findThread(orderId, 'customer_courier') : null;
    const riderId = order.type === 'ride' ? (order.participants.find((p) => p.role === 'rider' && p.personId)?.personId ?? null) : null;
    return {
      order,
      ride,
      customerIds,
      riderId,
      courierId: courierOn ? trip!.courierId : null,
      courierAcceptedAt: courierOn ? trip!.acceptedAt : null,
      doneAt,
      rideCompletedAt: ride && trip?.state === 'completed' ? trip.completedAt : null,
      lostItemUntil: lostItem?.lostItemUntil ?? null,
    };
  }

  /** When a thread closes: completion + 30 min (support: + 24 h), or later while a lost item reopened it (s7). */
  private closesAt(ctx: OrderContext, kind: ChatThreadKind): Date | null {
    if (!ctx.doneAt) return null;
    const usual = closesAt(ctx.doneAt, kind);
    return kind === 'customer_courier' && ctx.lostItemUntil && ctx.lostItemUntil.getTime() > usual.getTime() ? ctx.lostItemUntil : usual;
  }

  private applicableKinds(ctx: OrderContext): ChatThreadKind[] {
    // The courier and support chats exist on every order (rides and parcels too); the kitchen's only with a kitchen.
    return ALL_KINDS.filter((k) => k === 'customer_courier' || k === 'customer_support' || ctx.order.merchantOrgId !== null);
  }

  private status(ctx: OrderContext, kind: ChatThreadKind, now: Date): ChatThreadStatus {
    const closes = this.closesAt(ctx, kind);
    if (closes && now.getTime() >= closes.getTime()) return 'closed';
    // «كلّم الدعم» works from the moment the order is placed.
    if (kind === 'customer_support') return 'open';
    const opened = kind === 'customer_merchant' ? (ctx.order.merchantOrgId ? ctx.order.acceptedAt : null) : ctx.courierAcceptedAt;
    return opened ? 'open' : 'not_open';
  }

  private assertOpen(status: ChatThreadStatus): void {
    if (status === 'closed') throw new DriverError('chat_closed');
    if (status === 'not_open') throw new DriverError('chat_not_open');
  }

  private async isParty(personId: string, role: ChatRole, ctx: OrderContext): Promise<boolean> {
    if (role === 'customer') return ctx.customerIds.has(personId);
    if (role === 'courier') return ctx.courierId === personId;
    if (role === 'merchant') {
      const org = ctx.order.merchantOrgId;
      if (!org) return false;
      for (const k of MERCHANT_ROLES) if (await this.identity.hasRole(personId, k, org)) return true;
    }
    return false;
  }

  private async isSupport(personId: string): Promise<boolean> {
    for (const k of SUPPORT_ROLES) if (await this.identity.hasRole(personId, k)) return true;
    return false;
  }

  /** The actor's party in a thread of `kind`, or null. */
  private async partyRole(personId: string, ctx: OrderContext, kind: ChatThreadKind): Promise<ChatRole | null> {
    if (!this.applicableKinds(ctx).includes(kind)) return null;
    for (const r of CHAT_THREAD_PARTIES[kind]) {
      // The support chat is the orderer's own (a rider or group-order guest never reads his case with us).
      if (kind === 'customer_support' && r === 'customer') {
        if (personId === ctx.order.ordererId) return r;
        continue;
      }
      if (await this.isParty(personId, r, ctx)) return r;
    }
    return null;
  }

  /** The actor's role in the thread (a party first, then support) or `chat_not_party`. */
  private async roleIn(personId: string, ctx: OrderContext, kind: ChatThreadKind): Promise<ChatRole> {
    if (!this.applicableKinds(ctx).includes(kind)) throw new DriverError('chat_not_party');
    const party = await this.partyRole(personId, ctx, kind);
    if (party) return party;
    if (await this.isSupport(personId)) return 'support';
    throw new DriverError('chat_not_party');
  }

  private async unreadOf(thread: ChatThreadRecord, role: ChatRole, personId: string): Promise<number> {
    const reads = await this.repo.readSeqs(thread.id);
    return this.repo.countUnread(thread.id, reads.get(readerKey(role, personId, thread.kind as ChatThreadKind)) ?? 0, role);
  }

  /** What the other party has read (for my read receipts); support reads count for neither party. */
  private counterpartReadSeq(kind: ChatThreadKind, role: ChatRole, ctx: OrderContext, reads: Map<string, number>): number {
    // The support chat has two readers: the customer side and the desk (any agent).
    if (kind === 'customer_support') return reads.get(role === 'customer' ? 'support' : 'customer') ?? 0;
    const keyOf = (r: ChatRole): string | null => (r === 'courier' ? (ctx.courierId ? `courier:${ctx.courierId}` : null) : r);
    if (role === 'support') {
      return Math.max(...CHAT_THREAD_PARTIES[kind].map((r) => reads.get(keyOf(r) ?? '') ?? 0));
    }
    const other = keyOf(counterpartOf(kind, role));
    return other ? (reads.get(other) ?? 0) : 0;
  }

  private messageView(m: ChatMessageRecord, readerRole: ChatRole, otherReadSeq: number): ChatMessage {
    const mine = m.senderRole === readerRole;
    return {
      id: m.id,
      seq: m.seq,
      senderRole: m.senderRole,
      mine,
      kind: m.kind,
      text: m.body,
      quickReplyKey: (m.quickReplyKey as ChatMessage['quickReplyKey']) ?? null,
      photoUrl: m.photoRef ? this.blobs.readUrl(m.photoRef) : null,
      audioUrl: m.voiceRef ? this.blobs.readUrl(m.voiceRef) : null,
      durationSec: m.kind === 'voice' ? m.durationSec : null,
      location: m.lat !== null && m.lng !== null ? { lat: m.lat, lng: m.lng } : null,
      masked: m.masked,
      createdAt: m.createdAt,
      read: mine && otherReadSeq >= m.seq,
    };
  }

  /** The two parties by role and first name (people) or store name (the kitchen). */
  private async participants(readerId: string, ctx: OrderContext, kind: ChatThreadKind, myRole: ChatRole): Promise<ChatParticipant[]> {
    const people = CHAT_THREAD_PARTIES[kind].flatMap((r) => (r === 'customer' ? [ctx.order.ordererId] : r === 'courier' && ctx.courierId ? [ctx.courierId] : []));
    const names = await this.firstNames(ctx.order.id, readerId, people);
    const out: ChatParticipant[] = [];
    for (const r of CHAT_THREAD_PARTIES[kind]) {
      let name: string | null = null;
      if (r === 'customer') name = ctx.riderId ? await this.riderName(ctx, readerId) : (names[ctx.order.ordererId] ?? null);
      else if (r === 'courier') name = ctx.courierId ? (names[ctx.courierId] ?? null) : null;
      else if (r === 'merchant' && ctx.order.merchantOrgId) name = await this.stores.storeName(ctx.order.merchantOrgId);
      out.push({ role: r, name, you: r === myRole });
    }
    return out;
  }

  /** c9/s3: on a ride for someone else the customer side is the rider, by the name the booker gave them. */
  private async riderName(ctx: OrderContext, readerId: string): Promise<string | null> {
    return (await this.orders.riderOf?.(ctx.order.id, readerId, 'chat_thread'))?.name ?? null;
  }

  private async firstNames(orderId: string, readerId: string, personIds: string[]): Promise<Record<string, string | null>> {
    const key = `${orderId}:${readerId}:${[...personIds].sort().join(',')}`;
    const hit = this.names.get(key);
    if (hit) return hit;
    const names = personIds.length ? await this.identity.firstNamesFor(personIds, readerId, 'chat_thread') : {};
    if (this.names.size >= NAME_CACHE_MAX) this.names.delete(this.names.keys().next().value!);
    this.names.set(key, names);
    return names;
  }

  /** Who gets the push for a new message: the other party (support's messages go to both). */
  private async recipients(ctx: OrderContext, kind: ChatThreadKind, senderRole: ChatRole, senderId: string): Promise<string[]> {
    const roles = senderRole === 'support' ? [...CHAT_THREAD_PARTIES[kind]] : [counterpartOf(kind, senderRole)];
    const out = new Set<string>();
    for (const r of roles) {
      if (r === 'customer') {
        out.add(ctx.order.ordererId);
        // c9/s3: the rider is at the pickup, so the driver's messages reach them too (the booker follows).
        if (ctx.riderId && kind === 'customer_courier') out.add(ctx.riderId);
      } else if (r === 'courier' && ctx.courierId) out.add(ctx.courierId);
      else if (r === 'merchant' && ctx.order.merchantOrgId) {
        for (const h of await this.identity.orgRoleHolders(ctx.order.merchantOrgId, MERCHANT_ROLES)) if (!h.frozen) out.add(h.personId);
      }
    }
    out.delete(senderId);
    return [...out];
  }

  /**
   * The person a masked call rings: the courier, the orderer (the rider on a ride booked for someone
   * else, c9 — «اتصل بالراكب»), or the kitchen's owner.
   */
  private async calleeOf(ctx: OrderContext, role: ChatRole): Promise<string | null> {
    if (role === 'courier') return ctx.courierId;
    if (role === 'customer') return ctx.riderId ?? ctx.order.ordererId;
    if (role === 'merchant' && ctx.order.merchantOrgId) {
      const holders = (await this.identity.orgRoleHolders(ctx.order.merchantOrgId, MERCHANT_ROLES)).filter((h) => !h.frozen);
      return (holders.find((h) => h.kind === 'merchant_owner') ?? holders[0])?.personId ?? null;
    }
    return null;
  }
}

// ───────────────────────── helpers ─────────────────────────

/** The client id of the one «نسيت غرض» line per asker (a repeated ask writes nothing new). */
const LOST_ITEM_CLIENT_ID = 'system:lost_item';

export function closesAt(doneAt: Date, kind?: ChatThreadKind): Date {
  if (kind === 'customer_support') return new Date(doneAt.getTime() + CHAT_SUPPORT_CLOSE_AFTER_H * 3_600_000);
  return new Date(doneAt.getTime() + CHAT_CLOSE_AFTER_MIN * 60_000);
}

/** Masked calls only between the order's own parties, never on the support chat (calls are postponed, before-launch §3). */
function canCallIn(kind: ChatThreadKind, role: ChatRole, status: ChatThreadStatus): boolean {
  return status === 'open' && role !== 'support' && kind !== 'customer_support';
}

/** The other party of the pair; for support, the pair's first party. */
export function counterpartOf(kind: ChatThreadKind, role: ChatRole): ChatRole {
  const [a, b] = CHAT_THREAD_PARTIES[kind];
  if (role === a) return b;
  if (role === b) return a;
  return a;
}

/** Read receipts belong to the party: the customer side, the kitchen and (on a support chat) the desk are one reader each. */
export function readerKey(role: ChatRole, personId: string, kind?: ChatThreadKind): string {
  if (role === 'customer' || role === 'merchant') return role;
  if (role === 'support' && kind === 'customer_support') return 'support';
  return `${role}:${personId}`;
}
