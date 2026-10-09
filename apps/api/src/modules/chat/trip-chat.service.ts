import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ChatMessageSentPayload,
  DriverError,
  quickRepliesFor,
  quickReplyText,
  type Actor,
  type ChatMarkReadOutput,
  type ChatMessage,
  type ChatParticipant,
  type ChatRole,
  type ChatThreadStatus,
  type TripCardKind,
  type TripChatCard,
  type TripChatMarkReadInput,
  type TripChatPort,
  type TripChatSendInput,
  type TripChatSubject,
  type TripChatSummary,
  type TripChatRef,
  type TripChatThreadInput,
  type TripChatThreadsInput,
  type TripChatView,
  type TripChatVoiceUploadInput,
  type VoiceUploadTicket,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { InMemoryWindowCounter, WINDOW_COUNTER, type WindowCounter } from '../../shared/window-counter.js';
import { EventsService } from '../events/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { TripChatSubjects, type TripCardTarget, type TripChatPair } from '../routes/index.js';
import { CHAT_REPOSITORY, type ChatMessageRecord, type ChatRepository, type ChatThreadRecord, type ChatVoiceThread } from './chat.repository.js';
import { CHAT_IDENTITY, CHAT_RULES, messageViewOf, readerKey, type ChatIdentityPort } from './chat.common.js';
import { maskIraqiPhones } from './mask.js';
import { SharedSlidingWindowLimiter } from './rate-limit.js';

/** New Baghdad/Kut threads one person may start in 24 h (each pages the other side; a spam guard). */
export const TRIP_CHAT_OPENS_PER_DAY = 20;

const KIND = 'rider_driver' as const;

/** What a new card says, from the routes event that made it. */
export interface NewTripCard {
  kind: TripCardKind;
  refId: string;
  /** The price it names (0 = «ببلاش»), a cash ask's no-show amount; null on a pin or door ask (an ask carries none). */
  amountIqd: number | null;
  /** Who acted: the rider for an ask, the driver for a price. */
  actorId: string;
  /** The routes event's id: a redelivered event writes the card once. */
  eventId: string;
  at: Date;
}

/**
 * The Baghdad/Kut chat (private car round 2 step 4c; Ali's item 11 and design way 2, 2026-10-08): one
 * `rider_driver` thread per rider and driver of a run or private-car request, stored in the chat
 * tables beside the order threads. Who the two are and whether the thread is open come from the routes
 * module (`TripChatSubjects`) on every call; the agreed prices are written in as cards by the
 * `chat:trip_cards` outbox subscriber and shown with their live state, plus the pinned strip.
 * Messages push the other side through `chat.message_sent`, like any chat.
 */
@Injectable()
export class TripChatService implements TripChatPort {
  private readonly logger = new Logger(TripChatService.name);
  private readonly sendLimiter: SharedSlidingWindowLimiter;
  private readonly openLimiter: SharedSlidingWindowLimiter;

  constructor(
    @Inject(CHAT_REPOSITORY) private readonly repo: ChatRepository,
    private readonly subjects: TripChatSubjects,
    @Inject(CHAT_IDENTITY) private readonly identity: ChatIdentityPort,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(WINDOW_COUNTER) counter?: WindowCounter,
  ) {
    const shared = counter ?? new InMemoryWindowCounter(clock);
    // The same per-person send budget as the order chats.
    this.sendLimiter = new SharedSlidingWindowLimiter(shared, 'send', CHAT_RULES.sendsPerMinute, 60_000);
    this.openLimiter = new SharedSlidingWindowLimiter(shared, 'trip_open', TRIP_CHAT_OPENS_PER_DAY, 24 * 3_600_000);
  }

  // ───────────────────────── reads ─────────────────────────

  async liveParty(actor: Actor, input: TripChatRef): Promise<string> {
    return (await this.resolve(actor.personId, input.subject, input.id, input.with)).pair.partyId;
  }

  async thread(actor: Actor, input: TripChatThreadInput): Promise<TripChatView> {
    const { pair, role } = await this.resolve(actor.personId, input.subject, input.id, input.with);
    const thread = await this.repo.findPairThread(pair.id, pair.partyId);
    const reads = thread ? await this.repo.readSeqs(thread.id) : new Map<string, number>();
    const myReadSeq = reads.get(readerKey(role, actor.personId, KIND)) ?? 0;
    const otherRead = reads.get(role === 'customer' ? readerKey('courier', pair.driverId, KIND) : readerKey('customer', pair.riderId, KIND)) ?? 0;
    const records = thread ? await this.repo.messages(thread.id, { ...(input.afterSeq !== undefined ? { afterSeq: input.afterSeq } : {}), limit: CHAT_RULES.pageSize }) : [];
    const cards = await this.cardsOf(pair, records);
    return {
      threadId: thread?.id ?? null,
      orderId: pair.id,
      kind: KIND,
      status: pair.status,
      closesAt: pair.closesAt,
      myRole: role,
      ride: true,
      participants: await this.participants(actor.personId, pair, role),
      messages: records.map((m) => messageViewOf(m, role, otherRead, (ref) => this.blobs.readUrl(ref), cards.get(m.id) ?? null)),
      lastSeq: thread?.lastSeq ?? 0,
      myReadSeq,
      unread: thread ? await this.repo.countUnread(thread.id, myReadSeq, role) : 0,
      quickReplies: pair.status === 'open' ? quickRepliesFor(role, KIND, true) : [],
      // Calls stay with garage mode's «اتصل» for now (before-launch §3: calls are ours to carry).
      canCall: false,
      serverNow: this.clock.now(),
      subject: pair.subject,
      partyId: pair.partyId,
      trip: pair.trip,
      deal: await this.subjects.deal(pair),
    };
  }

  async threads(actor: Actor, input: TripChatThreadsInput): Promise<TripChatSummary[]> {
    const stored = (await this.repo.threadsOfOrder(input.id)).filter((t) => t.kind === KIND);
    const pairs = await this.subjects.pairsOf(input.subject, input.id, actor.personId, stored.map((t) => t.partyId));
    const others = pairs.map((p) => (p.riderId === actor.personId ? p.driverId : p.riderId));
    const names = others.length ? await this.identity.firstNamesFor(others, actor.personId, 'trip_chat') : {};
    const out: TripChatSummary[] = [];
    for (const pair of pairs) {
      const role: ChatRole = pair.riderId === actor.personId ? 'customer' : 'courier';
      const withId = role === 'customer' ? pair.driverId : pair.riderId;
      const thread = stored.find((t) => t.partyId === pair.partyId) ?? null;
      const deal = await this.subjects.deal(pair);
      out.push({
        subject: pair.subject,
        id: pair.id,
        withId,
        withName: names[withId] ?? null,
        status: pair.status,
        unread: thread ? await this.unreadOf(thread, role, actor.personId) : 0,
        lastMessageAt: thread ? await this.repo.lastMessageAt(thread.id) : null,
        waitingOnYou: deal.filter((d) => (role === 'courier' ? d.state === 'asked' : d.state === 'proposed')).length,
      });
    }
    return out.sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
  }

  // ───────────────────────── writes ─────────────────────────

  async send(actor: Actor, input: TripChatSendInput): Promise<ChatMessage> {
    const { pair, role } = await this.resolve(actor.personId, input.subject, input.id, input.with);
    assertOpen(pair.status);
    await this.sendLimiter.hit(actor.personId);
    if (!(await this.repo.findPairThread(pair.id, pair.partyId))) await this.openLimiter.hit(actor.personId);

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
      if (!quickRepliesFor(role, KIND, true).includes(input.quickReplyKey)) throw new DriverError('chat_quick_reply_invalid');
      body = quickReplyText(input.quickReplyKey);
      kind = 'quick_reply';
    } else if (input.photoUploadId !== undefined) {
      const blob = await this.blobs.get(input.photoUploadId);
      if (!blob || blob.ownerId !== actor.personId || blob.state !== 'stored') throw new DriverError('upload_invalid');
      photoRef = blob.id;
      kind = 'photo';
    } else if (input.voiceUploadId !== undefined) {
      const blob = await this.blobs.getVoice(input.voiceUploadId);
      if (!blob || blob.ownerId !== actor.personId || blob.state !== 'stored') throw new DriverError('upload_invalid');
      voiceRef = blob.id;
      kind = 'voice';
    } else {
      kind = 'location';
    }

    const now = this.clock.now();
    const record = await this.uow.run((tx) =>
      this.append(pair, role, actor.personId, {
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
      }, tx),
    );
    return messageViewOf(record, role, 0, (ref) => this.blobs.readUrl(ref), null);
  }

  async voiceUpload(actor: Actor, input: TripChatVoiceUploadInput): Promise<VoiceUploadTicket> {
    const { pair } = await this.resolve(actor.personId, input.subject, input.id, input.with);
    assertOpen(pair.status);
    return this.blobs.createUpload({ ownerId: actor.personId, contentType: input.contentType, sizeBytes: input.sizeBytes });
  }

  async markRead(actor: Actor, input: TripChatMarkReadInput): Promise<ChatMarkReadOutput> {
    const { pair, role } = await this.resolve(actor.personId, input.subject, input.id, input.with);
    const thread = await this.repo.findPairThread(pair.id, pair.partyId);
    if (!thread) return { myReadSeq: 0, unread: 0 };
    const seq = Math.min(input.seq, thread.lastSeq);
    const myReadSeq = await this.uow.run((tx) => this.repo.markRead(thread.id, readerKey(role, actor.personId, KIND), seq, tx));
    return { myReadSeq, unread: await this.repo.countUnread(thread.id, myReadSeq, role) };
  }

  /**
   * A card for an agreed price (the `chat:trip_cards` subscriber): the rider's ask, the driver's price,
   * the private car's «احجز وادفع كاش» ask. It goes in even when nobody wrote yet (the thread opens with
   * it) and pushes the other side; a redelivered event writes it once.
   */
  async writeCard(target: TripCardTarget, card: NewTripCard): Promise<void> {
    const role: ChatRole = card.actorId === target.driverId ? 'courier' : 'customer';
    const pair = { subject: target.subject, id: target.id, riderId: target.riderId, driverId: target.driverId, partyId: target.partyId };
    await this.uow.run((tx) =>
      this.append(pair, role, card.actorId, {
        kind: 'card',
        body: null,
        quickReplyKey: null,
        photoRef: null,
        voiceRef: null,
        durationSec: null,
        lat: null,
        lng: null,
        masked: false,
        clientId: `card:${card.eventId}`,
        refKind: card.kind,
        refId: card.refId,
        refAmountIqd: card.amountIqd,
        createdAt: card.at,
      }, tx),
    );
  }

  // ───────────────────────── retention ─────────────────────────

  /** Whether a stored thread is closed now (the voice retention deletes its notes then); null when the trip is gone. */
  async statusOf(t: Pick<ChatVoiceThread, 'orderId' | 'partyId'>): Promise<ChatThreadStatus | null> {
    const subject: TripChatSubject = t.orderId.startsWith('rq_') ? 'request' : 'departure';
    try {
      return (await this.subjects.pairByParty(subject, t.orderId, t.partyId))?.status ?? 'closed';
    } catch (err) {
      this.logger.warn(`trip chat ${t.orderId}/${t.partyId}: status unreadable: ${(err as Error).message}`);
      return null;
    }
  }

  // ───────────────────────── internals ─────────────────────────

  private async resolve(actorId: string, subject: TripChatSubject, id: string, withId: string | undefined): Promise<{ pair: TripChatPair; role: 'customer' | 'courier' }> {
    return this.subjects.pair(subject, id, actorId, withId, async (partyId) => (await this.repo.findPairThread(id, partyId)) !== null);
  }

  private async append(
    pair: Pick<TripChatPair, 'subject' | 'id' | 'riderId' | 'driverId' | 'partyId'>,
    role: ChatRole,
    senderId: string,
    message: Omit<ChatMessageRecord, 'id' | 'seq' | 'threadId' | 'senderId' | 'senderRole' | 'refKind' | 'refId' | 'refAmountIqd'> & Partial<Pick<ChatMessageRecord, 'refKind' | 'refId' | 'refAmountIqd'>>,
    tx: Tx,
  ): Promise<ChatMessageRecord> {
    const thread = await this.repo.ensurePairThread(pair.id, pair.partyId, message.createdAt, tx);
    const { message: stored, inserted } = await this.repo.append(thread.id, { ...message, senderId, senderRole: role }, tx);
    if (inserted) {
      await this.repo.markRead(thread.id, readerKey(role, senderId, KIND), stored.seq, tx);
      const payload = ChatMessageSentPayload.parse({
        threadId: thread.id,
        orderId: pair.id,
        kind: KIND,
        messageId: stored.id,
        seq: stored.seq,
        senderRole: role,
        messageKind: stored.kind,
        ride: true,
        recipientIds: [role === 'customer' ? pair.driverId : pair.riderId].filter((p) => p !== senderId),
        preview: stored.body ? stored.body.slice(0, 80) : null,
        trip: { subject: pair.subject, partyId: pair.partyId },
      });
      await this.events.emit(
        tx,
        { type: 'chat.message_sent', actorId: senderId, occurredAt: message.createdAt, payload, idempotencyKey: `chat:${thread.id}:${senderId}:${message.clientId}` },
        { name: 'chat_thread', id: thread.id },
      );
    }
    return stored;
  }

  /** Each card of the page with its thing's state now; an older card about the same thing reads `replaced`. */
  private async cardsOf(pair: TripChatPair, records: readonly ChatMessageRecord[]): Promise<Map<string, TripChatCard>> {
    const cards = records.filter((m) => m.kind === 'card' && m.refKind && m.refId);
    const out = new Map<string, TripChatCard>();
    if (cards.length === 0) return out;
    const live = await this.subjects.cards(pair, cards.map((m) => ({ kind: m.refKind as TripCardKind, refId: m.refId! })));
    // The newest card per thing and stage speaks for it; a price card is history once the price changed.
    const newest = new Map<string, number>();
    for (const m of cards) newest.set(`${m.refId}:${stageOf(m)}`, m.seq);
    for (const m of cards) {
      const now = live.get(m.refId!);
      if (!now) continue;
      const stage = stageOf(m);
      const stale = newest.get(`${m.refId}:${stage}`) !== m.seq || (stage === 'price' && m.refKind !== 'cash_reservation' && now.amountIqd !== m.refAmountIqd);
      out.set(m.id, {
        kind: m.refKind as TripCardKind,
        refId: m.refId!,
        stage,
        amountIqd: m.refAmountIqd,
        state: stale ? 'replaced' : now.state,
        note: now.note === null ? null : maskIraqiPhones(now.note).text,
        distanceKm: now.distanceKm,
        expiresAt: stale ? null : now.expiresAt,
      });
    }
    return out;
  }

  private async participants(readerId: string, pair: TripChatPair, myRole: ChatRole): Promise<ChatParticipant[]> {
    const names = await this.identity.firstNamesFor([pair.riderId, pair.driverId], readerId, 'trip_chat');
    return [
      { role: 'customer', name: names[pair.riderId] ?? null, you: myRole === 'customer' },
      { role: 'courier', name: names[pair.driverId] ?? null, you: myRole === 'courier' },
    ];
  }

  private async unreadOf(thread: ChatThreadRecord, role: ChatRole, personId: string): Promise<number> {
    const reads = await this.repo.readSeqs(thread.id);
    return this.repo.countUnread(thread.id, reads.get(readerKey(role, personId, KIND)) ?? 0, role);
  }
}

/** A card is an ask when it carries no amount (a pin or door ask); a cash ask carries its no-show amount. */
function stageOf(m: ChatMessageRecord): 'ask' | 'price' {
  if (m.refKind === 'cash_reservation') return 'ask';
  return m.refAmountIqd === null ? 'ask' : 'price';
}

function assertOpen(status: ChatThreadStatus): void {
  if (status === 'closed') throw new DriverError('chat_closed');
  if (status === 'not_open') throw new DriverError('chat_not_open');
}
