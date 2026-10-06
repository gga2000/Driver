import { Logger } from '@nestjs/common';
import { encodeRajaaPassPush, orderTicketNumber, RAJAA_PASS_EVENTS, RAJAA_PASS_PUSH_KIND, rajaaPassPhaseFor } from '@driver/contracts';
import type { EventsService, PublishedEvent } from '../events/index.js';
import type { NotifyEngine, NotifyRequest } from './notify.engine.js';
import type { NotifyLookups } from './notify.lookups.js';
import type { NotifyRepository } from './notify.repository.js';
import { trustedContactRecipient } from './notify.service.js';
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
  'menu_photos.shot',
  'ops.cash_received',
  'wallet.topped_up',
  'order.change_to_wallet',
  'order.tipped',
  'support.replied',
  'support.resolved',
  'seat.booked',
  // الرجعة lock-screen pass updates (data-only), customer d-8 follow-up.
  ...RAJAA_PASS_EVENTS,
  'seat.completed',
  'khat.child_tapped_out',
  'khat.sweep_missed',
  'dispatch.offer_sent',
  'dispatch.zone_nudged',
  // Joy h2: a dish people follow is today's pot.
  'catalog.pot_posted',
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

/**
 * The الرجعة lock-screen card kept current with the app closed (customer d-8 follow-up): each boarding
 * moment sends the riders it concerns a data-only push with what the card should say now (phase, time,
 * stop, seats, PIN, the car's distance, the fare). Departure-wide events reach every booking on the
 * car; seat events only their own booking. Exported for tests.
 */
export async function passUpdatesFor(e: PublishedEvent, lookups: Pick<NotifyLookups, 'departurePasses'>): Promise<NotifyRequest[]> {
  if (!(RAJAA_PASS_EVENTS as readonly string[]).includes(e.type)) return [];
  const p = e.payload;
  const departureId = str(p['departureId']) ?? (e.aggregate === 'departure' ? e.aggregateId : null);
  if (!departureId) return [];
  const seatId = str(p['seatId']);
  const bookingId = str(p['bookingId']) ?? (seatId && seatId.includes('.') ? seatId.slice(0, seatId.lastIndexOf('.')) : null);
  if (e.type.startsWith('seat.') && !bookingId) return [];
  const passes = (await lookups.departurePasses(departureId)) ?? [];
  const out: NotifyRequest[] = [];
  for (const b of passes) {
    if (e.type.startsWith('seat.') && b.bookingId !== bookingId) continue;
    const phase = rajaaPassPhaseFor(e.type, b.state);
    if (!phase) continue;
    const data = encodeRajaaPassPush({
      kind: RAJAA_PASS_PUSH_KIND,
      bookingId: b.bookingId,
      phase,
      departAt: b.departAt,
      stop: b.stop,
      pickupKind: b.pickupKind,
      toCity: b.toCity,
      seatIds: b.seatIds,
      pin: b.pin,
      carKm: phase === 'boarding' ? b.carKm : null,
      fareIqd: b.fareIqd,
      sentAt: e.occurredAt,
    });
    out.push({ eventId: e.id, template: 'rajaa_pass_update', to: b.riderId, params: { bookingId: b.bookingId, phase }, data });
  }
  return out;
}

/** Night for the auto-share switch (w9): 9 المسا – 6 الصبح, Baghdad (UTC+3, no DST). */
export function isNight(at: Date): boolean {
  const h = (at.getUTCHours() + 3) % 24;
  return h >= 21 || h < 6;
}

/**
 * A trip link for each trusted person when the rider turned that switch on (w9): one share link,
 * made for the rider, sent to `tc:<rider>:<i>`. Nothing when the switch is off or nobody is set.
 */
async function sharedWithPeople(deps: NotifySubscriberDeps, e: PublishedEvent, riderId: string, subject: { bookingId: string } | { orderId: string }, key: 'autoShareRajaa' | 'autoShareNight', what: string): Promise<NotifyRequest[]> {
  const L = deps.lookups;
  const safety = L.safety ? await L.safety(riderId) : null;
  if (!safety?.prefs[key] || safety.contacts === 0 || !L.shareLink) return [];
  const link = await L.shareLink(riderId, subject);
  if (!link) return [];
  const name = (await L.firstName(riderId, 'notify_trip_shared')) ?? '';
  return Array.from({ length: safety.contacts }, (_, i) => ({ eventId: e.id, template: 'trip_shared_contact' as const, to: trustedContactRecipient(riderId, i), params: { name, what, link }, data: { ...subject } }));
}

/** The dedupe event id of the «قدر اليوم» push: one per person per Baghdad day, whichever kitchen. */
export function dishPotEventId(localDate: string): string {
  return `dish_pot:${localDate}`;
}

/** Turns one event into the notifications it implies. Exported for tests. */
export async function requestsFor(e: PublishedEvent, deps: NotifySubscriberDeps): Promise<NotifyRequest[]> {
  const passUpdates = await passUpdatesFor(e, deps.lookups);
  return [...passUpdates, ...(await messagesFor(e, deps))];
}

async function messagesFor(e: PublishedEvent, deps: NotifySubscriberDeps): Promise<NotifyRequest[]> {
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
      const own: NotifyRequest = { ...base, template, to: order.customerId, orderId: order.id, params: { driver, orderId: order.id }, data: { orderId: order.id } };
      // w9: a night ride (21:00–06:00 Baghdad) is shared with the trusted people when the rider asked.
      const shared = e.type === 'order.matched' && isNight(e.occurredAt) ? await sharedWithPeople(deps, e, order.customerId, { orderId: order.id }, 'autoShareNight', 'مشوار بالليل') : [];
      return [own, ...shared];
    }
    case 'merchant.paid_by_courier': {
      const orgId = str(p['merchantId']);
      const amount = num(p['amountIqd']);
      if (!orgId || amount === null) return [];
      const [owners, store, courier] = await Promise.all([L.orgPeople(orgId, MERCHANT_OWNERS), L.storeName(orgId), str(p['courierId']) ? L.firstName(String(p['courierId']), 'merchant_cash_handover') : null]);
      const params = { store: store ?? '', amount: iqd(amount), courier: courier ?? '', date: localDate(e.occurredAt), balance: iqd(Math.max(0, num(p['merchantBalanceIqd']) ?? 0)), reference: str(p['handoverId']) ?? e.id };
      return owners.map((to) => ({ ...base, template: 'merchant_cash_handover' as const, to, params }));
    }
    case 'menu_photos.shot': {
      // Menu photo service (maps k3): «صور المنيو جاهزة» to the store's owners, who accept or reject each.
      const orgId = str(p['merchantOrgId']);
      if (!orgId) return [];
      const [owners, store] = await Promise.all([L.orgPeople(orgId, MERCHANT_OWNERS), L.storeName(orgId)]);
      return owners.map((to) => ({ ...base, template: 'menu_photos_ready' as const, to, params: { store: store ?? '' } }));
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
    case 'seat.checked_in': {
      // w9: «شارك رحلات الرجعة تلقائياً» — on boarding, each trusted person gets the trip's link.
      const bookingId = str(p['bookingId']);
      const b = bookingId ? await L.booking(bookingId) : null;
      if (!b || !bookingId) return [];
      return sharedWithPeople(deps, e, b.riderId, { bookingId }, 'autoShareRajaa', `الرجعة ${b.route}`);
    }
    case 'seat.completed': {
      // r2 + w9 «بلّغهم من أوصل»: once per booking (on its first seat), to each trusted person.
      const seatRef = str(p['seatId']);
      const bookingId = seatRef?.split('.')[0] ?? null;
      const b = bookingId ? await L.booking(bookingId) : null;
      if (!b || !seatRef || (b.firstSeat && seatRef !== `${bookingId}.${b.firstSeat}`)) return [];
      const safety = L.safety ? await L.safety(b.riderId) : null;
      if (!safety?.prefs.notifyOnArrival || safety.contacts === 0) return [];
      const name = (await L.firstName(b.riderId, 'notify_rajaa_arrived')) ?? '';
      const params = { name, route: b.route, time: localTime(e.occurredAt) };
      return Array.from({ length: safety.contacts }, (_, i) => ({ ...base, template: 'rajaa_arrived_contact' as const, to: trustedContactRecipient(b.riderId, i), params, data: { bookingId: bookingId! } }));
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
    case 'catalog.pot_posted': {
      // «قدر اليوم» (joy h2): each follower of the dish, at most once a Baghdad day — the request's
      // event id is the day, so a second kitchen or a re-post the same day dedupes away in the engine.
      const ids = Array.isArray(p['followerIds']) ? p['followerIds'].filter((x): x is string => typeof x === 'string') : [];
      const day = str(p['localDate']);
      const merchantOrgId = str(p['merchantOrgId']);
      if (!day || !merchantOrgId) return [];
      return [...new Set(ids)].map((to) => ({
        eventId: dishPotEventId(day),
        template: 'dish_pot_today' as const,
        to,
        params: { restaurant: str(p['restaurantName']) ?? '', dish: str(p['dishName']) ?? '', merchantOrgId },
        data: { merchantOrgId, itemId: str(p['itemId']) ?? '' },
      }));
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
