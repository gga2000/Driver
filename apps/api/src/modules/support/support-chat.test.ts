import { describe, expect, it } from 'vitest';
import { CHAT_SUPPORT_CLOSE_AFTER_H, DriverError, type Actor, type RoleKind } from '@driver/contracts';
import { ChatService, CHAT_RULES, DevCallBridge, InMemoryChatRepository } from '../chat/index.js';
import type { AuditLogService, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import type { LedgerService, SupportCreditService } from '../ledger/index.js';
import type { CatalogService } from '../catalog/index.js';
import type { OrgsService } from '../orgs/index.js';
import { ordersHarness } from '../orders/test-harness.js';
import { DevBlobStore } from '../places/index.js';
import { InMemorySupportRepository } from './support.repository.js';
import { SupportService, supportChatKey } from './support.service.js';

/**
 * «كلّم الدعم» (before-launch §6): the customer's support chat inside an order, answered by the desk
 * from the Console case. Only the order's customer (and the desk) are in it; the first message opens
 * a `chat` case, the desk's reply goes back into the chat, a message after it was solved reopens it.
 */
const HOUR = 3_600_000;
const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};
let n = 0;
const cid = () => `client-${++n}-${Math.random().toString(36).slice(2, 8)}`;

const ROLES: Record<string, RoleKind[]> = { ops: ['support'], fin: ['finance'], 'm-staff': ['merchant_staff'] };

/** Test-only twists on an order as the chat module reads it (a guest participant, a ride with no kitchen). */
const patches = new Map<string, Record<string, unknown>>();

function setup() {
  const h = ordersHarness();
  const ordersView = Object.create(h.orders) as typeof h.orders;
  ordersView.get = async (id: string) => ({ ...(await h.orders.get(id)), ...(patches.get(id) ?? {}) }) as Awaited<ReturnType<typeof h.orders.get>>;
  const ev = createInMemoryEvents({ clock: h.clock, uow: h.uow });
  const identity = {
    hasRole: async (personId: string, kind: RoleKind) => (ROLES[personId] ?? []).includes(kind),
    firstNamesFor: async (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, id === 'c1' ? 'علي' : null])),
    orgRoleHolders: async () => [],
    phoneForCall: async () => null,
  };
  const chat = new ChatService(
    new InMemoryChatRepository(),
    ordersView,
    h.trips,
    identity,
    { storeName: async () => 'مطعم التجربة' },
    new DevBlobStore(h.clock, { secret: 'test' }),
    new DevCallBridge(identity, () => 'test'),
    ev.events,
    h.uow,
    h.clock,
  );
  const repo = new InMemorySupportRepository();
  const audits: Array<{ action: string }> = [];
  const support = new SupportService(
    repo,
    h.orders,
    h.trips,
    { itemsOf: async () => [] } as unknown as CatalogService,
    { get: async () => ({ name: 'مطعم التجربة' }) } as unknown as OrgsService,
    { eventsForOrder: async () => [] } as unknown as LedgerService,
    {} as unknown as SupportCreditService,
    identity as unknown as IdentityService,
    ev.events,
    { record: async (a: { action: string }) => void audits.push(a) } as unknown as AuditLogService,
    { of: async () => ({}) } as unknown as StaffNames,
    h.uow,
    h.clock,
    chat,
  );
  support.onModuleInit();
  return { h, ev, chat, repo, support, audits };
}

const say = (s: ReturnType<typeof setup>, orderId: string, text: string, who = 'c1') => s.chat.send(as(who), { orderId, kind: 'customer_support', clientId: cid(), text });

describe('support chat inside an order', () => {
  it('opens at placement for the order’s customer only — not the courier, the kitchen or a stranger', async () => {
    const s = setup();
    const o = await s.h.orders.place('c1', s.h.foodInput());
    expect((await s.chat.threads(as('c1'), { orderId: o.id })).find((t) => t.kind === 'customer_support')).toMatchObject({ status: 'open', myRole: 'customer', counterpart: 'support', canCall: false });
    await s.h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    await s.h.tripFor(o.id);
    expect(await code(s.chat.thread(as('d1'), { orderId: o.id, kind: 'customer_support' }))).toBe('chat_not_party');
    expect(await code(say(s, o.id, 'هلو', 'd1'))).toBe('chat_not_party');
    expect(await code(say(s, o.id, 'هلو', 'stranger'))).toBe('chat_not_party');
    expect(await code(s.chat.thread(as('m-staff'), { orderId: o.id, kind: 'customer_support' }))).toBe('chat_not_party');
    expect((await s.chat.threads(as('d1'), { orderId: o.id })).map((t) => t.kind)).not.toContain('customer_support');
    // No masked call to support.
    expect(await code(s.chat.requestCall(as('c1'), { orderId: o.id, kind: 'customer_support' }))).toBe('chat_not_party');
    // Quick replies are the support ones.
    expect((await s.chat.thread(as('c1'), { orderId: o.id, kind: 'customer_support' })).quickReplies).toEqual(['customer_support_late', 'customer_support_wrong', 'customer_support_courier', 'customer_support_money']);
  });

  it('the first message opens one chat case with the order; the desk sees the chat and its reply goes back into it', async () => {
    const s = setup();
    const o = await s.h.orders.place('c1', s.h.foodInput());
    await say(s, o.id, 'الطلب تأخر هواية');
    await say(s, o.id, 'وينه؟');
    const ticket = (await s.repo.bySourceKey(supportChatKey(o.id)))!;
    expect(ticket).toMatchObject({ kind: 'question', channel: 'chat', status: 'open', orderId: o.id, customerId: 'c1' });
    expect(ticket.subject).toBe('محادثة من الطلب: الطلب تأخر هواية');
    expect([...s.repo.tickets.values()]).toHaveLength(1);

    const view = await s.support.get(as('ops'), { ticketId: ticket.id });
    expect(view.ticket.channel).toBe('chat');
    expect(view.supportChat?.messages.map((m) => [m.senderRole, m.text, m.mine])).toEqual([
      ['customer', 'الطلب تأخر هواية', false],
      ['customer', 'وينه؟', false],
    ]);

    await s.support.reply(as('ops'), { ticketId: ticket.id, text: 'آسفين، الطلب طلع هسة', internal: false });
    // An internal note never reaches the chat.
    await s.support.reply(as('ops'), { ticketId: ticket.id, text: 'تابعت ويا المطعم', internal: true });
    const mine = await s.chat.thread(as('c1'), { orderId: o.id, kind: 'customer_support' });
    expect(mine.messages.map((m) => [m.senderRole, m.text])).toEqual([
      ['customer', 'الطلب تأخر هواية'],
      ['customer', 'وينه؟'],
      ['support', 'آسفين، الطلب طلع هسة'],
    ]);
    expect(mine.participants.find((p) => !p.you)?.role).toBe('support');
    const after = (await s.repo.get(ticket.id))!;
    expect(after).toMatchObject({ status: 'waiting', assigneeId: 'ops' });
    expect(after.firstResponseAt).not.toBeNull();
    // The customer writes again: back to open for the desk.
    await say(s, o.id, 'شكراً');
    expect((await s.repo.get(ticket.id))!.status).toBe('open');
    // The desk read it: his messages show as read.
    await s.support.chatRead(as('ops'), { ticketId: ticket.id, seq: 4 });
    expect((await s.chat.thread(as('c1'), { orderId: o.id, kind: 'customer_support' })).messages.filter((m) => m.mine).every((m) => m.read)).toBe(true);
  });

  it('a desk role without chat access (finance) still reads and answers through the case', async () => {
    const s = setup();
    const o = await s.h.orders.place('c1', s.h.foodInput());
    await say(s, o.id, 'عندي سؤال عن الفلوس');
    const ticket = (await s.repo.bySourceKey(supportChatKey(o.id)))!;
    await s.support.reply(as('fin'), { ticketId: ticket.id, text: 'رصيدك رجع للمحفظة', internal: false });
    expect((await s.support.get(as('fin'), { ticketId: ticket.id })).supportChat?.messages.at(-1)).toMatchObject({ senderRole: 'support', mine: true });
  });

  it('a message after the case was solved reopens it; the chat closes for him 24 h after the order', async () => {
    const s = setup();
    const o = await s.h.orders.place('c1', s.h.foodInput());
    await say(s, o.id, 'الطلب ما وصل');
    const ticket = (await s.repo.bySourceKey(supportChatKey(o.id)))!;
    await s.support.resolve(as('ops'), { ticketId: ticket.id, resolution: 'وصل الطلب' });
    await say(s, o.id, 'بس ناقص شي');
    const reopened = (await s.repo.get(ticket.id))!;
    expect(reopened).toMatchObject({ status: 'open', resolvedAt: null, reopenCount: 1 });
    expect((await s.repo.entries(ticket.id)).at(-1)).toMatchObject({ kind: 'reopen', text: 'الزبون كتب من جديد: بس ناقص شي' });

    await s.h.orders.cancel('c1', { orderId: o.id });
    s.h.clock.advance(CHAT_SUPPORT_CLOSE_AFTER_H * HOUR + 60_000);
    expect((await s.chat.thread(as('c1'), { orderId: o.id, kind: 'customer_support' })).status).toBe('closed');
    expect(await code(say(s, o.id, 'هلو'))).toBe('chat_closed');
    // The desk keeps the last word.
    expect(await code(s.support.reply(as('ops'), { ticketId: ticket.id, text: 'تواصلنا وياك', internal: false }))).toBe('ok');
  });

  it('is the orderer’s own: a guest on the order (a rider, a group-order friend) is not in it', async () => {
    const s = setup();
    const o = await s.h.orders.place('c1', s.h.foodInput());
    const base = await s.h.orders.get(o.id);
    patches.set(o.id, { participants: [...base.participants, { personId: 'guest', role: 'rider' }] });
    expect(await code(say(s, o.id, 'هلو', 'guest'))).toBe('chat_not_party');
    expect((await s.chat.threads(as('guest'), { orderId: o.id }).catch(() => [])).map((t) => t.kind)).not.toContain('customer_support');
    expect(await code(say(s, o.id, 'هلو'))).toBe('ok');
    patches.delete(o.id);
  });

  it('exists on an order with no kitchen too (a ride or a parcel)', async () => {
    const s = setup();
    const o = await s.h.orders.place('c1', s.h.foodInput());
    patches.set(o.id, { merchantOrgId: null, type: 'ride' });
    const kinds = (await s.chat.threads(as('c1'), { orderId: o.id })).map((t) => t.kind);
    expect(kinds).toEqual(['customer_courier', 'customer_support']);
    expect((await s.chat.thread(as('c1'), { orderId: o.id, kind: 'customer_support' })).quickReplies).toContain('customer_support_driver');
    patches.delete(o.id);
  });

  it(`opens at most ${CHAT_RULES.supportOpensPerDay} new support chats per customer a day`, async () => {
    const s = setup();
    const orders = [];
    for (let i = 0; i <= CHAT_RULES.supportOpensPerDay; i++) orders.push(await s.h.orders.place('c1', s.h.foodInput()));
    for (const o of orders.slice(0, CHAT_RULES.supportOpensPerDay)) await say(s, o.id, 'سؤال');
    expect(await code(say(s, orders.at(-1)!.id, 'سؤال'))).toBe('chat_support_limit');
    // An open chat keeps working.
    expect(await code(say(s, orders[0]!.id, 'بعد سؤال'))).toBe('ok');
  });
});
