import { randomUUID } from 'node:crypto';
import type { ChatMessageKind, ChatRole, ChatThreadKind } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

export interface ChatThreadRecord {
  id: string;
  orderId: string;
  kind: ChatThreadKind;
  lastSeq: number;
  createdAt: Date;
}

export interface ChatMessageRecord {
  id: string;
  threadId: string;
  seq: number;
  senderId: string;
  senderRole: ChatRole;
  kind: ChatMessageKind;
  body: string | null;
  quickReplyKey: string | null;
  photoRef: string | null;
  /** A voice note's upload id; null on other kinds and once the file went with the closed chat. */
  voiceRef: string | null;
  durationSec: number | null;
  lat: number | null;
  lng: number | null;
  masked: boolean;
  clientId: string;
  createdAt: Date;
}

/** A thread that still holds voice-note files (the voice retention reads these). */
export interface ChatVoiceThread {
  threadId: string;
  orderId: string;
  kind: ChatThreadKind;
  /** The messages whose file is still stored. */
  voices: Array<{ messageId: string; voiceRef: string }>;
}

export type NewChatMessage = Omit<ChatMessageRecord, 'id' | 'seq' | 'threadId'>;

/**
 * The chat module's own tables (`chat_threads`, `chat_messages`, `chat_reads`). Nobody outside the
 * module reads them. `append` is where ordering and retries are decided: it takes the next seq
 * under the thread's row lock and returns the first message for a repeated client id.
 */
export interface ChatRepository {
  findThread(orderId: string, kind: ChatThreadKind, tx?: Tx): Promise<ChatThreadRecord | null>;
  threadsOfOrder(orderId: string, tx?: Tx): Promise<ChatThreadRecord[]>;
  ensureThread(orderId: string, kind: ChatThreadKind, now: Date, tx: Tx): Promise<ChatThreadRecord>;
  append(threadId: string, message: NewChatMessage, tx: Tx): Promise<{ message: ChatMessageRecord; inserted: boolean }>;
  /** Oldest first; with `afterSeq`, only newer ones; the last `limit` of them. */
  messages(threadId: string, opts: { afterSeq?: number; limit: number }, tx?: Tx): Promise<ChatMessageRecord[]>;
  /** Messages after `afterSeq` not written by `excludeRole` (the unread count of that party). */
  countUnread(threadId: string, afterSeq: number, excludeRole: ChatRole, tx?: Tx): Promise<number>;
  lastMessageAt(threadId: string, tx?: Tx): Promise<Date | null>;
  readSeqs(threadId: string, tx?: Tx): Promise<Map<string, number>>;
  /** Raises the reader's read seq (never lowers it); returns the stored value. */
  markRead(threadId: string, readerKey: string, seq: number, tx: Tx): Promise<number>;
  /** Threads with stored voice files, by thread id after `afterThreadId`, at most `limit` threads. */
  threadsWithVoice(opts: { afterThreadId?: string; limit: number }): Promise<ChatVoiceThread[]>;
  /** The voice file of this message is gone: forget its ref (the bubble then says so). */
  clearVoice(messageId: string): Promise<void>;
}

export const CHAT_REPOSITORY = Symbol('CHAT_REPOSITORY');

// ───────────────────────── in memory ─────────────────────────

export class InMemoryChatRepository implements ChatRepository {
  private readonly threads = new Map<string, ChatThreadRecord>();
  private readonly msgs = new Map<string, ChatMessageRecord[]>();
  private readonly reads = new Map<string, Map<string, number>>();

  async findThread(orderId: string, kind: ChatThreadKind): Promise<ChatThreadRecord | null> {
    const t = [...this.threads.values()].find((x) => x.orderId === orderId && x.kind === kind);
    return t ? { ...t } : null;
  }

  async threadsOfOrder(orderId: string): Promise<ChatThreadRecord[]> {
    return [...this.threads.values()].filter((x) => x.orderId === orderId).map((x) => ({ ...x }));
  }

  async ensureThread(orderId: string, kind: ChatThreadKind, now: Date): Promise<ChatThreadRecord> {
    const existing = await this.findThread(orderId, kind);
    if (existing) return existing;
    const t: ChatThreadRecord = { id: `cht_${randomUUID().replace(/-/g, '').slice(0, 20)}`, orderId, kind, lastSeq: 0, createdAt: now };
    this.threads.set(t.id, t);
    this.msgs.set(t.id, []);
    return { ...t };
  }

  async append(threadId: string, message: NewChatMessage): Promise<{ message: ChatMessageRecord; inserted: boolean }> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`chat thread ${threadId} missing`);
    const list = this.msgs.get(threadId)!;
    const dup = list.find((m) => m.senderId === message.senderId && m.clientId === message.clientId);
    if (dup) return { message: { ...dup }, inserted: false };
    thread.lastSeq += 1;
    const rec: ChatMessageRecord = { ...message, id: `chm_${randomUUID().replace(/-/g, '').slice(0, 20)}`, threadId, seq: thread.lastSeq };
    list.push(rec);
    return { message: { ...rec }, inserted: true };
  }

  async messages(threadId: string, opts: { afterSeq?: number; limit: number }): Promise<ChatMessageRecord[]> {
    const list = (this.msgs.get(threadId) ?? []).filter((m) => m.seq > (opts.afterSeq ?? 0));
    return list.slice(-opts.limit).map((m) => ({ ...m }));
  }

  async countUnread(threadId: string, afterSeq: number, excludeRole: ChatRole): Promise<number> {
    return (this.msgs.get(threadId) ?? []).filter((m) => m.seq > afterSeq && m.senderRole !== excludeRole).length;
  }

  async lastMessageAt(threadId: string): Promise<Date | null> {
    const list = this.msgs.get(threadId) ?? [];
    return list.length ? list[list.length - 1]!.createdAt : null;
  }

  async readSeqs(threadId: string): Promise<Map<string, number>> {
    return new Map(this.reads.get(threadId) ?? []);
  }

  async markRead(threadId: string, readerKey: string, seq: number): Promise<number> {
    const m = this.reads.get(threadId) ?? new Map<string, number>();
    const next = Math.max(m.get(readerKey) ?? 0, seq);
    m.set(readerKey, next);
    this.reads.set(threadId, m);
    return next;
  }

  async threadsWithVoice(opts: { afterThreadId?: string; limit: number }): Promise<ChatVoiceThread[]> {
    const out: ChatVoiceThread[] = [];
    for (const t of [...this.threads.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (opts.afterThreadId !== undefined && t.id <= opts.afterThreadId) continue;
      const voices = (this.msgs.get(t.id) ?? []).filter((m) => m.voiceRef !== null).map((m) => ({ messageId: m.id, voiceRef: m.voiceRef! }));
      if (voices.length) out.push({ threadId: t.id, orderId: t.orderId, kind: t.kind, voices });
      if (out.length >= opts.limit) break;
    }
    return out;
  }

  async clearVoice(messageId: string): Promise<void> {
    for (const list of this.msgs.values()) {
      const m = list.find((x) => x.id === messageId);
      if (m) m.voiceRef = null;
    }
  }
}

// ───────────────────────── Prisma ─────────────────────────

type ThreadRow = { id: string; orderId: string; kind: string; lastSeq: number; createdAt: Date };
type MessageRow = Omit<ChatMessageRecord, 'senderRole' | 'kind'> & { senderRole: string; kind: string };

const threadOf = (r: ThreadRow): ChatThreadRecord => ({ id: r.id, orderId: r.orderId, kind: r.kind as ChatThreadKind, lastSeq: r.lastSeq, createdAt: r.createdAt });
const messageOf = (r: MessageRow): ChatMessageRecord => ({
  id: r.id,
  threadId: r.threadId,
  seq: r.seq,
  senderId: r.senderId,
  senderRole: r.senderRole as ChatRole,
  kind: r.kind as ChatMessageKind,
  body: r.body,
  quickReplyKey: r.quickReplyKey,
  photoRef: r.photoRef,
  voiceRef: r.voiceRef,
  durationSec: r.durationSec,
  lat: r.lat,
  lng: r.lng,
  masked: r.masked,
  clientId: r.clientId,
  createdAt: r.createdAt,
});

const MESSAGE_SELECT = {
  id: true,
  threadId: true,
  seq: true,
  senderId: true,
  senderRole: true,
  kind: true,
  body: true,
  quickReplyKey: true,
  photoRef: true,
  voiceRef: true,
  durationSec: true,
  lat: true,
  lng: true,
  masked: true,
  clientId: true,
  createdAt: true,
} as const;

/** Postgres: the next seq is taken with `UPDATE chat_threads SET last_seq = last_seq + 1` (row lock). */
export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async findThread(orderId: string, kind: ChatThreadKind, tx?: Tx): Promise<ChatThreadRecord | null> {
    const r = await this.db(tx).chatThread.findUnique({ where: { orderId_kind: { orderId, kind } } });
    return r ? threadOf(r) : null;
  }

  async threadsOfOrder(orderId: string, tx?: Tx): Promise<ChatThreadRecord[]> {
    return (await this.db(tx).chatThread.findMany({ where: { orderId } })).map(threadOf);
  }

  async ensureThread(orderId: string, kind: ChatThreadKind, now: Date, tx: Tx): Promise<ChatThreadRecord> {
    const db = this.db(tx);
    // Two first messages at once must not race on the unique (order, kind): insert-or-nothing in SQL.
    const id = `cht_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await db.$executeRaw`INSERT INTO "public"."chat_threads" ("id", "order_id", "kind", "last_seq", "created_at", "updated_at") VALUES (${id}, ${orderId}, ${kind}, 0, ${now}, ${now}) ON CONFLICT ("order_id", "kind") DO NOTHING`;
    return threadOf(await db.chatThread.findUniqueOrThrow({ where: { orderId_kind: { orderId, kind } } }));
  }

  async append(threadId: string, message: NewChatMessage, tx: Tx): Promise<{ message: ChatMessageRecord; inserted: boolean }> {
    const db = this.db(tx);
    const dup = await db.chatMessage.findUnique({ where: { threadId_senderId_clientId: { threadId, senderId: message.senderId, clientId: message.clientId } }, select: MESSAGE_SELECT });
    if (dup) return { message: messageOf(dup), inserted: false };
    const thread = await db.chatThread.update({ where: { id: threadId }, data: { lastSeq: { increment: 1 } } });
    const row = await db.chatMessage.create({ data: { ...message, threadId, seq: thread.lastSeq }, select: MESSAGE_SELECT });
    return { message: messageOf(row), inserted: true };
  }

  async messages(threadId: string, opts: { afterSeq?: number; limit: number }, tx?: Tx): Promise<ChatMessageRecord[]> {
    const rows = await this.db(tx).chatMessage.findMany({
      where: { threadId, seq: { gt: opts.afterSeq ?? 0 } },
      orderBy: { seq: 'desc' },
      take: opts.limit,
      select: MESSAGE_SELECT,
    });
    return rows.reverse().map(messageOf);
  }

  async countUnread(threadId: string, afterSeq: number, excludeRole: ChatRole, tx?: Tx): Promise<number> {
    return this.db(tx).chatMessage.count({ where: { threadId, seq: { gt: afterSeq }, senderRole: { not: excludeRole } } });
  }

  async lastMessageAt(threadId: string, tx?: Tx): Promise<Date | null> {
    const r = await this.db(tx).chatMessage.findFirst({ where: { threadId }, orderBy: { seq: 'desc' }, select: { createdAt: true } });
    return r?.createdAt ?? null;
  }

  async readSeqs(threadId: string, tx?: Tx): Promise<Map<string, number>> {
    const rows = await this.db(tx).chatRead.findMany({ where: { threadId } });
    return new Map(rows.map((r) => [r.readerKey, r.readSeq]));
  }

  async markRead(threadId: string, readerKey: string, seq: number, tx: Tx): Promise<number> {
    const db = this.db(tx);
    const cur = await db.chatRead.findUnique({ where: { threadId_readerKey: { threadId, readerKey } } });
    if (cur && cur.readSeq >= seq) return cur.readSeq;
    const r = await db.chatRead.upsert({ where: { threadId_readerKey: { threadId, readerKey } }, create: { threadId, readerKey, readSeq: seq }, update: { readSeq: seq } });
    return r.readSeq;
  }

  async threadsWithVoice(opts: { afterThreadId?: string; limit: number }): Promise<ChatVoiceThread[]> {
    const db = this.db();
    const ids = await db.chatMessage.findMany({
      where: { voiceRef: { not: null }, ...(opts.afterThreadId !== undefined ? { threadId: { gt: opts.afterThreadId } } : {}) },
      distinct: ['threadId'],
      orderBy: { threadId: 'asc' },
      take: opts.limit,
      select: { threadId: true },
    });
    if (ids.length === 0) return [];
    const threadIds = ids.map((r) => r.threadId);
    const [threads, voices] = await Promise.all([
      db.chatThread.findMany({ where: { id: { in: threadIds } }, select: { id: true, orderId: true, kind: true } }),
      db.chatMessage.findMany({ where: { threadId: { in: threadIds }, voiceRef: { not: null } }, select: { id: true, threadId: true, voiceRef: true } }),
    ]);
    const byId = new Map(threads.map((t) => [t.id, t]));
    return threadIds.flatMap((id) => {
      const t = byId.get(id);
      if (!t) return [];
      return [{ threadId: id, orderId: t.orderId, kind: t.kind as ChatThreadKind, voices: voices.filter((v) => v.threadId === id).map((v) => ({ messageId: v.id, voiceRef: v.voiceRef! })) }];
    });
  }

  async clearVoice(messageId: string): Promise<void> {
    await this.db().chatMessage.updateMany({ where: { id: messageId }, data: { voiceRef: null } });
  }
}
