import { describe, expect, it } from 'vitest';
import { DriverError, type Actor, type RoleKind } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { NotifyService, RecordingTransport } from '../notify/index.js';
import { HOME, KITCHEN, ordersHarness } from '../orders/test-harness.js';
import { DevBlobStore } from '../places/index.js';
import { DevCallBridge, ProxyCallBridge, type CallBridgePort } from './call-bridge.js';
import { registerChatNotifications } from './chat.notify.js';
import { InMemoryChatRepository } from './chat.repository.js';
import { CHAT_RULES, ChatService } from './chat.service.js';
import { MASKED_PHONE } from './mask.js';
import { InMemoryWindowCounter, type WindowCounter } from '../../shared/window-counter.js';

const MIN = 60_000;
const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/** Roles: m-staff works at rest_1, m-owner owns it, other-staff works elsewhere, ops is support. */
const ROLES: Record<string, Array<{ kind: RoleKind; orgId?: string }>> = {
  'm-staff': [{ kind: 'merchant_staff', orgId: 'rest_1' }],
  'm-owner': [{ kind: 'merchant_owner', orgId: 'rest_1' }],
  'other-staff': [{ kind: 'merchant_staff', orgId: 'rest_2' }],
  ops: [{ kind: 'support' }],
};
const NAMES: Record<string, string> = { c1: 'علي', d1: 'حيدر', d2: 'كرار' };
const PHONES: Record<string, string> = { c1: '+9647701110009', d1: '+9647701110001', 'm-owner': '+9647701234567', mum: '+9647705554433' };

function setup(opts: { bridge?: CallBridgePort; counter?: WindowCounter } = {}) {
  const h = ordersHarness();
  const ev = createInMemoryEvents({ clock: h.clock, uow: h.uow });
  const transport = new RecordingTransport();
  const notify = new NotifyService(transport);
  registerChatNotifications(ev.events, notify);
  const vaultReads: Array<{ personId: string; accessorId: string; purpose: string }> = [];
  const identity = {
    hasRole: async (personId: string, kind: RoleKind, orgId?: string) => (ROLES[personId] ?? []).some((r) => r.kind === kind && (orgId === undefined || r.orgId === orgId)),
    firstNamesFor: async (ids: readonly string[], accessorId: string, purpose: string) => {
      for (const id of ids) if (id !== accessorId) vaultReads.push({ personId: id, accessorId, purpose });
      return Object.fromEntries(ids.map((id) => [id, NAMES[id] ?? null]));
    },
    orgRoleHolders: async (orgId: string, kinds: readonly RoleKind[]) =>
      Object.entries(ROLES).flatMap(([personId, rs]) => rs.filter((r) => r.orgId === orgId && kinds.includes(r.kind)).map((r) => ({ personId, kind: r.kind, frozen: false }))),
    phoneForCall: async (personId: string, accessorId: string, purpose: string) => {
      vaultReads.push({ personId, accessorId, purpose });
      return PHONES[personId] ?? null;
    },
  };
  const blobs = new DevBlobStore(h.clock, { secret: 'test' });
  const repo = new InMemoryChatRepository();
  /** One API instance; `counter` is what the instances share (Redis in production). */
  const instance = (counter?: WindowCounter) =>
    new ChatService(
      repo,
      h.orders,
      h.trips,
      identity,
      { storeName: async (orgId) => (orgId === 'rest_1' ? 'مطعم التجربة' : null) },
      blobs,
      opts.bridge ?? new DevCallBridge(identity, () => 'test'),
      ev.events,
      h.uow,
      h.clock,
      ...(counter ? [counter] : []),
    );
  const chat = instance(opts.counter);
  return { h, ev, chat, transport, vaultReads, blobs, repo, instance };
}

type H = ReturnType<typeof setup>['h'];

async function acceptedOrder(h: H) {
  const placed = await h.orders.place('c1', h.foodInput());
  await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
  return placed;
}

let n = 0;
const cid = () => `client-${++n}-${Math.random().toString(36).slice(2, 8)}`;

describe('ChatService — opening, parties, closing', () => {
  it('opens the courier threads at the courier accept, the kitchen thread at the kitchen accept', async () => {
    const { h, chat } = setup();
    const placed = await h.orders.place('c1', h.foodInput());
    // Placed: nothing is open yet, but the customer sees the threads that will open.
    const before = await chat.threads(as('c1'), { orderId: placed.id });
    expect(before.map((t) => [t.kind, t.status])).toEqual([
      ['customer_courier', 'not_open'],
      ['customer_merchant', 'not_open'],
      // «كلّم الدعم» works from placement.
      ['customer_support', 'open'],
    ]);
    expect(await code(chat.send(as('c1'), { orderId: placed.id, kind: 'customer_merchant', clientId: cid(), text: 'هلا' }))).toBe('chat_not_open');

    await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
    expect((await chat.threads(as('c1'), { orderId: placed.id })).find((t) => t.kind === 'customer_merchant')?.status).toBe('open');
    expect((await chat.thread(as('c1'), { orderId: placed.id, kind: 'customer_courier' })).status).toBe('not_open');

    await h.tripFor(placed.id);
    const after = await chat.threads(as('c1'), { orderId: placed.id });
    expect(after.find((t) => t.kind === 'customer_courier')).toMatchObject({ status: 'open', myRole: 'customer', counterpart: 'courier', canCall: true });
    // The courier sees his two threads; the kitchen sees its two.
    expect((await chat.threads(as('d1'), { orderId: placed.id })).map((t) => [t.kind, t.myRole])).toEqual([
      ['customer_courier', 'courier'],
      ['merchant_courier', 'courier'],
    ]);
    expect((await chat.threads(as('m-staff'), { orderId: placed.id })).map((t) => [t.kind, t.myRole])).toEqual([
      ['merchant_courier', 'merchant'],
      ['customer_merchant', 'merchant'],
    ]);
  });

  it('refuses everyone who is not a party, and lets support read and join', async () => {
    const { h, chat } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    expect(await code(chat.thread(as('stranger'), { orderId: o.id, kind: 'customer_courier' }))).toBe('chat_not_party');
    expect(await code(chat.threads(as('stranger'), { orderId: o.id }))).toBe('chat_not_party');
    expect(await code(chat.thread(as('other-staff'), { orderId: o.id, kind: 'merchant_courier' }))).toBe('chat_not_party');
    // The kitchen is not in the customer ↔ courier thread, the customer not in the kitchen ↔ courier one.
    expect(await code(chat.thread(as('m-staff'), { orderId: o.id, kind: 'customer_courier' }))).toBe('chat_not_party');
    expect(await code(chat.send(as('c1'), { orderId: o.id, kind: 'merchant_courier', clientId: cid(), text: 'x' }))).toBe('chat_not_party');

    const view = await chat.thread(as('ops'), { orderId: o.id, kind: 'customer_courier' });
    expect(view.myRole).toBe('support');
    expect(view.quickReplies).toEqual([]);
    expect(view.canCall).toBe(false);
    const m = await chat.send(as('ops'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'هلا، الدعم وياكم' });
    expect(m.senderRole).toBe('support');
    expect(await code(chat.requestCall(as('ops'), { orderId: o.id, kind: 'customer_courier' }))).toBe('chat_not_party');
  });

  it('moves the courier side to the new courier after a reassign', async () => {
    const { h, chat } = setup();
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    await chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'courier_on_the_way' });
    await h.trips.detachOrder(trip.id, o.id, 'dispatcher', 'reassigned');
    expect((await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' })).status).toBe('not_open');
    await h.tripFor(o.id, { driverId: 'd2' });
    expect(await code(chat.thread(as('d1'), { orderId: o.id, kind: 'customer_courier' }))).toBe('chat_not_party');
    const v = await chat.thread(as('d2'), { orderId: o.id, kind: 'customer_courier' });
    // The new courier reads the history (the customer may have said where the gate is).
    expect(v.messages.map((m) => m.quickReplyKey)).toEqual(['courier_on_the_way']);
    expect(v.participants.find((p) => p.role === 'courier')).toMatchObject({ name: 'كرار', you: true });
  });

  it('closes 30 minutes after delivery: read-only from then', async () => {
    const { h, chat } = setup();
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    await h.pickup(trip.id);
    await h.dropoff(trip.id, { cashCollectedIqd: 16500 });
    const delivered = await h.orders.get(o.id);
    expect(delivered.deliveredAt).not.toBeNull();
    h.clock.advance(29 * MIN);
    const open = await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' });
    expect(open.status).toBe('open');
    expect(open.closesAt).toEqual(new Date(delivered.deliveredAt!.getTime() + 30 * MIN));
    await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'شكراً' });
    h.clock.advance(2 * MIN);
    const closed = await chat.thread(as('d1'), { orderId: o.id, kind: 'customer_courier' });
    expect(closed.status).toBe('closed');
    expect(closed.messages).toHaveLength(1);
    expect(closed.quickReplies).toEqual([]);
    expect(closed.canCall).toBe(false);
    expect(await code(chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'عفواً' }))).toBe('chat_closed');
    expect(await code(chat.requestCall(as('d1'), { orderId: o.id, kind: 'customer_courier' }))).toBe('chat_closed');
    // Reading (and marking read) still works.
    expect((await chat.markRead(as('d1'), { orderId: o.id, kind: 'customer_courier', seq: 1 })).unread).toBe(0);
  });
});

describe('ChatService — messages', () => {
  it('masks phone numbers server-side, renders quick replies, and is idempotent per client id', async () => {
    const { h, chat } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    const text = await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: 'abc-123', text: '  اتصل بيه على 0770 123 4567 الباب الأزرق ' });
    expect(text).toMatchObject({ kind: 'text', text: `اتصل بيه على ${MASKED_PHONE} الباب الأزرق`, masked: true, mine: true, seq: 1 });
    const again = await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: 'abc-123', text: 'شي ثاني' });
    expect(again.id).toBe(text.id);

    const qr = await chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'courier_cant_find' });
    expect(qr).toMatchObject({ kind: 'quick_reply', text: 'ما دا ألگى البيت، دزلي لوكيشن', seq: 2 });
    // A customer reply is not the courier's to send, nor a ride reply on a delivery.
    expect(await code(chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'customer_other_gate' }))).toBe('chat_quick_reply_invalid');
    expect(await code(chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'courier_outside' }))).toBe('chat_quick_reply_invalid');

    const pin = await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), location: { lat: 32.91, lng: 45.07 } });
    expect(pin).toMatchObject({ kind: 'location', location: { lat: 32.91, lng: 45.07 }, text: null });

    const v = await chat.thread(as('d1'), { orderId: o.id, kind: 'customer_courier' });
    expect(v.messages.map((m) => [m.seq, m.senderRole, m.mine])).toEqual([
      [1, 'customer', false],
      [2, 'courier', true],
      [3, 'customer', false],
    ]);
    expect(v.quickReplies).toEqual(['courier_at_door', 'courier_cant_find', 'courier_on_the_way', 'courier_two_min']);
    expect(v.participants).toEqual([
      { role: 'customer', name: 'علي', you: false },
      { role: 'courier', name: 'حيدر', you: true },
    ]);
    // Incremental poll.
    expect((await chat.thread(as('d1'), { orderId: o.id, kind: 'customer_courier', afterSeq: 2 })).messages.map((m) => m.seq)).toEqual([3]);
  });

  it('counts unread per party and shows read receipts once the other side reads', async () => {
    const { h, chat } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'customer_other_gate' });
    await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'الباب الأخضر' });
    expect((await chat.threads(as('d1'), { orderId: o.id })).find((t) => t.kind === 'customer_courier')?.unread).toBe(2);
    expect((await chat.threads(as('c1'), { orderId: o.id })).find((t) => t.kind === 'customer_courier')?.unread).toBe(0);
    let mine = await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' });
    expect(mine.messages.map((m) => m.read)).toEqual([false, false]);

    expect(await chat.markRead(as('d1'), { orderId: o.id, kind: 'customer_courier', seq: 1 })).toEqual({ myReadSeq: 1, unread: 1 });
    mine = await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' });
    expect(mine.messages.map((m) => m.read)).toEqual([true, false]);
    // Never lowered, clamped to the thread.
    expect(await chat.markRead(as('d1'), { orderId: o.id, kind: 'customer_courier', seq: 99 })).toEqual({ myReadSeq: 2, unread: 0 });
    expect(await chat.markRead(as('d1'), { orderId: o.id, kind: 'customer_courier', seq: 0 })).toEqual({ myReadSeq: 2, unread: 0 });
  });

  it('kitchen staff share one read state; the kitchen shows by its store name', async () => {
    const { h, chat } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    await chat.send(as('d1'), { orderId: o.id, kind: 'merchant_courier', clientId: cid(), quickReplyKey: 'courier_at_restaurant' });
    expect((await chat.thread(as('m-owner'), { orderId: o.id, kind: 'merchant_courier' })).unread).toBe(1);
    await chat.markRead(as('m-staff'), { orderId: o.id, kind: 'merchant_courier', seq: 1 });
    expect((await chat.thread(as('m-owner'), { orderId: o.id, kind: 'merchant_courier' })).unread).toBe(0);
    const v = await chat.thread(as('d1'), { orderId: o.id, kind: 'merchant_courier' });
    expect(v.participants.find((p) => p.role === 'merchant')).toEqual({ role: 'merchant', name: 'مطعم التجربة', you: false });
    expect(v.messages[0]!.read).toBe(true);
    const reply = await chat.send(as('m-owner'), { orderId: o.id, kind: 'merchant_courier', clientId: cid(), quickReplyKey: 'merchant_delay_5' });
    expect(reply.text).toBe('الطلب يتأخر 5 دقايق');
  });

  it('accepts only the sender’s own finished photo upload', async () => {
    const { h, chat, blobs } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    const ticket = await blobs.createUpload({ ownerId: 'c1', contentType: 'image/png', sizeBytes: 100 });
    expect(await code(chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), photoUploadId: ticket.uploadId }))).toBe('upload_invalid');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    const url = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/png', bytes: png });
    expect(await code(chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), photoUploadId: ticket.uploadId }))).toBe('upload_invalid');
    const m = await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), photoUploadId: ticket.uploadId });
    expect(m.kind).toBe('photo');
    expect(m.photoUrl).toContain(ticket.uploadId);
  });

  it('rate-limits sends per person', async () => {
    const { h, chat } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    for (let i = 0; i < CHAT_RULES.sendsPerMinute; i++) await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: `رسالة ${i}` });
    const err = await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'زيادة' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriverError);
    expect((err as DriverError).code).toBe('rate_limited');
    expect((err as DriverError).envelope.retryAfterSec).toBeGreaterThan(0);
    h.clock.advance(61_000);
    await expect(chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'هسة' })).resolves.toMatchObject({ kind: 'text' });
  });

  it('the send and call limits hold across API instances (shared counter; review 2026-10-04 #22)', async () => {
    const { h, instance } = setup();
    const shared = new InMemoryWindowCounter(h.clock);
    const [a, b] = [instance(shared), instance(shared)];
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    for (let i = 0; i < CHAT_RULES.sendsPerMinute; i++) await (i % 2 ? a : b).send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: `رسالة ${i}` });
    expect(await code(a.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'زيادة' }))).toBe('rate_limited');
    expect(await code(b.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'زيادة' }))).toBe('rate_limited');
    for (let i = 0; i < CHAT_RULES.callsPer10Min; i++) await (i % 2 ? a : b).requestCall(as('c1'), { orderId: o.id, kind: 'customer_courier' });
    expect(await code(a.requestCall(as('c1'), { orderId: o.id, kind: 'customer_courier' }))).toBe('rate_limited');
  });

  it('emits chat.message_sent in the outbox and pushes "رسالة جديدة من الدليفري" to the other party', async () => {
    const { h, ev, chat, transport } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    await chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), quickReplyKey: 'courier_at_door' });
    await chat.send(as('d1'), { orderId: o.id, kind: 'merchant_courier', clientId: cid(), text: 'وصلت' });
    await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), location: { lat: 32.9, lng: 45.1 } });
    const stored = (await ev.repo.find({})).filter((e) => e.type === 'chat.message_sent');
    expect(stored).toHaveLength(3);
    expect(stored[0]!.payload).toMatchObject({ senderRole: 'courier', recipientIds: ['c1'], preview: 'وصلت يم الباب' });
    expect(transport.sent.map((s) => [s.to, s.title_ar, s.body_ar])).toEqual([
      ['c1', 'رسالة جديدة من الدليفري', 'وصلت يم الباب'],
      ['m-staff', 'رسالة جديدة من الدليفري', 'وصلت'],
      ['m-owner', 'رسالة جديدة من الدليفري', 'وصلت'],
      ['d1', 'رسالة جديدة من الزبون', 'دزلك لوكيشن'],
    ]);
    expect(transport.sent[0]!.data).toMatchObject({ orderId: o.id, kind: 'customer_courier' });
    // The payload carries no names or numbers.
    expect(JSON.stringify(stored.map((e) => e.payload))).not.toMatch(/علي|حيدر|\+964/);
  });

  it('logs first-name reads once per order and reader, not once per poll', async () => {
    const { h, chat, vaultReads } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    for (let i = 0; i < 5; i++) await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' });
    expect(vaultReads.filter((r) => r.purpose === 'chat_thread' && r.accessorId === 'c1')).toEqual([{ personId: 'd1', accessorId: 'c1', purpose: 'chat_thread' }]);
  });
});

describe('ChatService — masked calls', () => {
  it('development: the other party’s number, read through a logged vault access, and every request logged', async () => {
    const { h, ev, chat, vaultReads } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    const s = await chat.requestCall(as('c1'), { orderId: o.id, kind: 'customer_courier' });
    expect(s).toMatchObject({ mode: 'dev_direct', dial: PHONES['d1'], counterpart: 'courier' });
    expect(vaultReads).toContainEqual({ personId: 'd1', accessorId: 'c1', purpose: 'masked_call_dev' });
    const k = await chat.requestCall(as('d1'), { orderId: o.id, kind: 'merchant_courier' });
    expect(k.dial).toBe(PHONES['m-owner']);
    expect(await code(chat.requestCall(as('stranger'), { orderId: o.id, kind: 'customer_courier' }))).toBe('chat_not_party');
    const logged = (await ev.repo.find({})).filter((e) => e.type === 'chat.call_requested');
    expect(logged.map((e) => e.payload['outcome'])).toEqual(['opened', 'opened']);
    for (let i = 0; i < CHAT_RULES.callsPer10Min - 1; i++) await chat.requestCall(as('c1'), { orderId: o.id, kind: 'customer_courier' });
    expect(await code(chat.requestCall(as('c1'), { orderId: o.id, kind: 'customer_courier' }))).toBe('rate_limited');
    expect(((await ev.repo.find({})).filter((e) => e.type === 'chat.call_requested')).at(-1)!.payload['outcome']).toBe('refused:rate_limited');
  });

  it('production: never a raw number — the platform number, or call_unavailable without one', async () => {
    const none = setup({ bridge: new ProxyCallBridge(undefined) });
    const o1 = await acceptedOrder(none.h);
    await none.h.tripFor(o1.id);
    expect(await code(none.chat.requestCall(as('c1'), { orderId: o1.id, kind: 'customer_courier' }))).toBe('call_unavailable');
    expect(new DriverError('call_unavailable').envelope.message_ar).toBe('الاتصال من التطبيق ما يشتغل هسة. دز رسالة بالمحادثة');
    expect(none.vaultReads.filter((r) => r.purpose === 'masked_call_dev')).toEqual([]);

    const proxy = setup({ bridge: new ProxyCallBridge('+9647800000000') });
    const o2 = await acceptedOrder(proxy.h);
    await proxy.h.tripFor(o2.id);
    expect(await proxy.chat.requestCall(as('c1'), { orderId: o2.id, kind: 'customer_courier' })).toMatchObject({ mode: 'proxy', dial: '+9647800000000' });
    expect(proxy.vaultReads.filter((r) => r.purpose === 'masked_call_dev')).toEqual([]);
  });

  it('a ride booked for someone else (c9): «اتصل بالراكب» rings the rider, whose messages reach the rider and the booker', async () => {
    const { h, chat, vaultReads, ev } = setup();
    h.people.set('07705554433', 'mum');
    const o = await h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', fareIqd: 3000, pickup: { zoneKey: 'centre', pin: KITCHEN }, dropoff: { zoneKey: 'street_30', pin: HOME }, rider: { from: 'typed', name: 'ماما', phone: '07705554433' } });
    await h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    const s = await chat.requestCall(as('d1'), { orderId: o.id, kind: 'customer_courier' });
    expect(s).toMatchObject({ mode: 'dev_direct', dial: PHONES['mum'], counterpart: 'customer' });
    expect(vaultReads).toContainEqual({ personId: 'mum', accessorId: 'd1', purpose: 'masked_call_dev' });
    // The rider is a party: she calls the driver herself; the driver sees the name the booker gave.
    expect((await chat.requestCall(as('mum'), { orderId: o.id, kind: 'customer_courier' })).dial).toBe(PHONES['d1']);
    const thread = await chat.thread(as('d1'), { orderId: o.id, kind: 'customer_courier' });
    expect(thread.participants.find((p) => p.role === 'customer')?.name).toBe('ماما');
    await chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'وصلت' });
    const sent = (await ev.repo.find({})).filter((e) => e.type === 'chat.message_sent').at(-1)!;
    expect(sent.payload['recipientIds']).toEqual(['c1', 'mum']);
  });

  it('the dev bridge refuses outside development even if it were bound', async () => {
    const bridge = new DevCallBridge({ phoneForCall: async () => '+9647701110001' }, () => 'production');
    await expect(bridge.open({ callId: 'c', orderId: 'o', callerId: 'a', calleeId: 'b' }, new Date())).rejects.toMatchObject({ code: 'call_unavailable' });
    const staging = new DevCallBridge({ phoneForCall: async () => '+9647701110001' }, () => 'staging');
    await expect(staging.open({ callId: 'c', orderId: 'o', callerId: 'a', calleeId: 'b' }, new Date())).rejects.toMatchObject({ code: 'call_unavailable' });
  });
});

describe('ChatService — voice notes (ride ideas n7/n8)', () => {
  /** An m4a's first box: size, `ftyp`, brand `M4A `. */
  const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A ', 'latin1'), Buffer.alloc(200)]);

  /** Ticket through `chat.voiceUpload`, then the PUT the app makes. */
  async function voice(chat: ChatService, blobs: DevBlobStore, personId: string, orderId: string, kind: 'customer_courier' | 'customer_support' = 'customer_courier') {
    const ticket = await chat.voiceUpload(as(personId), { orderId, kind, contentType: 'audio/mp4', sizeBytes: M4A.length });
    const url = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'audio/mp4', bytes: M4A });
    return ticket.uploadId;
  }

  it('sends a voice note with its length; the reader gets a signed audio URL and the push says so', async () => {
    const { h, chat, blobs, transport } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    const id = await voice(chat, blobs, 'c1', o.id);
    const m = await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), voiceUploadId: id, durationSec: 7 });
    expect(m).toMatchObject({ kind: 'voice', text: null, photoUrl: null, durationSec: 7 });
    expect(m.audioUrl).toContain(`/files/${id}?`);
    const seen = (await chat.thread(as('d1'), { orderId: o.id, kind: 'customer_courier' })).messages[0]!;
    expect(seen).toMatchObject({ kind: 'voice', durationSec: 7, mine: false });
    expect(transport.sent.at(-1)).toMatchObject({ to: 'd1', title_ar: 'رسالة جديدة من الزبون', body_ar: 'دزلك رسالة صوتية' });
    // Other kinds carry no voice fields.
    const text = await chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'سمعتك' });
    expect(text).toMatchObject({ audioUrl: null, durationSec: null });
  });

  it('gives an upload ticket only to someone who may write in the thread now', async () => {
    const { h, chat } = setup();
    const placed = await h.orders.place('c1', h.foodInput());
    const input = { orderId: placed.id, kind: 'customer_courier' as const, contentType: 'audio/webm' as const, sizeBytes: 5000 };
    expect(await code(chat.voiceUpload(as('c1'), input))).toBe('chat_not_open');
    expect(await code(chat.voiceUpload(as('stranger'), input))).toBe('chat_not_party');
    // «كلّم الدعم» is open from placement: a voice note to the desk works right away.
    await expect(chat.voiceUpload(as('c1'), { ...input, kind: 'customer_support' })).resolves.toMatchObject({ method: 'PUT', maxBytes: 5000 });
    // The kitchen's threads stay text and photos.
    await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
    expect(await code(chat.voiceUpload(as('c1'), { ...input, kind: 'customer_merchant' }))).toBe('chat_voice_unavailable');
  });

  it('accepts only the sender’s own finished voice upload, never a photo as a voice note or the other way round', async () => {
    const { h, chat, blobs } = setup();
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    const pending = await chat.voiceUpload(as('c1'), { orderId: o.id, kind: 'customer_courier', contentType: 'audio/mp4', sizeBytes: M4A.length });
    expect(await code(chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), voiceUploadId: pending.uploadId, durationSec: 3 }))).toBe('upload_invalid');
    const id = await voice(chat, blobs, 'c1', o.id);
    expect(await code(chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), voiceUploadId: id, durationSec: 3 }))).toBe('upload_invalid');
    expect(await code(chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), photoUploadId: id }))).toBe('upload_invalid');
    const photo = await blobs.createUpload({ ownerId: 'c1', contentType: 'image/png', sizeBytes: 48 });
    const url = new URL(photo.uploadUrl, 'http://x');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    await blobs.receive({ id: photo.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/png', bytes: png });
    expect(await code(chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), voiceUploadId: photo.uploadId, durationSec: 3 }))).toBe('upload_invalid');
  });

  it('the file goes with the chat: deleted once the thread closes, the bubble keeps its length', async () => {
    const { h, chat, blobs } = setup();
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    const toDriver = await voice(chat, blobs, 'c1', o.id);
    await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), voiceUploadId: toDriver, durationSec: 12 });
    const toDesk = await voice(chat, blobs, 'c1', o.id, 'customer_support');
    await chat.send(as('c1'), { orderId: o.id, kind: 'customer_support', clientId: cid(), voiceUploadId: toDesk, durationSec: 4 });
    await h.pickup(trip.id);
    await h.dropoff(trip.id, { cashCollectedIqd: 16500 });

    // Still open: nothing goes.
    h.clock.advance(29 * MIN);
    expect(await chat.purgeClosedVoice(10)).toBe(0);
    expect(await blobs.getVoice(toDriver)).not.toBeNull();

    // The driver chat closes at 30 minutes; the support chat stays open for 24 hours.
    h.clock.advance(2 * MIN);
    expect(await chat.purgeClosedVoice(10)).toBe(1);
    expect(await blobs.getVoice(toDriver)).toBeNull();
    expect(await blobs.getVoice(toDesk)).not.toBeNull();
    const gone = (await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' })).messages[0]!;
    expect(gone).toMatchObject({ kind: 'voice', audioUrl: null, durationSec: 12 });
    expect(await chat.purgeClosedVoice(10)).toBe(0);

    h.clock.advance(24 * 60 * MIN);
    expect(await chat.purgeClosedVoice(1)).toBe(1);
    expect(await blobs.getVoice(toDesk)).toBeNull();
  });

  it('walks every thread page by page: open threads never block closed ones', async () => {
    const { h, chat, blobs } = setup();
    const done = await acceptedOrder(h);
    const doneTrip = await h.tripFor(done.id);
    const running = await acceptedOrder(h);
    await h.tripFor(running.id, { driverId: 'd2' });
    for (const o of [running, done]) {
      const id = await voice(chat, blobs, 'c1', o.id);
      await chat.send(as('c1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), voiceUploadId: id, durationSec: 2 });
    }
    await h.pickup(doneTrip.id);
    await h.dropoff(doneTrip.id, { cashCollectedIqd: 16500 });
    h.clock.advance(31 * MIN);
    expect(await chat.purgeClosedVoice(1)).toBe(1);
    const still = (await chat.thread(as('c1'), { orderId: running.id, kind: 'customer_courier' })).messages[0]!;
    expect(still.audioUrl).not.toBeNull();
  });
});

describe('ChatService — «نسيت غرض» after a ride (ride step 3, s7)', () => {
  /** A day taxi ride from c1, driven by d1 to the end. */
  async function completedRide(h: H) {
    const o = await h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', fareIqd: 3000, pickup: { zoneKey: 'centre', pin: { lat: 32.9105, lng: 45.0665 } }, dropoff: { zoneKey: 'street_30', pin: { lat: 32.9185, lng: 45.0712 } } });
    const t = await h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    await h.pickup(t.id);
    await h.dropoff(t.id);
    expect((await h.trips.get(t.id)).state).toBe('completed');
    return o;
  }

  it('reopens the driver chat until the ride’s end + 24 h, writes the line once, and lists it for the driver', async () => {
    const { h, chat, ev } = setup();
    const o = await completedRide(h);
    const ended = (await h.trips.get((await h.trips.courierOf(o.id))!.tripId)).completedAt!;
    h.clock.advance(3 * 60 * MIN);
    expect((await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' })).status).toBe('closed');
    const res = await chat.lostItem(as('c1'), { orderId: o.id });
    expect(res.openUntil.getTime()).toBe(ended.getTime() + 24 * 60 * MIN);
    const view = await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' });
    expect(view.status).toBe('open');
    const lines = view.messages.filter((m) => m.kind === 'system');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('الراكب يدور على غرض نساه بالسيارة');
    // The driver can answer, and sees it in his list.
    await chat.send(as('d1'), { orderId: o.id, kind: 'customer_courier', clientId: cid(), text: 'لگيته، أرجعه هسة' });
    expect(await chat.lostItems(as('d1'))).toEqual([expect.objectContaining({ orderId: o.id, threadId: res.threadId })]);
    expect(await chat.lostItems(as('d2'))).toEqual([]);
    // Asking again: same window, no second line.
    h.clock.advance(MIN);
    expect((await chat.lostItem(as('c1'), { orderId: o.id })).openUntil).toEqual(res.openUntil);
    expect((await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' })).messages.filter((m) => m.kind === 'system')).toHaveLength(1);
    expect((await ev.repo.find({})).filter((e) => e.type === 'chat.message_sent' && (e.payload as { messageKind?: string }).messageKind === 'system')).toHaveLength(1);
    // Past the window the chat closes again and leaves the driver's list.
    h.clock.advance(24 * 60 * MIN);
    expect((await chat.thread(as('c1'), { orderId: o.id, kind: 'customer_courier' })).status).toBe('closed');
    expect(await chat.lostItems(as('d1'))).toEqual([]);
  });

  it('only the orderer or rider, only on a completed ride, only within 24 h', async () => {
    const { h, chat } = setup();
    const food = await acceptedOrder(h);
    await h.tripFor(food.id, { driverId: 'd2' });
    expect(await code(chat.lostItem(as('c1'), { orderId: food.id }))).toBe('chat_lost_item_unavailable');
    const o = await completedRide(h);
    expect(await code(chat.lostItem(as('d1'), { orderId: o.id }))).toBe('chat_not_party');
    expect(await code(chat.lostItem(as('stranger'), { orderId: o.id }))).toBe('chat_not_party');
    h.clock.advance(24 * 60 * MIN);
    expect(await code(chat.lostItem(as('c1'), { orderId: o.id }))).toBe('chat_lost_item_unavailable');
  });
});
