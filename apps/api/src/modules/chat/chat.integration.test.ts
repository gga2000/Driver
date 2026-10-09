import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { Actor, RoleKind } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { createInMemoryEvents } from '../events/index.js';
import { ordersHarness } from '../orders/test-harness.js';
import { DevBlobStore } from '../places/index.js';
import { PrismaShareLinksRepository } from '../tracking/index.js';
import { ProxyCallBridge } from './call-bridge.js';
import { PrismaChatRepository } from './chat.repository.js';
import { ChatService } from './chat.service.js';
import { MASKED_PHONE } from './mask.js';

/**
 * Chat and share-link tables on a real Postgres (needs DATABASE_URL with the migrations deployed):
 * per-thread seq under concurrent sends (row lock on `chat_threads`), client-id idempotency, read
 * receipts, unread counts, and the share-link rows. Orders and trips come from the in-memory harness;
 * only the chat's own tables are Postgres here. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });

describe.skipIf(!url)('chat × share links on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const repo = new PrismaChatRepository(prisma);
  const threadIds: string[] = [];
  const linkIds: string[] = [];

  afterAll(async () => {
    if (threadIds.length) {
      await prisma.prisma.chatMessage.deleteMany({ where: { threadId: { in: threadIds } } });
      await prisma.prisma.chatRead.deleteMany({ where: { threadId: { in: threadIds } } });
      await prisma.prisma.chatThread.deleteMany({ where: { id: { in: threadIds } } });
    }
    if (linkIds.length) await prisma.prisma.shareLink.deleteMany({ where: { id: { in: linkIds } } });
    await prisma.onModuleDestroy();
  });

  function service() {
    const h = ordersHarness();
    const clock = h.clock as FakeClock;
    const ev = createInMemoryEvents({ clock, uow });
    const roles: Record<string, RoleKind[]> = {};
    const blobs = new DevBlobStore(clock, { secret: 't' });
    const chat = new ChatService(
      repo,
      h.orders,
      h.trips,
      {
        hasRole: async (p, k) => (roles[p] ?? []).includes(k),
        firstNamesFor: async (ids) => Object.fromEntries(ids.map((i) => [i, null])),
        orgRoleHolders: async () => [],
      },
      { storeName: async () => 'مطعم' },
      blobs,
      new ProxyCallBridge(undefined),
      ev.events,
      uow,
      clock,
    );
    return { h, chat, blobs };
  }

  /** A fresh accepted order with a courier, and no chat rows left from an earlier run. */
  async function freshOrder(h: ReturnType<typeof service>['h']): Promise<string> {
    const placed = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
    await h.tripFor(placed.id);
    const stale = await prisma.prisma.chatThread.findMany({ where: { orderId: placed.id } });
    if (stale.length) {
      const ids = stale.map((t) => t.id);
      await prisma.prisma.chatMessage.deleteMany({ where: { threadId: { in: ids } } });
      await prisma.prisma.chatRead.deleteMany({ where: { threadId: { in: ids } } });
      await prisma.prisma.chatThread.deleteMany({ where: { id: { in: ids } } });
    }
    return placed.id;
  }

  it('assigns 1..n under concurrent sends, dedupes retries, tracks reads and unread', async () => {
    const { h, chat } = service();
    // Unique order ids per run: the harness numbers orders from 1 and the table outlives the test.
    const placed = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
    await h.tripFor(placed.id);
    const orderId = placed.id;
    // Same order id across runs would share a thread: start from a clean one.
    const stale = await prisma.prisma.chatThread.findMany({ where: { orderId } });
    if (stale.length) {
      const ids = stale.map((t) => t.id);
      await prisma.prisma.chatMessage.deleteMany({ where: { threadId: { in: ids } } });
      await prisma.prisma.chatRead.deleteMany({ where: { threadId: { in: ids } } });
      await prisma.prisma.chatThread.deleteMany({ where: { id: { in: ids } } });
    }

    const sends = Array.from({ length: 8 }, (_, i) =>
      chat.send(as(i % 2 ? 'd1' : 'c1'), { orderId, kind: 'customer_courier', clientId: `run-${randomUUID()}`, text: i === 0 ? 'رقمي 07701234567' : `رسالة ${i}` }),
    );
    const sent = await Promise.all(sends);
    expect(sent.map((m) => m.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const thread = await prisma.prisma.chatThread.findUniqueOrThrow({ where: { orderId_kind_partyId: { orderId, kind: 'customer_courier', partyId: '' } } });
    threadIds.push(thread.id);
    expect(thread.lastSeq).toBe(8);
    const stored = await prisma.prisma.chatMessage.findFirstOrThrow({ where: { threadId: thread.id, senderId: 'c1', body: { contains: 'رقمي' } } });
    expect(stored.body).toBe(`رقمي ${MASKED_PHONE}`);
    expect(stored.masked).toBe(true);

    const retry = await chat.send(as('c1'), { orderId, kind: 'customer_courier', clientId: 'fixed-client-id', text: 'مرة وحدة' });
    const again = await chat.send(as('c1'), { orderId, kind: 'customer_courier', clientId: 'fixed-client-id', text: 'مرة وحدة' });
    expect(again.id).toBe(retry.id);
    expect(await prisma.prisma.chatMessage.count({ where: { threadId: thread.id } })).toBe(9);

    const courierView = await chat.thread(as('d1'), { orderId, kind: 'customer_courier' });
    expect(courierView.unread).toBe(courierView.messages.filter((m) => !m.mine && m.seq > courierView.myReadSeq).length);
    await chat.markRead(as('d1'), { orderId, kind: 'customer_courier', seq: 9 });
    const mine = await chat.thread(as('c1'), { orderId, kind: 'customer_courier' });
    expect(mine.messages.filter((m) => m.mine).every((m) => m.read)).toBe(true);
    expect((await chat.thread(as('d1'), { orderId, kind: 'customer_courier', afterSeq: 7 })).messages.map((m) => m.seq)).toEqual([8, 9]);
  });

  it('stores a voice note’s ref and length, lists the threads holding voice files, forgets the ref once purged', async () => {
    const { h, chat, blobs } = service();
    const orderId = await freshOrder(h);
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A ', 'latin1'), Buffer.alloc(100)]);
    const ticket = await chat.voiceUpload(as('c1'), { orderId, kind: 'customer_courier', contentType: 'audio/mp4', sizeBytes: m4a.length });
    const signed = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: signed.searchParams.get('exp') ?? undefined, sig: signed.searchParams.get('sig') ?? undefined, contentType: 'audio/mp4', bytes: m4a });
    const sent = await chat.send(as('c1'), { orderId, kind: 'customer_courier', clientId: `run-${randomUUID()}`, voiceUploadId: ticket.uploadId, durationSec: 9 });
    expect(sent).toMatchObject({ kind: 'voice', durationSec: 9 });
    const thread = await prisma.prisma.chatThread.findUniqueOrThrow({ where: { orderId_kind_partyId: { orderId, kind: 'customer_courier', partyId: '' } } });
    threadIds.push(thread.id);
    expect(await prisma.prisma.chatMessage.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({ voiceRef: ticket.uploadId, durationSec: 9, photoRef: null });

    // Paging from just before this thread finds it, with its one note.
    const before = thread.id.slice(0, -1);
    const page = await repo.threadsWithVoice({ afterThreadId: before, limit: 50 });
    expect(page.find((t) => t.threadId === thread.id)).toEqual({ threadId: thread.id, orderId, kind: 'customer_courier', partyId: '', voices: [{ messageId: sent.id, voiceRef: ticket.uploadId }] });

    await repo.clearVoice(sent.id);
    expect((await repo.threadsWithVoice({ afterThreadId: before, limit: 50 })).find((t) => t.threadId === thread.id)).toBeUndefined();
    expect((await chat.thread(as('d1'), { orderId, kind: 'customer_courier' })).messages[0]).toMatchObject({ kind: 'voice', audioUrl: null, durationSec: 9 });
  });

  it('stores share links: create, view count, revoke', async () => {
    const links = new PrismaShareLinksRepository(prisma);
    const rec = await links.create({ subjectKind: 'ride', subjectId: `ord_${randomUUID()}`, createdById: 'c1', now: new Date('2026-10-04T09:00:00Z') });
    linkIds.push(rec.id);
    await links.addView(rec.id);
    await links.addView(rec.id);
    expect((await links.get(rec.id))?.views).toBe(2);
    expect(await links.forSubject('ride', rec.subjectId, 'c1')).toHaveLength(1);
    expect(await links.forSubject('ride', rec.subjectId, 'someone-else')).toHaveLength(0);
    const revoked = await links.revoke(rec.id, new Date('2026-10-04T09:05:00Z'));
    expect(revoked.revokedAt).toEqual(new Date('2026-10-04T09:05:00Z'));
    // Revoking twice keeps the first time.
    expect((await links.revoke(rec.id, new Date('2026-10-04T10:00:00Z'))).revokedAt).toEqual(new Date('2026-10-04T09:05:00Z'));
  });
});
