import { describe, expect, it } from 'vitest';
import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { ProviderError } from '../../shared/messaging/http.js';
import { notifyDeliveries } from '../../shared/metrics.js';
import { SMS_DAY_KEY, SMS_DAY_MS } from '../../shared/sms-budget.js';
import { InMemoryWindowCounter } from '../../shared/window-counter.js';
import type { NotifySmsBudget } from './notify.engine.js';
import { inQuietHours, quietHoursEnd } from './notify.engine.js';
import { twinStillWanted } from './notify.subscribers.js';
import type { PromoHold } from '../controls/index.js';
import { CallbackWhatsApp, notifyHarness, ScriptedPush } from './test-harness.js';

const SEC = 1000;
const receipt = { merchant: 'مطعم خالد', amount: '12,500', receiptUrl: 'https://driver.iq/r/ord_1', orderId: 'ord_1' };

describe('notify routing', () => {
  it('sends an order receipt by push and WhatsApp, rendered in Iraqi Arabic, and logs both', async () => {
    const h = notifyHarness();
    await h.register('cust');
    const created = await h.service.dispatch({ eventId: 'ev1', template: 'order_receipt', to: 'cust', orderId: 'ord_1', params: receipt });
    expect(created.map((r) => [r.channel, r.status])).toEqual([
      ['push', 'queued'],
      ['whatsapp', 'queued'],
    ]);
    await h.run();
    const rows = await h.rows({ orderId: 'ord_1' });
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ['push', 'sent'],
      ['whatsapp', 'delivered'],
    ]);
    const push = (h.push as unknown as { sent: Array<{ title: string; body: string; channelId: string; data: Record<string, string> }> }).sent[0]!;
    expect(push.title).toBe('وصل طلبك');
    expect(push.channelId).toBe('orders');
    expect(push.data).toMatchObject({ deepLink: 'driver://order/ord_1', template: 'order_receipt', deliveryId: rows[0]!.id });
    const wa = (h.whatsapp as unknown as { sent: Array<{ template: string; language: string; params: string[]; to: string }> }).sent[0]!;
    expect(wa).toMatchObject({ template: 'order_receipt', language: 'ar', to: '+9647701110001', params: ['مطعم خالد', '12,500', 'https://driver.iq/r/ord_1'] });
    expect(rows[1]!.payload.body).toBe('وصل طلبك من مطعم خالد. المجموع 12,500 دينار. الوصل: https://driver.iq/r/ord_1');
    // The phone left the vault only for the WhatsApp send.
    expect(h.phoneReads).toEqual(['cust:notify:order_receipt']);
  });

  it('a data-only template (the الرجعة lock-screen card) goes out silent with its data and the deep link', async () => {
    const h = notifyHarness();
    await h.register('cust');
    await h.service.dispatch({ eventId: 'ev9', template: 'rajaa_pass_update', to: 'cust', params: { bookingId: 'bk_1', phase: 'on_road' }, data: { kind: 'rajaa_pass_update', bookingId: 'bk_1', phase: 'on_road' } });
    await h.run();
    const push = (h.push as unknown as { sent: Array<{ silent?: boolean; data: Record<string, string> }> }).sent[0]!;
    expect(push.silent).toBe(true);
    expect(push.data).toMatchObject({ kind: 'rajaa_pass_update', bookingId: 'bk_1', phase: 'on_road', deepLink: 'driver://rajaa/pass/bk_1', template: 'rajaa_pass_update' });
    expect((await h.rows({})).map((r) => [r.channel, r.status])).toEqual([['push', 'sent']]);
  });

  it('dedupes by event id: an outbox redelivery inserts and sends nothing', async () => {
    const h = notifyHarness();
    await h.register('cust');
    await h.service.dispatch({ eventId: 'ev1', template: 'order_accepted', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'o1' } });
    const again = await h.service.dispatch({ eventId: 'ev1', template: 'order_accepted', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'o1' } });
    await h.run();
    expect(again).toEqual([]);
    expect((h.push as unknown as { sent: unknown[] }).sent).toHaveLength(1);
    // Another event for the same order is a new message.
    await h.service.dispatch({ eventId: 'ev2', template: 'order_accepted', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'o1' } });
    await h.run();
    expect((h.push as unknown as { sent: unknown[] }).sent).toHaveLength(2);
  });

  it('applies preferences: receipts off WhatsApp, order updates off push, marketing opt-in', async () => {
    const h = notifyHarness();
    await h.register('cust');
    await h.service.setPreferences(h.actor('cust'), { whatsappReceipts: false });
    await h.service.dispatch({ eventId: 'ev1', template: 'order_receipt', to: 'cust', params: receipt });
    await h.service.dispatch({ eventId: 'ev2', template: 'marketing_offer', to: 'cust', params: { title: 'عرض', body: 'خصم' } });
    await h.run();
    const rows = await h.rows({ personId: 'cust' });
    expect(rows.map((r) => [r.template, r.channel, r.status, r.reason])).toEqual([
      ['order_receipt', 'push', 'sent', null],
      ['order_receipt', 'whatsapp', 'suppressed', 'preference:whatsappReceipts'],
      ['marketing_offer', 'push', 'suppressed', 'preference:marketing'],
    ]);
    expect(await h.service.preferences(h.actor('cust'))).toEqual({ orderUpdates: true, chat: true, whatsappReceipts: false, smsFallback: true, marketing: false, dishPots: true, regularTrips: true, sameRide: true, foodCarts: true });
  });

  it('never lets a preference switch off safety, work or money messages', async () => {
    const h = notifyHarness();
    await h.register('guardian');
    await h.service.setPreferences(h.actor('guardian'), { orderUpdates: false, whatsappReceipts: false, smsFallback: false, chat: false });
    await h.service.dispatch({ eventId: 'ev1', template: 'khat_child_arrived', to: 'guardian', params: { child: 'زينب', place: 'مدرسة الرافدين', time: '7:40' } });
    await h.run();
    const rows = await h.rows({ personId: 'guardian' });
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ['push', 'sent'],
      ['whatsapp', 'delivered'],
    ]);
  });
});

describe('quiet hours and the marketing cap', () => {
  it('knows the 23:00–08:00 Baghdad window', () => {
    expect(inQuietHours(new Date('2026-10-04T19:59:00Z'))).toBe(false); // 22:59
    expect(inQuietHours(new Date('2026-10-04T20:00:00Z'))).toBe(true); // 23:00
    expect(inQuietHours(new Date('2026-10-05T04:59:00Z'))).toBe(true); // 07:59
    expect(inQuietHours(new Date('2026-10-05T05:00:00Z'))).toBe(false); // 08:00
    expect(quietHoursEnd(new Date('2026-10-04T20:30:00Z')).toISOString()).toBe('2026-10-05T05:00:00.000Z');
    expect(quietHoursEnd(new Date('2026-10-05T01:00:00Z')).toISOString()).toBe('2026-10-05T05:00:00.000Z');
  });

  it('holds marketing until 08:00 and sends transactional messages at once', async () => {
    const h = notifyHarness({ start: '2026-10-04T20:30:00Z' }); // 23:30 local
    await h.register('cust');
    await h.service.setPreferences(h.actor('cust'), { marketing: true });
    await h.service.dispatch({ eventId: 'm1', template: 'marketing_offer', to: 'cust', params: { title: 'عرض الجمعة', body: 'توصيل مجاني' } });
    await h.service.dispatch({ eventId: 'o1', template: 'order_accepted', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'o1' } });
    await h.run();
    let rows = await h.rows({ personId: 'cust' });
    expect(rows.map((r) => [r.template, r.status, r.reason])).toEqual([
      ['marketing_offer', 'deferred', 'quiet_hours'],
      ['order_accepted', 'sent', null],
    ]);
    await h.run(4 * 3600 * SEC); // 03:30 local: still quiet
    expect((await h.rows({ personId: 'cust' }))[0]!.status).toBe('deferred');
    h.clock.set('2026-10-05T05:00:00Z');
    await h.run();
    rows = await h.rows({ personId: 'cust' });
    expect(rows[0]!.status).toBe('sent');
    const sent = (h.push as unknown as { sent: Array<{ channelId: string; priority: string; sound: string | null }> }).sent;
    expect(sent[1]).toMatchObject({ channelId: 'marketing', priority: 'normal', sound: null });
  });

  it('drops a deferred offer when the person opts out overnight', async () => {
    const h = notifyHarness({ start: '2026-10-04T21:00:00Z' });
    await h.register('cust');
    await h.service.setPreferences(h.actor('cust'), { marketing: true });
    await h.service.dispatch({ eventId: 'm1', template: 'marketing_offer', to: 'cust', params: { title: 'x', body: 'y' } });
    await h.service.setPreferences(h.actor('cust'), { marketing: false });
    h.clock.set('2026-10-05T05:00:00Z');
    await h.run();
    expect((await h.rows({ personId: 'cust' })).map((r) => [r.status, r.reason])).toEqual([['suppressed', 'preference:marketing']]);
  });

  it('caps marketing at 2 per rolling week', async () => {
    const h = notifyHarness();
    await h.register('cust');
    await h.service.setPreferences(h.actor('cust'), { marketing: true });
    for (const id of ['m1', 'm2', 'm3']) await h.service.dispatch({ eventId: id, template: 'marketing_offer', to: 'cust', params: { title: 't', body: 'b' } });
    expect((await h.rows({ personId: 'cust' })).map((r) => r.status)).toEqual(['queued', 'queued', 'suppressed']);
    h.clock.advance(8 * 86_400 * SEC);
    const [next] = await h.service.dispatch({ eventId: 'm4', template: 'marketing_offer', to: 'cust', params: { title: 't', body: 'b' } });
    expect(next!.status).toBe('queued');
  });

  it('sends no offers on a quiet day, whether new or deferred from the night before; order updates still go', async () => {
    let quiet = false;
    const h = notifyHarness({ start: '2026-11-12T20:30:00Z', quietDay: async () => quiet }); // 23:30 local, 12 Nov
    await h.register('cust');
    await h.service.setPreferences(h.actor('cust'), { marketing: true });
    await h.service.dispatch({ eventId: 'm1', template: 'marketing_offer', to: 'cust', params: { title: 'عرض', body: 'خصم' } });
    quiet = true; // the mourning day starts at midnight
    h.clock.set('2026-11-13T05:00:00Z'); // 08:00 local: quiet hours over
    await h.run();
    await h.service.dispatch({ eventId: 'm2', template: 'marketing_offer', to: 'cust', params: { title: 'عرض', body: 'خصم' } });
    await h.service.dispatch({ eventId: 'o1', template: 'order_accepted', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'o1' } });
    await h.run();
    expect((await h.rows({ personId: 'cust' })).map((r) => [r.template, r.status, r.reason])).toEqual([
      ['marketing_offer', 'suppressed', 'quiet_day'],
      ['marketing_offer', 'suppressed', 'quiet_day'],
      ['order_accepted', 'sent', null],
    ]);
  });

  it('J6: an offer in the 20 minutes before iftar waits until after the latest iftar; a season with offers off drops it; order updates still go', async () => {
    const until = new Date('2027-02-08T14:54:00Z'); // 17:54 Baghdad, the later timetable's iftar
    let hold: PromoHold | null = { reason: 'iftar', until };
    const h = notifyHarness({ start: '2027-02-08T14:25:00Z', promoHold: async (at) => (hold?.reason === 'iftar' && at >= hold.until ? null : hold) });
    await h.register('cust');
    await h.service.setPreferences(h.actor('cust'), { marketing: true });
    const [held] = await h.service.dispatch({ eventId: 'm1', template: 'marketing_offer', to: 'cust', params: { title: 'عرض', body: 'خصم' } });
    expect(held).toMatchObject({ status: 'deferred', reason: 'iftar', notBefore: until });
    await h.service.dispatch({ eventId: 'o1', template: 'order_accepted', to: 'cust', params: { merchant: 'مطعم خالد', orderId: 'o1' } });
    await h.run();
    expect((await h.rows({ personId: 'cust' })).map((r) => [r.template, r.status])).toEqual([
      ['marketing_offer', 'deferred'],
      ['order_accepted', 'sent'],
    ]);
    h.clock.set('2027-02-08T14:55:00Z');
    await h.run();
    expect((await h.rows({ personId: 'cust' })).filter((r) => r.template === 'marketing_offer').map((r) => r.status)).toEqual(['sent']);
    hold = { reason: 'season' };
    const [dropped] = await h.service.dispatch({ eventId: 'm2', template: 'marketing_offer', to: 'cust', params: { title: 'عرض', body: 'خصم' } });
    expect(dropped).toMatchObject({ status: 'suppressed', reason: 'season' });
  });
});

describe('SMS twins', () => {
  it('sends the merchant SMS twin when the new-order push is not confirmed in 30 s', async () => {
    const push = new ScriptedPush();
    const h = notifyHarness({ push });
    await h.register('owner', 'ExponentPushToken[owner-1]', 'merchant');
    await h.service.dispatch({ eventId: 'ev1', template: 'merchant_new_order', to: 'owner', orderId: 'o1', params: { id: '1284', items: '3 أصناف', orderId: 'o1' } });
    await h.run();
    expect(push.sent[0]).toMatchObject({ channelId: 'offers', sound: 'offer.wav', priority: 'high', ttlSec: 120 });
    await h.run(29 * SEC);
    expect(h.sms.sent).toHaveLength(0);
    await h.run(1 * SEC);
    expect(push.receiptsAsked).toEqual([['t1']]);
    expect(h.sms.sent.map((m) => [m.to, m.body])).toEqual([['+9647701110003', 'درايفر: طلب جديد! — #1284 · 3 أصناف · اقبله خلال 90 ثانية']]);
    const rows = await h.rows({ orderId: 'o1' });
    expect(rows.map((r) => [r.channel, r.status, r.twin])).toEqual([
      ['push', 'sent', false],
      ['sms', 'sent', true],
    ]);
  });

  it('sends no new-order twin once the order no longer waits for the kitchen (accepted in the 30 s)', async () => {
    const push = new ScriptedPush();
    let waiting = true;
    const h = notifyHarness({ push, twinWanted: (row) => twinStillWanted({ order: async (id) => (id === 'o1' ? { id, type: 'food', customerId: 'cust', merchantOrgId: 'm1', totalIqd: 0, itemCount: 1, waitingForKitchen: waiting } : null) }, row) });
    await h.register('owner', 'ExponentPushToken[owner-1]', 'merchant');
    await h.service.dispatch({ eventId: 'ev1', template: 'merchant_new_order', to: 'owner', orderId: 'o1', params: { id: 'X', items: '1', orderId: 'o1' } });
    await h.run();
    waiting = false;
    await h.run(30 * SEC);
    expect(h.sms.sent).toHaveLength(0);
    expect((await h.rows({ orderId: 'o1' })).map((r) => [r.channel, r.status, r.reason])).toEqual([
      ['push', 'sent', null],
      ['sms', 'suppressed', 'no_longer_needed'],
    ]);
  });

  it('sends no twin when the receipt confirms the push', async () => {
    const push = new ScriptedPush();
    push.receipt.set('t1', { ok: true });
    const h = notifyHarness({ push });
    await h.register('owner', 'ExponentPushToken[owner-1]', 'merchant');
    await h.service.dispatch({ eventId: 'ev1', template: 'merchant_new_order', to: 'owner', orderId: 'o1', params: { id: 'X', items: '1', orderId: 'o1' } });
    await h.run();
    await h.run(30 * SEC);
    expect(h.sms.sent).toHaveLength(0);
    expect((await h.rows({ orderId: 'o1' })).map((r) => r.status)).toEqual(['delivered']);
  });

  it('sends no twin when the app acknowledged the push', async () => {
    const push = new ScriptedPush();
    const h = notifyHarness({ push });
    await h.register('owner', 'ExponentPushToken[owner-1]', 'merchant');
    const [row] = await h.service.dispatch({ eventId: 'ev1', template: 'merchant_new_order', to: 'owner', params: { id: 'X', items: '1', orderId: 'o1' } });
    await h.run();
    expect(await h.service.ack(h.actor('cust'), { deliveryId: row!.id, opened: false })).toEqual({ ok: false });
    expect(await h.service.ack(h.actor('owner'), { deliveryId: row!.id, opened: true })).toEqual({ ok: true });
    await h.run(30 * SEC);
    expect(h.sms.sent).toHaveLength(0);
    expect((await h.repo.delivery(row!.id))!.status).toBe('read');
  });

  it('does not wait when the person has no device: the twin goes at once', async () => {
    const h = notifyHarness();
    await h.service.dispatch({ eventId: 'ev1', template: 'merchant_new_order', to: 'owner', params: { id: 'X', items: '1', orderId: 'o1' } });
    await h.run();
    expect((await h.rows({ personId: 'owner' })).map((r) => [r.channel, r.status, r.reason])).toEqual([
      ['push', 'skipped', 'no_device'],
      ['sms', 'sent', null],
    ]);
  });

  it('WhatsApp with status callbacks: SMS after 60 s undelivered, none once Meta says delivered', async () => {
    const wa = new CallbackWhatsApp();
    const h = notifyHarness({ whatsapp: wa });
    await h.service.dispatch({ eventId: 'ev1', template: 'wallet_topup_receipt', to: 'cust', params: { amount: '25,000', date: '2026-10-04', reference: 'TU-1' } });
    await h.service.dispatch({ eventId: 'ev2', template: 'wallet_topup_receipt', to: 'cust', params: { amount: '10,000', date: '2026-10-04', reference: 'TU-2' } });
    await h.run();
    // Push has no device (skipped); the WhatsApp is only `sent` until the webhook speaks.
    expect(h.sms.sent).toHaveLength(0);
    expect(await h.service.whatsAppStatus('wamid.2', 'delivered', h.clock.now(), null)).toBe(true);
    await h.run(60 * SEC);
    expect(h.sms.sent.map((m) => m.body)).toEqual(['درايفر: انشحنت محفظتك بدرايفر بـ 25,000 دينار كاش يوم 2026-10-04. الرقم المرجعي: TU-1. تگدر تدفع بيها طلباتك هسة.']);
  });

  it('a WhatsApp failure from the webhook triggers the twin at once', async () => {
    const wa = new CallbackWhatsApp();
    const h = notifyHarness({ whatsapp: wa });
    await h.service.dispatch({ eventId: 'ev1', template: 'khat_child_arrived', to: 'guardian', params: { child: 'زينب', place: 'مدرسة الرافدين', time: '7:40' } });
    await h.run();
    await h.service.whatsAppStatus('wamid.1', 'failed', h.clock.now(), 'wa_131026: undeliverable');
    await h.run();
    expect(h.sms.sent.map((m) => m.body)).toEqual(['درايفر: زينب وصل مدرسة الرافدين بالسلامة الساعة 7:40.']);
  });

  it('respects smsFallback for receipts but not for safety', async () => {
    const wa = new CallbackWhatsApp();
    const h = notifyHarness({ whatsapp: wa });
    await h.service.setPreferences(h.actor('cust'), { smsFallback: false });
    await h.service.dispatch({ eventId: 'ev1', template: 'order_receipt', to: 'cust', params: receipt });
    await h.run(60 * SEC);
    const rows = await h.rows({ personId: 'cust' });
    expect(rows.map((r) => [r.channel, r.status, r.reason])).toEqual([
      ['push', 'skipped', 'no_device'],
      ['whatsapp', 'sent', null],
      ['sms', 'suppressed', 'preference:smsFallback'],
    ]);
    expect(h.sms.sent).toHaveLength(0);
  });

  it('templates without a twin never fall back to SMS', async () => {
    const h = notifyHarness();
    await h.service.dispatch({ eventId: 'ev1', template: 'order_accepted', to: 'cust', params: { merchant: 'x', orderId: 'o' } });
    await h.run(120 * SEC);
    expect(h.sms.sent).toHaveLength(0);
  });

  it('a ride booked by phone texts the caller its own short SMS at once, logged with the text; the caller may turn it off', async () => {
    const h = notifyHarness();
    const params = { driver: 'عباس', car: 'كيا سيراتو · فضي، لوحة 23456 واسط', eta: 'يوصلك بعد 4 دقايق', link: 'https://driver.iq/share/tok_1' };
    await h.service.dispatch({ eventId: 'ev1', template: 'phone_ride_matched', to: 'cust', orderId: 'ord_1', params });
    await h.service.dispatch({ eventId: 'ev2', template: 'phone_driver_arrived', to: 'cust', orderId: 'ord_1', params: { driver: 'عباس', car: params.car, amount: '4,000' } });
    await h.run();
    expect(h.sms.sent.map((m) => m.body)).toEqual([
      'درايفر: عباس جاي ياخذك: كيا سيراتو · فضي، لوحة 23456 واسط. يوصلك بعد 4 دقايق. تابعه: https://driver.iq/share/tok_1',
      'درايفر: عباس وصل وينتظرك: كيا سيراتو · فضي، لوحة 23456 واسط. الأجرة 4,000 دينار كاش.',
    ]);
    const rows = await h.rows({ orderId: 'ord_1' });
    expect(rows.map((r) => [r.template, r.channel, r.status])).toEqual([
      ['phone_ride_matched', 'sms', 'sent'],
      ['phone_driver_arrived', 'sms', 'sent'],
    ]);
    expect(rows[0]!.payload.body).toBe(h.sms.sent[0]!.body);

    const off = notifyHarness();
    await off.service.setPreferences(off.actor('cust'), { smsFallback: false });
    await off.service.dispatch({ eventId: 'ev1', template: 'phone_ride_matched', to: 'cust', params });
    await off.run();
    expect(off.sms.sent).toHaveLength(0);
  });
});

describe('WhatsApp not set up (a live host without WHATSAPP_TOKEN)', () => {
  const sos = { name: 'حيدر ك.', role: 'سايق', what: 'مشوار تكتك #1290', link: 'https://console.driver.iq/safety/sos_1', incidentId: 'sos_1' };

  it('safety page with no WhatsApp -> SMS after 30 s', async () => {
    const push = new ScriptedPush(); // the push is taken but its receipt never confirms it
    const h = notifyHarness({ push, whatsapp: null });
    await h.register('owner', 'ExponentPushToken[owner-1]', 'partner');
    await h.service.dispatch({ eventId: 'ev1', template: 'sos_dispatch_alert', to: 'owner', params: sos });
    await h.run();
    expect((await h.rows({ personId: 'owner' })).map((r) => [r.channel, r.status, r.reason])).toEqual([
      ['push', 'sent', null],
      ['whatsapp', 'skipped', 'not_configured'],
    ]);
    await h.run(29 * SEC);
    expect(h.sms.sent).toHaveLength(0);
    await h.run(1 * SEC);
    expect(h.sms.sentTo('+9647701110003')).toHaveLength(1);

    // Someone with no app at all gets the SMS at once: nothing else could reach him.
    await h.service.dispatch({ eventId: 'ev2', template: 'sos_dispatch_alert', to: 'courier', params: sos });
    await h.run();
    expect((await h.rows({ personId: 'courier' })).map((r) => [r.channel, r.status, r.reason])).toEqual([
      ['push', 'skipped', 'no_device'],
      ['whatsapp', 'skipped', 'not_configured'],
      ['sms', 'sent', null],
    ]);
  });

  it('a WhatsApp-only safety message (the emergency contact) goes by SMS straight away', async () => {
    const h = notifyHarness({ whatsapp: null });
    await h.service.dispatch({ eventId: 'ev1', template: 'sos_emergency_contact', to: 'guardian', params: { name: 'علي', link: 'https://driver.iq/sos/abc' } });
    await h.run();
    expect((await h.rows({ personId: 'guardian' })).map((r) => [r.channel, r.status, r.reason])).toEqual([
      ['whatsapp', 'skipped', 'not_configured'],
      ['sms', 'sent', null],
    ]);
  });
});

describe('the shared daily SMS budget', () => {
  function budget(dailyBudget: number, alerts: unknown[], throttle = true) {
    let counter: InMemoryWindowCounter | undefined;
    const make = (clock: FakeClock): NotifySmsBudget => {
      counter = new InMemoryWindowCounter(clock);
      return { counter, dailyBudget, throttle, alert: async (a) => void alerts.push(a) };
    };
    return { make, counter: () => counter! };
  }
  const order = (n: number) => ({ eventId: `ev${n}`, template: 'merchant_new_order' as const, to: 'owner', params: { id: String(n), items: '1', orderId: `o${n}` } });

  it('counts every notification SMS in the same day counter as sign-in codes, alerting at 50/80/100 % once each', async () => {
    const alerts: unknown[] = [];
    const b = budget(4, alerts);
    const h = notifyHarness({ smsBudget: b.make });
    for (let n = 1; n <= 4; n += 1) await h.service.dispatch(order(n)); // no device: each twin goes at once
    await h.run();
    expect(h.sms.sent).toHaveLength(4);
    expect(await b.counter().count(SMS_DAY_KEY, SMS_DAY_MS)).toBe(4);
    expect(alerts).toEqual([
      { level: 50, count: 2, limit: 4 },
      { level: 80, count: 4, limit: 4 },
      { level: 100, count: 4, limit: 4 },
    ]);
  });

  it('past 100 %: SMS twins are skipped (sms_budget), safety twins and SMS-first messages still go', async () => {
    const alerts: unknown[] = [];
    const b = budget(2, alerts);
    const h = notifyHarness({ smsBudget: b.make });
    await h.service.dispatch(order(1));
    await h.service.dispatch(order(2));
    await h.run();
    await h.service.dispatch(order(3));
    await h.service.dispatch({ eventId: 'sos', template: 'courier_unreachable_reminder', to: 'cust', params: { orderId: 'o9' } });
    await h.service.dispatch({ eventId: 'ph', template: 'phone_ride_matched', to: 'cust', params: { driver: 'علي', car: 'تكتك', eta: 'بعد 5 دقايق' } });
    await h.run();
    const sms = (await h.rows()).filter((r) => r.channel === 'sms').map((r) => [r.template, r.status, r.reason]);
    expect(sms.sort((x, y) => String(x).localeCompare(String(y)))).toEqual([
      ['courier_unreachable_reminder', 'sent', null],
      ['merchant_new_order', 'sent', null],
      ['merchant_new_order', 'sent', null],
      ['merchant_new_order', 'skipped', 'sms_budget'],
      ['phone_ride_matched', 'sent', null],
    ]);
  });

  it('OTP_BUDGET_MODE=alert: past 100 % the twins still go', async () => {
    const b = budget(1, [], false);
    const h = notifyHarness({ smsBudget: b.make });
    await h.service.dispatch(order(1));
    await h.service.dispatch(order(2));
    await h.run();
    expect(h.sms.sent).toHaveLength(2);
  });
});

describe('delivery outcomes ops can see', () => {
  const value = (channel: string, result: string) => notifyDeliveries.values.get(`channel="${channel}",result="${result}"`) ?? 0;

  it('counts notify_delivery_total{channel,result} and reports a refused account at error level', async () => {
    const errors: string[] = [];
    const warns: string[] = [];
    const err = vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => void errors.push(String(m)));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void warns.push(String(m)));
    try {
      const push = new ScriptedPush();
      const h = notifyHarness({ push });
      await h.register('cust');
      const before = { sent: value('push', 'sent'), account: value('push', 'account'), failed: value('push', 'failed') };
      await h.service.dispatch({ eventId: 'ev1', template: 'order_accepted', to: 'cust', params: { merchant: 'x', orderId: 'o' } });
      await h.run();
      push.throwNext.push(new ProviderError('expo', 'http_401', 'unauthorized', true));
      await h.service.dispatch({ eventId: 'ev2', template: 'order_accepted', to: 'cust', params: { merchant: 'x', orderId: 'o' } });
      await h.run();
      push.throwNext.push(new ProviderError('expo', 'http_400', 'bad request', true));
      await h.service.dispatch({ eventId: 'ev3', template: 'order_accepted', to: 'cust', params: { merchant: 'x', orderId: 'o' } });
      await h.run();
      expect({ sent: value('push', 'sent') - before.sent, account: value('push', 'account') - before.account, failed: value('push', 'failed') - before.failed }).toEqual({ sent: 1, account: 1, failed: 1 });
      expect(errors.filter((m) => m.includes('http_401'))).toHaveLength(1);
      expect(errors.some((m) => m.includes('http_400'))).toBe(false);
      expect(warns.some((m) => m.includes('http_400'))).toBe(true);
    } finally {
      err.mockRestore();
      warn.mockRestore();
    }
  });

  it('an SMS account with no balance left is an account problem too', async () => {
    const errors: string[] = [];
    const err = vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => void errors.push(String(m)));
    try {
      const h = notifyHarness();
      const before = value('sms', 'account');
      vi.spyOn(h.sms, 'send').mockRejectedValueOnce(new ProviderError('otpiq', 'http_400', 'Insufficient balance', true));
      await h.service.dispatch({ eventId: 'ev1', template: 'merchant_new_order', to: 'owner', params: { id: '1', items: '1', orderId: 'o1' } });
      await h.run();
      expect(value('sms', 'account') - before).toBe(1);
      expect(errors.some((m) => m.includes('sms provider refused our account'))).toBe(true);
    } finally {
      err.mockRestore();
    }
  });
});

describe('retries and token pruning', () => {
  it('retries a transient provider error with exponential backoff', async () => {
    const push = new ScriptedPush();
    push.throwNext.push(new ProviderError('expo', 'http_503', 'unavailable', false), new ProviderError('expo', 'http_429', 'slow down', false));
    const h = notifyHarness({ push });
    await h.register('cust');
    const [row] = await h.service.dispatch({ eventId: 'ev1', template: 'order_accepted', to: 'cust', params: { merchant: 'x', orderId: 'o' } });
    await h.run();
    expect((await h.repo.delivery(row!.id))).toMatchObject({ status: 'queued', attempts: 1, reason: 'retry:http_503' });
    expect(h.queue.pending().map((j) => j.readyAt.getTime() - h.clock.now().getTime())).toContain(1000);
    await h.run(1 * SEC);
    expect((await h.repo.delivery(row!.id))).toMatchObject({ status: 'queued', attempts: 2 });
    expect(h.queue.pending().map((j) => j.readyAt.getTime() - h.clock.now().getTime())).toContain(2000);
    await h.run(2 * SEC);
    expect((await h.repo.delivery(row!.id))).toMatchObject({ status: 'sent', attempts: 3, reason: null });
  });

  it('a job rerun after the send went out (writing "sent" failed) never sends the message again', async () => {
    const push = new ScriptedPush();
    const h = notifyHarness({ push });
    await h.register('cust');
    const update = h.repo.updateDelivery.bind(h.repo);
    let failOnce = true;
    h.repo.updateDelivery = async (id, patch, now) => {
      if (patch.status === 'sent' && failOnce) {
        failOnce = false;
        throw new Error('database timeout');
      }
      return update(id, patch, now);
    };
    const [row] = await h.service.dispatch({ eventId: 'ev1', template: 'order_accepted', to: 'cust', params: { merchant: 'x', orderId: 'o' } });
    await expect(h.run()).rejects.toThrow('database timeout'); // one attempt: the queue does not rerun it by itself
    expect(push.sent).toHaveLength(1);
    await h.engine.process({ kind: 'send', deliveryId: row!.id }); // the queue (or a stalled-job check) runs it again
    await h.run(10 * SEC); // and no retry of notify's own is waiting either
    expect(push.sent).toHaveLength(1);
  });

  it('gives up after maxAttempts, and fails a permanent error at once', async () => {
    const push = new ScriptedPush();
    for (let i = 0; i < 3; i += 1) push.throwNext.push(new ProviderError('expo', 'http_503', 'down', false));
    const h = notifyHarness({ push });
    await h.register('cust');
    const [a] = await h.service.dispatch({ eventId: 'ev1', template: 'order_accepted', to: 'cust', params: { merchant: 'x', orderId: 'o' } });
    await h.run();
    await h.run(1 * SEC);
    await h.run(2 * SEC);
    expect(await h.repo.delivery(a!.id)).toMatchObject({ status: 'failed', attempts: 3, reason: 'http_503' });
    push.throwNext.push(new ProviderError('expo', 'InvalidCredentials', 'bad token', true));
    const [b] = await h.service.dispatch({ eventId: 'ev2', template: 'order_accepted', to: 'cust', params: { merchant: 'x', orderId: 'o' } });
    await h.run();
    expect(await h.repo.delivery(b!.id)).toMatchObject({ status: 'failed', attempts: 1, reason: 'InvalidCredentials' });
  });

  it('prunes a token Expo calls DeviceNotRegistered, on the ticket or on the receipt', async () => {
    const push = new ScriptedPush();
    const h = notifyHarness({ push });
    await h.register('cust', 'ExponentPushToken[old-phone]');
    await h.register('cust', 'ExponentPushToken[new-phone]');
    push.ticket.set('ExponentPushToken[old-phone]', { ok: false, id: null, error: 'DeviceNotRegistered', invalidToken: true });
    const [row] = await h.service.dispatch({ eventId: 'ev1', template: 'order_accepted', to: 'cust', params: { merchant: 'x', orderId: 'o' } });
    await h.run();
    expect((await h.repo.tokensOf('cust')).map((t) => t.token)).toEqual(['ExponentPushToken[new-phone]']);
    expect(await h.repo.delivery(row!.id)).toMatchObject({ status: 'sent' });
    // The late receipt poll (no twin on this template) finds the other token dead too.
    const ticketId = (await h.repo.delivery(row!.id))!.providerRef!;
    push.receipt.set(ticketId, { ok: false, error: 'DeviceNotRegistered', invalidToken: true });
    await h.run(60 * SEC);
    expect(await h.repo.tokensOf('cust')).toEqual([]);
    expect(await h.repo.delivery(row!.id)).toMatchObject({ status: 'failed', reason: 'invalid_token' });
  });
});

describe('devices', () => {
  it('registers Expo tokens per person + app + session, refuses junk, and forgets a signed-out session', async () => {
    const h = notifyHarness();
    await h.register('cust', 'ExponentPushToken[a]', 'customer', 's1');
    await h.register('cust', 'ExponentPushToken[b]', 'partner', 's2');
    await expect(h.service.registerDevice(h.actor('cust'), { token: 'not-a-token-at-all', kind: 'expo', app: 'customer', platform: 'ios' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await h.repo.tokensOf('cust', 'customer')).map((t) => [t.token, t.sessionId])).toEqual([['ExponentPushToken[a]', 's1']]);
    // The same phone signs in as someone else: the token moves.
    await h.register('owner', 'ExponentPushToken[a]', 'customer', 's9');
    expect(await h.repo.tokensOf('cust', 'customer')).toEqual([]);
    // Only the owner of a token may unregister it.
    await h.service.unregisterDevice(h.actor('cust'), { token: 'ExponentPushToken[a]' });
    expect(await h.repo.tokensOf('owner')).toHaveLength(1);
    expect(await h.service.removeSessionTokens('s2')).toBe(1);
    expect(await h.repo.tokensOf('cust')).toEqual([]);
  });

  it('chat pushes go to every app the person is signed in to, with the caller text', async () => {
    const h = notifyHarness();
    await h.register('courier', 'ExponentPushToken[c-partner]', 'partner');
    await h.service.send({ to: 'courier', channel: 'push', title_ar: 'رسالة جديدة من الزبون', body_ar: 'آني بالباب', data: { type: 'chat', orderId: 'o1', deepLink: 'driver://chat/o1' } }, undefined, { eventId: 'chat-ev-1' });
    await h.service.send({ to: 'courier', channel: 'push', title_ar: 'رسالة جديدة من الزبون', body_ar: 'آني بالباب', data: { type: 'chat', orderId: 'o1' } }, undefined, { eventId: 'chat-ev-1' });
    await h.run();
    const sent = (h.push as unknown as { sent: Array<{ title: string; body: string; channelId: string; data: Record<string, string> }> }).sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: 'رسالة جديدة من الزبون', body: 'آني بالباب', channelId: 'chat', data: { deepLink: 'driver://chat/o1' } });
    const log = await h.service.log(h.actor('ops'), { orderId: 'o1', limit: 10 });
    expect(log.map((r) => [r.template, r.channel, r.status, r.title])).toEqual([['chat_message', 'push', 'sent', 'رسالة جديدة من الزبون']]);
  });

  it('renders in English for an English-speaking person', async () => {
    const h = notifyHarness({ locale: { cust: 'en' } });
    await h.register('cust');
    await h.service.dispatch({ eventId: 'ev1', template: 'order_receipt', to: 'cust', params: receipt });
    await h.run();
    const wa = (h.whatsapp as unknown as { sent: Array<{ language: string }> }).sent[0]!;
    expect(wa.language).toBe('en');
    expect((h.push as unknown as { sent: Array<{ title: string }> }).sent[0]!.title).toBe('Order delivered');
  });
});

describe('itemsAr', () => {
  it('counts dishes the Iraqi way', async () => {
    const { itemsAr } = await import('./notify.subscribers.js');
    expect([1, 2, 3, 10, 11].map(itemsAr)).toEqual(['صنف واحد', 'صنفين', '3 أصناف', '10 أصناف', '11 صنف']);
  });
});
