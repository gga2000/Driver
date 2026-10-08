import { Logger } from '@nestjs/common';
import { ComplimentKey, encodeRajaaPassPush, GARAGE_TAXI_EVENTS, isNightAt, MonthKey, orderTicketNumber, RAJAA_PASS_EVENTS, RAJAA_PASS_PUSH_KIND, rajaaPassPhaseFor } from '@driver/contracts';
import { cityDayDiff, formatDay, formatHourPart, t, type MessageKey } from '@driver/i18n';
import type { EventsService, PublishedEvent } from '../events/index.js';
import type { NotifyEngine, NotifyRequest } from './notify.engine.js';
import type { NotifyLookups, OrderFacts } from './notify.lookups.js';
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

/** «بيبسي» · «بيبسي وكباب» · «3 أصناف»: what the kitchen has run out of, short enough for a push title. */
export function missingItemsAr(names: readonly string[], count: number): string {
  if (names.length === count && count === 1) return names[0]!;
  if (names.length === count && count === 2) return `${names[0]} و${names[1]}`;
  return count === 1 ? 'صنف من طلبك' : count === 2 ? 'صنفين من طلبك' : `${count} أصناف من طلبك`;
}

/**
 * The notify module's own outbox subscriber (kept apart from the realtime fan-out and every other
 * consumer). Each event below becomes zero or more `NotifyRequest`s; the engine dedupes them by
 * event id + template + person, so an at-least-once redelivery sends nothing twice.
 */
export const NOTIFY_SUBSCRIBER = 'notify:deliveries';

/** Review #28: what a booked ride's pre-assignment tells the rider and the drivers (`bookedRideRequests`). */
export const BOOKED_RIDE_EVENTS = [
  'dispatch.booked_offered',
  'dispatch.booked_opened',
  'dispatch.booked_confirmed',
  'dispatch.booked_unconfirmed',
  'dispatch.booked_reminder',
  'dispatch.booked_released',
  'dispatch.booked_cancelled',
  // NTF-05: T−30, the search for its driver started.
  'dispatch.booked_search_started',
] as const;

export const NOTIFY_EVENT_TYPES = [
  'order.accepted',
  'order.auto_accepted',
  'order.prep_extended',
  'order.late_apology',
  'order.late_credit',
  'order.offered_to_merchant',
  'order.delivered',
  // W2 CRIT1-01 / NTF-03: the turns that left the customer staring at a screen — the kitchen said no or
  // never answered, we cancelled, the courier has it, he is at the door, he can't reach him.
  'order.rejected',
  'order.cancelled',
  // BENCH-03: a dish is out — he chooses within 60 s.
  'order.partial_proposed',
  'order.picked_up',
  'trip.unreachable_started',
  'trip.unreachable_escalated',
  'stop.courier_near',
  // d3: «السايق قريب، اطلع هسة» (trips stamps it once per ride by the one ETA).
  'stop.driver_near',
  'order.completed',
  'order.matched',
  // NTF-04: a ride's bad turns — the driver who took it cancelled, or no driver took it in time.
  'order.driver_cancelled',
  'dispatch.free_cancel_available',
  'stop.arrived',
  'merchant.paid_by_courier',
  'merchant.activated',
  'menu_photos.shot',
  'ops.cash_received',
  'wallet.topped_up',
  'order.change_to_wallet',
  'order.tipped',
  'order.complimented',
  'support.replied',
  'support.resolved',
  // NTF-02: the customer's refund on a complaint.
  'support.refunded',
  'seat.booked',
  // الرجعة lock-screen pass updates (data-only), customer d-8 follow-up.
  ...RAJAA_PASS_EVENTS,
  'seat.completed',
  'khat.child_tapped_out',
  'khat.sweep_missed',
  'dispatch.offer_sent',
  'dispatch.wave_sent',
  'dispatch.zone_nudged',
  // Ride step 3 (n4): the waiting rider tapped «نبّهه» on a driver his ride was sent to.
  'dispatch.offer_nudged',
  // Joy h2: a dish people follow is today's pot.
  'catalog.pot_posted',
  'session.signed_out',
  // Joy w4 / w6: the payer is asked; «شهرك» is ready on the 1st.
  'org.payer_approval_requested',
  'insights.month_ready',
  // Joy r5: «تأكد رحلتك؟» the evening before (or that morning) a regular trip.
  'regular_trip.due',
  // Step 4: half an hour before a ride booked for later (c10); «نفس مشوار البارحة؟» (o4).
  'order.ride_reminder',
  // Taxi ideas x3 / x4: the taxi to his الرجعة car is late; the taxi waiting at the garage booked,
  // dropped (trip cancelled) or not bookable.
  ...Object.values(GARAGE_TAXI_EVENTS),
  'same_ride.due',
  // Review #28: rides booked for later, offered to drivers the evening before.
  ...BOOKED_RIDE_EVENTS,
] as const;

export interface NotifySubscriberDeps {
  engine: Pick<NotifyEngine, 'dispatch'>;
  repo: Pick<NotifyRepository, 'deleteSessionTokens'>;
  lookups: NotifyLookups;
  /** Public base of the receipt links in WhatsApp receipts (`https://driver.iq/r/`). */
  receiptBaseUrl: string;
  /** The merchant app's web address (`MERCHANT_APP_URL`); the activation SMS links to its `/setup`. Unset = no link. */
  merchantAppUrl?: string | null;
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

/**
 * s2 «وصل بالسلامة»: a city ride that ended at night (`isNightAt` of its completion) reaches each
 * trusted person of the rider who has the app, when the rider turned «بلّغهم من أوصل» on — the same
 * switch as الرجعة's. A push to their own account only: nothing goes to a number outside the app, and
 * it names the rider and the time, never where he went.
 */
async function safeArrival(deps: NotifySubscriberDeps, e: PublishedEvent, order: OrderFacts): Promise<NotifyRequest[]> {
  const L = deps.lookups;
  if (!isNightAt(e.occurredAt) || !L.safety || !L.trustedAccounts) return [];
  const riderId = order.riderId ?? order.customerId;
  const safety = await L.safety(riderId);
  if (!safety?.prefs.notifyOnArrival || safety.contacts === 0) return [];
  const accounts = await L.trustedAccounts(riderId, 'notify_ride_safe_arrival');
  if (accounts.length === 0) return [];
  const name = (await L.firstName(riderId, 'notify_ride_safe_arrival')) ?? t('push.ride_safe_arrival.someone');
  const params = { name, time: localTime(e.occurredAt) };
  return accounts.map((to) => ({ eventId: e.id, template: 'ride_safe_arrival' as const, to, params }));
}

/**
 * c9 «لمنو المشوار؟»: once a driver takes a ride booked for someone else, the rider gets who is coming —
 * the booker's name, the driver, the car and the plate — and the live link, by SMS (and a push when the
 * number has the app). A night ride's start code (s1) goes in too: the rider is the one who reads it out.
 */
async function rideForRider(deps: NotifySubscriberDeps, e: PublishedEvent, order: OrderFacts, driver: string): Promise<NotifyRequest[]> {
  const L = deps.lookups;
  const riderId = order.riderId;
  if (!riderId || !L.shareLink) return [];
  const tripId = str(e.payload['tripId']);
  const [link, booker, car, code] = await Promise.all([
    L.shareLink(riderId, { orderId: order.id }),
    L.firstName(order.customerId, 'notify_ride_for_rider'),
    tripId && L.driverCar ? L.driverCar(tripId, e.actorId) : null,
    L.startCode ? L.startCode(order.id) : null,
  ]);
  if (!link) return [];
  const params = { booker: booker ?? t('push.ride_for_rider.someone'), driver, car: car?.car ?? t('ride.vehicle_taxi'), plate: car?.plate ?? '—', link, orderId: order.id, ...(code ? { code } : {}) };
  return [{ eventId: e.id, template: 'ride_for_rider', to: riderId, orderId: order.id, params, data: { orderId: order.id } }];
}

/** s3: the booker followed the ride to the end — «مشوار ماما وصل بالسلامة» (the receipt stays his alone: he paid). */
async function riderArrived(deps: NotifySubscriberDeps, e: PublishedEvent, order: OrderFacts): Promise<NotifyRequest[]> {
  if (!order.riderId || !deps.lookups.riderName) return [];
  const name = await deps.lookups.riderName(order.id);
  if (!name) return [];
  return [{ eventId: e.id, template: 'ride_rider_arrived', to: order.customerId, orderId: order.id, params: { name, time: localTime(e.occurredAt), orderId: order.id }, data: { orderId: order.id } }];
}

/** The dedupe event id of the «قدر اليوم» push: one per person per Baghdad day, whichever kitchen. */
export function dishPotEventId(localDate: string): string {
  return `dish_pot:${localDate}`;
}

/** Turns one event into the notifications it implies. Exported for tests. */
export async function requestsFor(e: PublishedEvent, deps: NotifySubscriberDeps): Promise<NotifyRequest[]> {
  const passUpdates = await passUpdatesFor(e, deps.lookups);
  const booked = await bookedRideRequests(e, deps.lookups);
  return [...passUpdates, ...booked, ...(await messagesFor(e, deps))];
}

/** "5 الصبح" today, "باچر 5 الصبح" another day: a booked time nobody can read as the other half of the day. */
export function bookedWhen(at: Date, now: Date): string {
  const hour = formatHourPart(at);
  return cityDayDiff(at, now) === 0 ? hour : `${formatDay(at, now)} ${hour}`;
}

/**
 * Review #28, rides booked for later. The rider: «سايقك محجوز: حسين» when a driver confirms, a calm
 * «بعدنا ندوّرلك سايق» when nobody did by the deadline, and when the confirmed driver drops it — all
 * order updates held through quiet hours (the template's rule). Drivers: the favourite's own offer, the
 * best-placed fitting drivers once it opens to all (held through quiet hours), the reminder an hour
 * before and a cancellation of a job he holds (sent at any hour). Pushes name zones and times only.
 */
export async function bookedRideRequests(e: PublishedEvent, L: Pick<NotifyLookups, 'order' | 'firstName' | 'tripZones'>): Promise<NotifyRequest[]> {
  if (!(BOOKED_RIDE_EVENTS as readonly string[]).includes(e.type)) return [];
  const p = e.payload;
  const base = { eventId: e.id };
  const orderId = str(p['orderId']);
  const at = str(p['scheduledFor']);
  if (!orderId || !at || Number.isNaN(Date.parse(at))) return [];
  const when = bookedWhen(new Date(at), e.occurredAt);
  const driverId = str(p['driverId']);
  const toRider = async (template: 'booked_ride_confirmed' | 'booked_ride_unconfirmed' | 'booked_ride_released' | 'booked_ride_searching'): Promise<NotifyRequest[]> => {
    const order = await L.order(orderId);
    if (!order) return [];
    const driver = driverId ? ((await L.firstName(driverId, 'notify_booked_ride')) ?? 'السايق') : '';
    return [{ ...base, template, to: order.customerId, orderId, params: { driver, when, orderId }, data: { orderId } }];
  };
  const zones = async () => (e.tripId ? await L.tripZones(e.tripId) : null) ?? { pickup: '', dropoff: '' };
  switch (e.type) {
    case 'dispatch.booked_confirmed':
      return toRider('booked_ride_confirmed');
    case 'dispatch.booked_unconfirmed':
      return toRider('booked_ride_unconfirmed');
    case 'dispatch.booked_released':
      return toRider('booked_ride_released');
    case 'dispatch.booked_search_started':
      return toRider('booked_ride_searching');
    case 'dispatch.booked_offered':
    case 'dispatch.booked_opened': {
      const ids = Array.isArray(p['driverIds']) ? p['driverIds'].filter((x): x is string => typeof x === 'string') : [];
      const by = str(p['confirmBy']);
      if (ids.length === 0) return [];
      const z = await zones();
      const template = e.type === 'dispatch.booked_offered' ? ('partner_booked_favourite' as const) : ('partner_booked_offer' as const);
      const params = { when, pickup: z.pickup, dropoff: z.dropoff, deadline: by && !Number.isNaN(Date.parse(by)) ? formatHourPart(new Date(by)) : '' };
      return [...new Set(ids)].map((to) => ({ ...base, template, to, params, data: { tripId: e.tripId ?? '' } }));
    }
    case 'dispatch.booked_reminder': {
      const show = str(p['showBy']);
      if (!driverId || !show || Number.isNaN(Date.parse(show))) return [];
      return [{ ...base, template: 'partner_booked_reminder', to: driverId, params: { when, showBy: formatHourPart(new Date(show)) }, data: { tripId: e.tripId ?? '' } }];
    }
    case 'dispatch.booked_cancelled':
      return driverId ? [{ ...base, template: 'partner_booked_cancelled', to: driverId, params: { when }, data: { tripId: e.tripId ?? '' } }] : [];
    default:
      return [];
  }
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
    case 'order.rejected': {
      // «المطعم ما گدر ياخذ طلبك» / «المطعم ما رد»: told at once, with the way on. M-17: a kitchen that
      // cancels after accepting pays him `customerCreditIqd` (500) — the ledger posts it with this event.
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order || order.type === 'ride') return [];
      const merchant = order.merchantOrgId ? ((await L.storeName(order.merchantOrgId)) ?? 'المطعم') : 'المطعم';
      const credit = num(p['customerCreditIqd']) ?? 0;
      if (credit > 0) return [{ ...base, template: 'order_rejected_credit', to: order.customerId, orderId: order.id, params: { merchant, amount: iqd(credit), orderId: order.id }, data: { orderId: order.id } }];
      const template = p['reason'] === 'merchant_timeout' ? ('order_kitchen_no_answer' as const) : ('order_rejected' as const);
      return [{ ...base, template, to: order.customerId, orderId: order.id, params: { merchant, orderId: order.id }, data: { orderId: order.id } }];
    }
    case 'order.partial_proposed': {
      // «بيبسي خلص بمطعم خالد — نرسل الباقي بـ 11,500 دينار، لو تلغي ببلاش؟» (BENCH-03). Opens the
      // kitchen screen, where he answers; the minute is the kitchen's wait, so nothing is held.
      const order = e.orderId ? await L.order(e.orderId) : null;
      const reduced = num(p['reducedTotalIqd']);
      const lineIds = Array.isArray(p['unavailableLineIds']) ? p['unavailableLineIds'].filter((x): x is string => typeof x === 'string') : [];
      if (!order || order.type === 'ride' || reduced === null || lineIds.length === 0) return [];
      const [merchant, names] = await Promise.all([order.merchantOrgId ? L.storeName(order.merchantOrgId) : Promise.resolve(null), L.lineNames ? L.lineNames(order.id, lineIds) : Promise.resolve([])]);
      return [{ ...base, template: 'order_partial_ask', to: order.customerId, orderId: order.id, params: { items: missingItemsAr(names, lineIds.length), merchant: merchant ?? 'المطعم', amount: iqd(reduced), orderId: order.id }, data: { orderId: order.id } }];
    }
    case 'order.cancelled': {
      // Only what we cancelled: his own cancel needs no message. The household payer's answer (or the
      // lack of one) is named; anything else is the calm «آسفين، انلغى طلبك» with the details in the app.
      if (p['cancelledState'] !== 'platform_cancelled') return [];
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order) return [];
      const template =
        p['reason'] === 'payer_declined'
          ? ('order_payer_declined' as const)
          : p['reason'] === 'payer_no_answer'
            ? ('order_payer_no_answer' as const)
            : p['reason'] === 'partial_timeout'
              ? ('order_partial_no_answer' as const)
              : ('order_cancelled' as const);
      return [{ ...base, template, to: order.customerId, orderId: order.id, params: { orderId: order.id }, data: { orderId: order.id } }];
    }
    case 'order.picked_up': {
      // «حيدر استلم طلبك ويوصلك الساعة 8:40» — the order screen's own ETA; without one, no time at all.
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order || order.type === 'ride') return [];
      const [courier, eta] = await Promise.all([L.firstName(e.actorId, 'notify_order_picked_up'), L.deliveryEta ? L.deliveryEta(order.id, e.occurredAt) : null]);
      const params = { courier: courier ?? 'الدليفري', orderId: order.id, ...(eta ? { time: localTime(eta) } : {}) };
      return [{ ...base, template: eta ? 'order_picked_up' : 'order_on_the_way', to: order.customerId, orderId: order.id, params, data: { orderId: order.id } }];
    }
    case 'trip.unreachable_started':
    case 'trip.unreachable_escalated': {
      // NTF-03: the 5-minute clock at the door is never silent — push + WhatsApp at once (SMS when neither
      // lands), then «باقي دقيقتين» at minute 3. The minute-3 event names the stop only.
      const stopId = str(p['stopId']);
      const orderId = e.orderId ?? (e.tripId && stopId && L.stopOrder ? await L.stopOrder(e.tripId, stopId) : null);
      const order = orderId ? await L.order(orderId) : null;
      if (!order || order.type === 'ride') return [];
      if (e.type === 'trip.unreachable_escalated') {
        return [{ ...base, template: 'courier_unreachable_reminder', to: order.customerId, orderId: order.id, params: { orderId: order.id }, data: { orderId: order.id } }];
      }
      const courier = (await L.firstName(e.actorId, 'notify_courier_unreachable')) ?? 'الدليفري';
      return [{ ...base, template: 'courier_unreachable', to: order.customerId, orderId: order.id, params: { courier, orderId: order.id }, data: { orderId: order.id } }];
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
      // NTF-21: «جهّز الكاش» only when he pays cash at the door; a paid order hears the same moment without it.
      const params = { name: name ?? '', courier: courier ?? 'الدليفري', merchant: merchant ?? 'درايفر', orderId: order.id };
      const paid = order.paymentMethod !== undefined && order.paymentMethod !== 'cash';
      return [
        paid
          ? { ...base, template: 'courier_arriving_paid', to: order.customerId, orderId: order.id, params, data: { orderId: order.id } }
          : { ...base, template: 'courier_arriving', to: order.customerId, orderId: order.id, params: { ...params, amount: iqd(order.totalIqd) }, data: { orderId: order.id } },
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
      const own: NotifyRequest = { ...base, template: 'ride_receipt', to: order.customerId, orderId: order.id, params: { amount: iqd(order.totalIqd), driver, receiptUrl: receipt(order.id), orderId: order.id }, data: { orderId: order.id } };
      return [own, ...(await safeArrival(deps, e, order)), ...(await riderArrived(deps, e, order))];
    }
    case 'stop.driver_near': {
      // d3: «السايق قريب، اطلع هسة» — the orderer, and the rider of a ride booked for him (s3).
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order || order.type !== 'ride') return [];
      const to = [...new Set([order.customerId, ...(order.riderId ? [order.riderId] : [])])];
      return to.map((person) => ({ ...base, template: 'ride_near' as const, to: person, orderId: order.id, params: { orderId: order.id }, data: { orderId: order.id } }));
    }
    case 'order.matched':
    case 'stop.arrived': {
      // J1c f4: "لگينالك سايق: حيدر" when a driver takes the ride; "حيدر وصل" when he is at the pickup.
      // W2 NTF-03: a delivery's courier at the door — «حيدر وصل بطلبك».
      const order = e.orderId ? await L.order(e.orderId) : null;
      if (!order) return [];
      if (e.type === 'stop.arrived' && order.type !== 'ride') {
        if (p['stopType'] !== 'dropoff') return [];
        const courier = (await L.firstName(e.actorId, 'notify_courier_at_door')) ?? 'الدليفري';
        return [{ ...base, template: 'courier_at_door', to: order.customerId, orderId: order.id, params: { courier, orderId: order.id }, data: { orderId: order.id } }];
      }
      if (e.type === 'stop.arrived' && p['stopType'] !== 'pickup') return [];
      if (order.type !== 'ride') return [];
      const driver = (await L.firstName(e.actorId, e.type === 'order.matched' ? 'notify_ride_matched' : 'notify_driver_arrived')) ?? 'السايق';
      const template = e.type === 'order.matched' ? ('ride_matched' as const) : ('driver_arrived' as const);
      const own: NotifyRequest = { ...base, template, to: order.customerId, orderId: order.id, params: { driver, orderId: order.id }, data: { orderId: order.id } };
      // c9: on a ride booked for someone else the rider hears it too — who is coming (SMS + link), then «وصل».
      const rider =
        e.type === 'order.matched'
          ? await rideForRider(deps, e, order, driver)
          : order.riderId
            ? [{ ...base, template, to: order.riderId, orderId: order.id, params: { driver, orderId: order.id }, data: { orderId: order.id } }]
            : [];
      // w9: a night ride (21:00–06:00 Baghdad, `isNightAt`) is shared with the trusted people when the rider asked.
      const shared = e.type === 'order.matched' && isNightAt(e.occurredAt) ? await sharedWithPeople(deps, e, order.customerId, { orderId: order.id }, 'autoShareNight', 'مشوار بالليل') : [];
      return [own, ...rider, ...shared];
    }
    case 'order.driver_cancelled':
    case 'dispatch.free_cancel_available': {
      // NTF-04: «حيدر لغى المشوار، دا ندورلك سايق ثاني» / «ما لگينا سايق هسة: انتظر، الغي ببلاش، أو احجز
      // لوقت ثاني». The orderer, and the rider of a ride booked for someone else. The orderer also hears
      // the credit the ledger posts to his wallet (M-15, after the driver reached the pickup).
      const orderId = e.orderId ?? str(p['orderId']);
      const order = orderId ? await L.order(orderId) : null;
      if (!order || order.type !== 'ride') return [];
      const cancelled = e.type === 'order.driver_cancelled';
      const driver = cancelled ? ((await L.firstName(e.actorId, 'notify_ride_driver_cancelled')) ?? 'السايق') : '';
      const template = cancelled ? ('ride_driver_cancelled' as const) : ('ride_no_driver' as const);
      const creditIqd = cancelled ? (num(p['customerCreditIqd']) ?? 0) : 0;
      return [...new Set([order.customerId, order.riderId].filter((x): x is string => Boolean(x)))].map((to) => {
        const credited = creditIqd > 0 && to === order.customerId;
        return { ...base, template: credited ? ('ride_driver_cancelled_credit' as const) : template, to, orderId: order.id, params: { driver, orderId: order.id, ...(credited ? { amount: iqd(creditIqd) } : {}) }, data: { orderId: order.id } };
      });
    }
    case 'merchant.activated': {
      // «جهّز محلك»: ops approved the shop — each current owner (not the onboarding contact, who may
      // not be one) hears it is live, with the link to finish setting it up.
      const orgId = str(p['merchantOrgId']);
      if (!orgId) return [];
      const [owners, shop] = await Promise.all([L.orgPeople(orgId, MERCHANT_OWNERS), L.storeName(orgId)]);
      const base_ = deps.merchantAppUrl?.trim().replace(/\/+$/, '');
      const next = base_ ? t('sms.merchant_activated_link', { link: `${base_}/setup` }, 'ar-IQ') : t('sms.merchant_activated_app', {}, 'ar-IQ');
      return owners.map((to) => ({ ...base, template: 'merchant_activated' as const, to, params: { shop: shop ?? '', next } }));
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
    case 'org.payer_approval_requested': {
      // «طلب من منار: مطعم خالد · 32,000 دينار» to the payer (joy w4); the name read is logged.
      const payerId = str(p['payerId']);
      const amount = num(p['amountIqd']);
      const orderId = str(p['orderId']);
      if (!payerId || amount === null) return [];
      const name = (await L.firstName(e.actorId, 'notify_household_approval')) ?? 'فرد من العائلة';
      const order = orderId ? await L.order(orderId).catch(() => null) : null;
      const merchant = order?.merchantOrgId ? await L.storeName(order.merchantOrgId) : null;
      return [{ ...base, template: 'household_approval', to: payerId, params: { name, what: merchant ? `${merchant} · ` : '', amount: iqd(amount) }, data: { requestId: str(p['requestId']) ?? '' } }];
    }
    case 'insights.month_ready': {
      // «شهرك» (joy w6): marketing — the engine sends it only with marketing on, outside quiet hours and days.
      const personId = str(p['personId']);
      const month = MonthKey.safeParse(p['month']);
      if (!personId || !month.success) return [];
      return [{ ...base, template: 'month_ready', to: personId, params: { month: month.data } }];
    }
    case 'regular_trip.due': {
      // Joy r5: its own switch, quiet hours and quiet days (the engine); the app still asks when held.
      const personId = str(p['personId']);
      const regularTripId = str(p['regularTripId']);
      const day = str(p['date']);
      const at = str(p['at']);
      if (!personId || !regularTripId || !day || !at || Number.isNaN(Date.parse(at))) return [];
      return [{ ...base, template: 'regular_trip_reminder', to: personId, params: { regularTripId, day, route: str(p['route']) ?? '', time: localTime(new Date(at)) }, data: { regularTripId, date: day } }];
    }
    case 'order.ride_reminder': {
      // Step 4 (c10): «مشوارك 7:00 الصبح» — when the search starts, and that cancelling is still free.
      const customerId = str(p['customerId']);
      const at = str(p['scheduledFor']);
      const searchAt = str(p['searchAt']);
      if (!customerId || !e.orderId || !at || !searchAt || Number.isNaN(Date.parse(at)) || Number.isNaN(Date.parse(searchAt))) return [];
      return [{ ...base, template: 'ride_booked_reminder', to: customerId, orderId: e.orderId, params: { orderId: e.orderId, time: localTime(new Date(at)), search: localTime(new Date(searchAt)) }, data: { orderId: e.orderId } }];
    }
    case GARAGE_TAXI_EVENTS.late: {
      // x3: the rider hears the minutes and that the car's driver knows; the الرجعة driver hears which
      // seat, how late, and that it is our taxi (so he does not count the rider as a no-show yet).
      const riderId = str(p['riderId']);
      const driverId = str(p['driverId']);
      const orderId = str(p['orderId']);
      const departureId = str(p['departureId']);
      const minutes = num(p['lateMin']);
      const at = str(p['expectedAt']);
      if (!riderId || !orderId || !departureId || minutes === null || !at || Number.isNaN(Date.parse(at))) return [];
      const time = localTime(new Date(at));
      const garage = str(p['garageAr']) ?? '';
      const seats = Array.isArray(p['seats']) ? (p['seats'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      const seat = seats.map((id) => t(`seat.${id}` as MessageKey, {}, 'ar-IQ')).join('، ');
      const out: NotifyRequest[] = [{ ...base, template: 'garage_taxi_late', to: riderId, orderId, params: { orderId, minutes: String(minutes), time, garage }, data: { orderId } }];
      if (driverId) out.push({ ...base, template: 'rajaa_rider_taxi_late', to: driverId, params: { departureId, minutes: String(minutes), time, seat }, data: { departureId } });
      return out;
    }
    case GARAGE_TAXI_EVENTS.placed: {
      const riderId = str(p['riderId']);
      const orderId = str(p['orderId']);
      if (!riderId || !orderId) return [];
      return [{ ...base, template: 'garage_taxi_placed', to: riderId, orderId, params: { orderId, garage: str(p['garageAr']) ?? '' }, data: { orderId } }];
    }
    case GARAGE_TAXI_EVENTS.dropped: {
      const riderId = str(p['riderId']);
      const bookingId = str(p['bookingId']);
      if (!riderId || !bookingId) return [];
      return [{ ...base, template: 'garage_taxi_dropped', to: riderId, params: { bookingId }, data: { bookingId } }];
    }
    case GARAGE_TAXI_EVENTS.failed: {
      const riderId = str(p['riderId']);
      if (!riderId) return [];
      return [{ ...base, template: 'garage_taxi_failed', to: riderId, params: { garage: str(p['garageAr']) ?? '' } }];
    }
    case 'same_ride.due': {
      // Step 4 (o4): its own switch (the engine); the job already checked the day, the time and that no
      // ride is on. The link fills choose with the same ends, vehicle and door pickup.
      const personId = str(p['personId']);
      const at = str(p['at']);
      const from = str(p['from']);
      const to = str(p['to']);
      const vertical = p['vertical'] === 'tuktuk' ? 'tuktuk' : p['vertical'] === 'taxi' ? 'taxi' : null;
      if (!personId || !at || Number.isNaN(Date.parse(at)) || !from || !to || !vertical) return [];
      return [
        {
          ...base,
          template: p['afterWeekend'] === true ? 'same_ride_after_weekend' : 'same_ride_offer',
          to: personId,
          params: { route: str(p['route']) ?? '', time: localTime(new Date(at)), from, to, vertical, door: p['doorPickup'] === true ? '1' : '0' },
        },
      ];
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
    case 'order.late_credit': {
      // NTF-22, the honest-delay promise's step two: "+1,000 دينار رصيد، لأن تأخرنا عليك".
      const customerId = str(p['customerId']);
      const amount = num(p['amountIqd']);
      if (!customerId || amount === null || amount <= 0) return [];
      return [{ ...base, template: 'order_late_credit', to: customerId, ...(e.orderId ? { orderId: e.orderId } : {}), params: { amount: `\u2066+${iqd(amount)}\u2069` } }];
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
    case 'order.complimented': {
      // «زينب قالتلك: سريع، مؤدب» (joy l4): the customer's kind words, to the courier who carried it.
      const courierId = str(p['courierId']);
      const customerId = str(p['customerId']);
      const keys = Array.isArray(p['keys']) ? p['keys'].filter((k): k is ComplimentKey => ComplimentKey.safeParse(k).success) : [];
      if (!courierId || !customerId || keys.length === 0) return [];
      const name = await L.firstName(customerId, 'notify_compliment_received');
      const words = keys.map((k) => t(`compliment.${k}`, {}, 'ar-IQ')).join('، ');
      return [{ ...base, template: 'compliment_received', to: courierId, ...(e.orderId ? { orderId: e.orderId } : {}), params: { name: name ?? 'زبون', words, id: e.orderId ? orderTicketNumber(e.orderId) : '' } }];
    }
    case 'support.replied':
    case 'support.resolved':
    case 'support.refunded': {
      // NTF-02: a customer's complaint answered, refunded or closed — the words themselves in the push.
      // A driver's pay query (`driverId`) is answered on the partner side below.
      if (!str(p['driverId'])) {
        const customerId = str(p['customerId']);
        if (!customerId) return [];
        const link = e.orderId ? `order/${e.orderId}` : 'help';
        const data: Record<string, string> = e.orderId ? { orderId: e.orderId } : {};
        const withOrder = e.orderId ? { orderId: e.orderId } : {};
        if (e.type === 'support.refunded') {
          const amount = num(p['amountIqd']);
          if (amount === null || amount <= 0) return [];
          const where = t(p['method'] === 'points' ? 'push.support_refund.points' : 'push.support_refund.wallet', {}, 'ar-IQ');
          return [{ ...base, template: 'support_refund', to: customerId, ...withOrder, params: { amount: iqd(amount), where, link }, data }];
        }
        const text = str(e.type === 'support.replied' ? p['text'] : p['resolution']);
        if (!text) return [];
        const template = e.type === 'support.replied' ? ('support_reply' as const) : ('support_resolved' as const);
        return [{ ...base, template, to: customerId, ...withOrder, params: { text: clip(text), link }, data }];
      }
      if (e.type === 'support.refunded') return [];
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
    case 'dispatch.wave_sent': {
      // A ride's wave offers it to several drivers at once (no per-driver offer_sent): each gets the
      // same «طلب جديد» push, so a driver not looking at the app still hears about it.
      const ids = Array.isArray(p['driverIds']) ? p['driverIds'].filter((x): x is string => typeof x === 'string') : [];
      if (ids.length === 0 || !e.tripId) return [];
      const zones = await L.tripZones(e.tripId);
      const tripId = e.tripId;
      return [...new Set(ids)].map((to) => ({ ...base, template: 'partner_new_job' as const, to, params: { pickup: zones?.pickup ?? '', dropoff: zones?.dropoff ?? '' }, data: { tripId } }));
    }
    case 'dispatch.offer_nudged': {
      // «راكب ينتظرك»: one soft push to the nudged driver (the server allows one per driver per ride).
      const driverId = str(p['driverId']);
      const offerId = str(p['offerId']);
      if (!driverId || !offerId || !e.tripId) return [];
      return [{ ...base, template: 'ride_nudge' as const, to: driverId, params: {}, data: { tripId: e.tripId, offerId } }];
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
