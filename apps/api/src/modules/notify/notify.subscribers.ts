import { Logger } from '@nestjs/common';
import { orderTicketNumber } from '@driver/contracts';
import type { EventsService, PublishedEvent } from '../events/index.js';
import type { NotifyEngine, NotifyRequest } from './notify.engine.js';
import type { NotifyLookups } from './notify.lookups.js';
import type { NotifyRepository } from './notify.repository.js';
import { iqd, localDate, localTime } from './render.js';

/** Iraqi count of dishes: صنف واحد · صنفين · 3 أصناف · 11 صنف (the kitchen reads it at a glance). */
export function itemsAr(n: number): string {
  if (n === 1) return 'صنف واحد';
  if (n === 2) return 'صنفين';
  if (n >= 3 && n <= 10) return `${n} أصناف`;
  return `${n} صنف`;
}

/**
 * The notify module's own outbox subscriber (kept apart from the realtime fan-out and every other
 * consumer). Each event below becomes zero or more `NotifyRequest`s; the engine dedupes them by
 * event id + template + person, so an at-least-once redelivery sends nothing twice.
 */
export const NOTIFY_SUBSCRIBER = 'notify:deliveries';

export const NOTIFY_EVENT_TYPES = [
  'order.accepted',
  'order.auto_accepted',
  'order.prep_extended',
  'order.late_apology',
  'order.offered_to_merchant',
  'order.delivered',
  'stop.courier_near',
  'order.completed',
  'order.matched',
  'stop.arrived',
  'merchant.paid_by_courier',
  'ops.cash_received',
  'wallet.topped_up',
  'order.change_to_wallet',
  'order.tipped',
  'support.replied',
  'support.resolved',
  'seat.booked',
  'khat.child_tapped_out',
  'khat.sweep_missed',
  'dispatch.offer_sent',
  'dispatch.zone_nudged',
  'session.signed_out',
] as const;

export interface NotifySubscriberDeps {
  engine: Pick<NotifyEngine, 'dispatch'>;
  repo: Pick<NotifyRepository, 'deleteSessionTokens'>;
  lookups: NotifyLookups;
  /** Public base of the receipt links in WhatsApp receipts (`https://driver.iq/r/`). */
  receiptBaseUrl: string;
}

const MERCHANT_STAFF = ['merchant_staff', 'merchant_owner'] as const;
const MERCHANT_OWNERS = ['merchant_owner'] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
/** A support reply in a push body: one line, at most 140 characters. */
const clip = (text: string, max = 140): string => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Turns one event into the notifications it implies. Exported for tests. */
export async function requestsFor(e: PublishedEvent, deps: NotifySubscriberDeps): Promise<NotifyRequest[]> {
  const p = e.payload;
  const base = { eventId: e.id };
  const L = deps.lookups;
  const receipt = (orderId: string) => `${deps.receiptBaseUrl.replace(/\/?$/, '/')}${orderId}`;
  switch (e.type) {
    case 'order.accepted':
    case 'order.auto_accepted': {
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order || order.type === 'ride') return [];
      const merchant = order.merchantOrgId ? ((await L.storeName(order.merchantOrgId)) ?? '') : '';
      return [{ ...base, template: 'order_accepted', to: order.customerId, orderId: order.id, params: { merchant, orderId: order.id }, data: { orderId: order.id } }];
    }
    case 'stop.courier_near': {
      // "الدليفري يوصل بعد دقيقتين" (maps program SP5b): the template was defined with no producer until now.
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order || order.type === 'ride') return [];
      const [name, courier, merchant] = await Promise.all([
        L.firstName(order.customerId, 'notify_courier_arriving'),
        L.firstName(e.actorId, 'notify_courier_arriving'),
        order.merchantOrgId ? L.storeName(order.merchantOrgId) : Promise.resolve(null),
      ]);
      return [
        {
          ...base,
          template: 'courier_arriving',
          to: order.customerId,
          orderId: order.id,
          params: { name: name ?? '', courier: courier ?? 'الدليفري', merchant: merchant ?? 'درايفر', amount: iqd(order.totalIqd), orderId: order.id },
          data: { orderId: order.id },
        },
      ];
    }
    case 'order.prep_extended': {
      // M-12: the kitchen's one "+5 د" — "المطعم زاد 5 دقايق" to the customer.
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order || order.type === 'ride') return [];
      const merchant = order.merchantOrgId ? ((await L.storeName(order.merchantOrgId)) ?? '') : '';
      return [{ ...base, template: 'order_prep_extended', to: order.customerId, orderId: order.id, params: { merchant, orderId: order.id }, data: { orderId: order.id } }];
    }
    case 'order.late_apology': {
      // The honest-delay promise, step one (Ali, 2026-10-06): "آسفين، طلبك تأخر شوية" with the new time.
      const customerId = str(p['customerId']);
      const etaAt = str(p['etaAt']);
      const eta = etaAt ? new Date(etaAt) : null;
      if (!customerId || !e.orderId || !eta || Number.isNaN(eta.getTime())) return [];
      return [{ ...base, template: 'order_late_apology', to: customerId, orderId: e.orderId, params: { time: localTime(eta), orderId: e.orderId }, data: { orderId: e.orderId } }];
    }
    case 'order.offered_to_merchant': {
      const order = e.orderId ? await L.order(e.orderId) : null;
      const orgId = str(p['merchantOrgId']) ?? order?.merchantOrgId ?? null;
      if (!order || !orgId) return [];
      const staff = await L.orgPeople(orgId, MERCHANT_STAFF);
      return staff.map((to) => ({ ...base, template: 'merchant_new_order' as const, to, orderId: order.id, params: { id: orderTicketNumber(order.id), items: itemsAr(order.itemCount), orderId: order.id }, data: { orderId: order.id } }));
    }
    case 'order.delivered': {
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order || order.type === 'ride') return [];
      const merchant = order.merchantOrgId ? ((await L.storeName(order.merchantOrgId)) ?? 'درايفر') : 'درايفر';
      return [{ ...base, template: 'order_receipt', to: order.customerId, orderId: order.id, params: { merchant, amount: iqd(order.totalIqd), receiptUrl: receipt(order.id), orderId: order.id }, data: { orderId: order.id } }];
    }
    case 'order.completed': {
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order || order.type !== 'ride') return [];
      const driver = (await L.firstName(e.actorId, 'ride_receipt')) ?? '';
      return [{ ...base, template: 'ride_receipt', to: order.customerId, orderId: order.id, params: { amount: iqd(order.totalIqd), driver, receiptUrl: receipt(order.id), orderId: order.id }, data: { orderId: order.id } }];
    }
    case 'order.matched':
    case 'stop.arrived': {
      // J1c f4: "لگينالك سايق: حيدر" when a driver takes the ride; "حيدر وصل" when he is at the pickup.
      if (e.type === 'stop.arrived' && p['stopType'] !== 'pickup') return [];
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order || order.type !== 'ride') return [];
      const driver = (await L.firstName(e.actorId, e.type === 'order.matched' ? 'notify_ride_matched' : 'notify_driver_arrived')) ?? 'السايق';
      const template = e.type === 'order.matched' ? ('ride_matched' as const) : ('driver_arrived' as const);
      return [{ ...base, template, to: order.customerId, orderId: order.id, params: { driver, orderId: order.id }, data: { orderId: order.id } }];
    }
    case 'merchant.paid_by_courier': {
      const orgId = str(p['merchantId']);
      const amount = num(p['amountIqd']);
      if (!orgId || amount === null) return [];
      const [owners, store, courier] = await Promise.all([L.orgPeople(orgId, MERCHANT_OWNERS), L.storeName(orgId), str(p['courierId']) ? L.firstName(String(p['courierId']), 'merchant_cash_handover') : null]);
      const params = { store: store ?? '', amount: iqd(amount), courier: courier ?? '', date: localDate(e.occurredAt), balance: iqd(Math.max(0, num(p['merchantBalanceIqd']) ?? 0)), reference: str(p['handoverId']) ?? e.id };
      return owners.map((to) => ({ ...base, template: 'merchant_cash_handover' as const, to, params }));
    }
    case 'ops.cash_received': {
      const courierId = str(p['courierId']);
      const amount = num(p['amountIqd']);
      if (!courierId || amount === null) return [];
      return [{ ...base, template: 'courier_cash_receipt', to: courierId, params: { amount: iqd(amount), date: localDate(e.occurredAt), balance: iqd(num(p['courierCashAfterIqd']) ?? 0) } }];
    }
    case 'wallet.topped_up': {
      const customerId = str(p['customerId']);
      const amount = num(p['amountIqd']);
      if (!customerId || amount === null) return [];
      return [{ ...base, template: 'wallet_topup_receipt', to: customerId, params: { amount: iqd(amount), date: localDate(e.occurredAt), reference: str(p['reference']) ?? '' } }];
    }
    case 'order.change_to_wallet': {
      // "الخردة علينا": "+7,250 دينار رصيد (الباقي)" — the courier had no change.
      const customerId = str(p['customerId']);
      const amount = num(p['amountIqd']);
      if (!customerId || amount === null || amount <= 0) return [];
      // Signed and isolated (\u2066+7,250\u2069) so the plus stays left of the digits in Arabic.
      return [{ ...base, template: 'cash_change_credit', to: customerId, ...(e.orderId ? { orderId: e.orderId } : {}), params: { amount: `\u2066+${iqd(amount)}\u2069` } }];
    }
    case 'order.tipped': {
      // «علي كرمك 1,000 دينار»: the customer's tip after a 4–5 rating, to the driver who carried it.
      const courierId = str(p['courierId']);
      const customerId = str(p['customerId']);
      const amount = num(p['amountIqd']);
      if (!courierId || !customerId || amount === null || amount <= 0) return [];
      const name = await L.firstName(customerId, 'notify_tip_received');
      return [{ ...base, template: 'tip_received', to: courierId, ...(e.orderId ? { orderId: e.orderId } : {}), params: { name: name ?? 'الزبون', amount: iqd(amount), id: e.orderId ? orderTicketNumber(e.orderId) : '' } }];
    }
    case 'support.replied':
    case 'support.resolved': {
      // «عندي اعتراض» answered (S-7 follow-up): only a driver's pay query names `driverId`; the push
      // carries the reply (or the resolution) and opens that job's receipt.
      const driverId = str(p['driverId']);
      const jobKey = str(p['jobKey']);
      const jobAt = str(p['jobAt']);
      const text = str(e.type === 'support.replied' ? p['text'] : p['resolution']);
      if (!driverId || !jobKey || !jobAt) return [];
      const template = e.type === 'support.replied' ? ('driver_pay_reply' as const) : ('driver_pay_resolved' as const);
      return [{ ...base, template, to: driverId, params: { text: clip(text ?? ''), key: encodeURIComponent(jobKey), at: encodeURIComponent(jobAt) } }];
    }
    case 'seat.booked': {
      const bookingId = str(p['bookingId']);
      const b = bookingId ? await L.booking(bookingId) : null;
      if (!b || !bookingId) return [];
      const params = { route: b.route, date: localDate(b.departAt), time: localTime(b.departAt), seat: b.seats, vehicle: b.vehicle, place: b.place, pin: b.pin, bookingId };
      return [{ ...base, template: 'rajaa_boarding_pass', to: b.riderId, params, data: { bookingId } }];
    }
    case 'khat.child_tapped_out': {
      const childRef = str(p['childRef']);
      if (!childRef || p['notifyGuardian'] === false) return [];
      const child = await L.child(childRef);
      if (!child) return [];
      const place = (e.tripId && str(p['stopId']) ? await L.stopPlace(e.tripId, String(p['stopId'])) : null) ?? '';
      return [{ ...base, template: 'khat_child_arrived', to: child.guardianId, params: { child: child.childFirstName, place, time: localTime(e.occurredAt) } }];
    }
    case 'khat.sweep_missed': {
      // "نسيت تتأكد إن السيارة فاضية؟" — the run's driver, the moment ops are alerted (Ali, 2026-10-06).
      const driverId = str(p['driverId']);
      if (!driverId || !e.tripId) return [];
      return [{ ...base, template: 'khat_sweep_reminder', to: driverId, params: {}, data: { tripId: e.tripId } }];
    }
    case 'dispatch.offer_sent': {
      const driverId = str(p['driverId']);
      if (!driverId || !e.tripId) return [];
      const zones = await L.tripZones(e.tripId);
      return [{ ...base, template: 'partner_new_job', to: driverId, params: { pickup: zones?.pickup ?? '', dropoff: zones?.dropoff ?? '' }, data: { tripId: e.tripId } }];
    }
    case 'dispatch.zone_nudged': {
      // "Send drivers here" (maps program o5): one push per free driver around the busy zone.
      const ids = Array.isArray(p['driverIds']) ? p['driverIds'].filter((x): x is string => typeof x === 'string') : [];
      const zone = str(p['zoneName_ar']) ?? '';
      return ids.map((to) => ({ ...base, template: 'partner_zone_nudge' as const, to, params: { zone }, data: { zoneId: str(p['zoneId']) ?? '' } }));
    }
    default:
      return [];
  }
}

/** Registers the subscriber; returns the unsubscribe function. */
export function registerNotifySubscribers(events: Pick<EventsService, 'subscribe'>, deps: NotifySubscriberDeps): () => void {
  const logger = new Logger('NotifySubscriber');
  return events.subscribe(NOTIFY_SUBSCRIBER, NOTIFY_EVENT_TYPES, async (event, ctx) => {
    if (event.type === 'session.signed_out') {
      const sessionId = str(event.payload['sessionId']);
      if (sessionId) await deps.repo.deleteSessionTokens(sessionId);
      return;
    }
    let requests: NotifyRequest[];
    try {
      requests = await requestsFor(event, deps);
    } catch (err) {
      // A lookup that throws (a deleted order, a module hiccup) must not hold the outbox back:
      // the notification is dropped and logged. Writes below still fail loudly and are retried.
      logger.warn(`${event.type} ${event.id}: no notification (${(err as Error).message})`);
      return;
    }
    for (const req of requests) await deps.engine.dispatch(req, ctx.tx);
  });
}
