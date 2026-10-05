import { ACTIVE_TRIP_STATES, DriverError, orderTicketNumber, SAFETY_RULES, type Order, type SosRole, type SosSubject, type Trip } from '@driver/contracts';
import { BAGHDAD_OFFSET_MIN } from '../../shared/local-time.js';

/**
 * Who is on what (scoring & safety §3: "SOS on every active trip, both sides"). The safety module
 * reads the trip it is about through these narrow reads of the owning modules' public services and
 * decides whether the caller is a party of it and whether it is still going (or ended less than
 * `graceAfterEndMin` ago). Anything else is refused: an SOS names the caller's own trip.
 */
export interface SafetySources {
  order(orderId: string): Promise<Pick<Order, 'id' | 'cityId' | 'type' | 'state' | 'ordererId' | 'deliveredAt' | 'closedAt' | 'cancelledAt'> | null>;
  courierOf(orderId: string): Promise<{ tripId: string; courierId: string } | null>;
  trip(tripId: string): Promise<Pick<Trip, 'id' | 'cityId' | 'vertical' | 'state' | 'courierId' | 'vehicleId' | 'completedAt' | 'cancelledAt' | 'stops'> | null>;
  departure(departureId: string): Promise<{
    id: string;
    driverId: string;
    fromCityId: string;
    toCityId: string;
    state: string;
    departAt: Date;
    arrivedAt: Date | null;
    closedAt: Date | null;
    vehicle: { plate: string; model: string | null };
    lastPosition: { lat: number; lng: number; at: Date } | null;
  } | null>;
  /** Riders of a departure with the booking state. */
  riders(departureId: string): Promise<Array<{ bookingId: string; riderId: string; state: string }>>;
  booking(bookingId: string): Promise<{ id: string; departureId: string; riderId: string; state: string } | null>;
  request(requestId: string): Promise<{
    id: string;
    riderId: string;
    cityId: string | null;
    state: string;
    pickedDriverId: string | null;
    from: string;
    to: string;
    closedAt: Date | null;
  } | null>;
  vehicle(courierId: string, vehicleId: string | null): Promise<{ plate: string; label: string | null } | null>;
  /** The trip's last driver fix (the API's fallback when the pressing phone has no GPS). */
  tripFix(tripId: string): Promise<{ lat: number; lng: number; at: Date } | null>;
}

export interface ResolvedSubject {
  cityId: string;
  role: SosRole;
  tripId: string | null;
  orderId: string | null;
  departureId: string | null;
  counterpartId: string | null;
  label: string;
  vehicle: string | null;
  /**
   * Where the car last was, when the person is in it (the driver, a ride's rider, a departed
   * الرجعة rider): the first position when the phone sends none. Never for a food customer at home.
   */
  carFix: { lat: number; lng: number; at: Date } | null;
}

const MIN_MS = 60_000;
const CANCELLED_ORDER: ReadonlySet<Order['state']> = new Set(['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'failed']);
const CANCELLED_TRIP: ReadonlySet<Trip['state']> = new Set(['driver_cancelled', 'customer_cancelled', 'platform_cancelled', 'failed']);
const LIVE_BOOKING: ReadonlySet<string> = new Set(['booked', 'checked_in', 'completed']);
const LIVE_DEPARTURE: ReadonlySet<string> = new Set(['scheduled', 'boarding', 'departed']);
const LIVE_REQUEST: ReadonlySet<string> = new Set(['matched', 'driver_arrived']);

const CITY_AR: Record<string, string> = { aziziyah: 'العزيزية', baghdad: 'بغداد', kut: 'الكوت' };
const cityAr = (id: string) => CITY_AR[id] ?? id;

/** "7:30", Baghdad local, Western digits. */
export function clockAr(at: Date): string {
  const d = new Date(at.getTime() + BAGHDAD_OFFSET_MIN * MIN_MS);
  const h = d.getUTCHours() % 12 || 12;
  return `${h}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function orderLabel(o: Pick<Order, 'id' | 'type'>, vertical: string | null): string {
  const n = `#${orderTicketNumber(o.id)}`;
  if (o.type === 'ride') return `${vertical === 'tuktuk' ? 'مشوار تكتك' : 'مشوار تكسي'} ${n}`;
  if (o.type === 'food') return `طلب أكل ${n}`;
  return `طلب ${n}`;
}

function tripLabel(t: Pick<Trip, 'vertical'>, order: Pick<Order, 'id' | 'type'> | null): string {
  if (t.vertical === 'khat') return 'خطوط · خط اليوم';
  if (order) return orderLabel(order, t.vertical);
  return t.vertical === 'tuktuk' ? 'مشوار تكتك' : t.vertical === 'taxi' ? 'مشوار تكسي' : 'شغلة توصيل';
}

/** Still going, or ended less than the grace ago; a cancelled trip is over at once. */
function assertLive(ended: Date | null, cancelled: boolean, now: Date): void {
  if (cancelled) throw new DriverError('sos_trip_over');
  if (ended && now.getTime() - ended.getTime() > SAFETY_RULES.graceAfterEndMin * MIN_MS) throw new DriverError('sos_trip_over');
}

/** Resolves an SOS subject for the caller, or throws `sos_not_party` / `sos_trip_over`. */
export async function resolveSubject(src: SafetySources, personId: string, subject: SosSubject, now: Date): Promise<ResolvedSubject> {
  switch (subject.kind) {
    case 'order': {
      const order = await src.order(subject.id);
      if (!order) throw new DriverError('sos_not_party');
      const carried = await src.courierOf(order.id);
      let role: SosRole;
      let counterpartId: string | null;
      if (order.ordererId === personId) [role, counterpartId] = ['customer', carried?.courierId ?? null];
      else if (carried?.courierId === personId) [role, counterpartId] = ['driver', order.ordererId];
      else throw new DriverError('sos_not_party');
      assertLive(order.deliveredAt ?? order.closedAt, CANCELLED_ORDER.has(order.state), now);
      const trip = carried ? await src.trip(carried.tripId) : null;
      const vehicle = trip?.courierId ? await src.vehicle(trip.courierId, trip.vehicleId) : null;
      const inCar = role === 'driver' || order.type === 'ride';
      const carFix = inCar && carried ? await src.tripFix(carried.tripId) : null;
      return { cityId: order.cityId, role, tripId: carried?.tripId ?? null, orderId: order.id, departureId: null, counterpartId, label: orderLabel(order, trip?.vertical ?? null), vehicle: vehicleText(vehicle), carFix };
    }
    case 'trip': {
      const trip = await src.trip(subject.id);
      if (!trip) throw new DriverError('sos_not_party');
      const orderIds = [...new Set(trip.stops.map((s) => s.orderId).filter((id): id is string => Boolean(id)))];
      const firstOrder = orderIds[0] ? await src.order(orderIds[0]) : null;
      let role: SosRole;
      let counterpartId: string | null;
      let orderId: string | null = firstOrder?.id ?? null;
      if (trip.courierId === personId) [role, counterpartId] = ['driver', firstOrder?.ordererId ?? null];
      else {
        // A customer of one of the trip's orders (a ride's rider; one of a batch's customers).
        let mine: string | null = null;
        for (const id of orderIds) {
          const o = id === firstOrder?.id ? firstOrder : await src.order(id);
          if (o?.ordererId === personId) mine = o.id;
        }
        if (!mine) throw new DriverError('sos_not_party');
        [role, counterpartId, orderId] = ['customer', trip.courierId, mine];
      }
      const working = (ACTIVE_TRIP_STATES as readonly string[]).includes(trip.state);
      assertLive(working ? null : (trip.completedAt ?? trip.cancelledAt ?? now), CANCELLED_TRIP.has(trip.state), now);
      const vehicle = trip.courierId ? await src.vehicle(trip.courierId, trip.vehicleId) : null;
      const inCar = role === 'driver' || trip.vertical === 'taxi' || trip.vertical === 'tuktuk';
      const carFix = inCar ? await src.tripFix(trip.id) : null;
      return { cityId: trip.cityId, role, tripId: trip.id, orderId, departureId: null, counterpartId, label: tripLabel(trip, firstOrder), vehicle: vehicleText(vehicle), carFix };
    }
    case 'departure':
    case 'booking': {
      let departureId = subject.id;
      if (subject.kind === 'booking') {
        const b = await src.booking(subject.id);
        if (!b || b.riderId !== personId) throw new DriverError('sos_not_party');
        departureId = b.departureId;
      }
      const dep = await src.departure(departureId);
      if (!dep) throw new DriverError('sos_not_party');
      let role: SosRole;
      let counterpartId: string | null;
      if (dep.driverId === personId) [role, counterpartId] = ['driver', null];
      else {
        const riders = await src.riders(dep.id);
        if (!riders.some((r) => r.riderId === personId && LIVE_BOOKING.has(r.state))) throw new DriverError('sos_not_party');
        [role, counterpartId] = ['customer', dep.driverId];
      }
      const cancelled = dep.state.startsWith('cancelled');
      assertLive(LIVE_DEPARTURE.has(dep.state) ? null : (dep.arrivedAt ?? dep.closedAt ?? now), cancelled, now);
      const label = `الرجعة ${cityAr(dep.fromCityId)} ← ${cityAr(dep.toCityId)} · ${clockAr(dep.departAt)}`;
      const vehicle = [dep.vehicle.model, dep.vehicle.plate].filter(Boolean).join(' · ') || null;
      const carFix = role === 'driver' || dep.state === 'departed' ? dep.lastPosition : null;
      return { cityId: [dep.fromCityId, dep.toCityId].includes('aziziyah') ? 'aziziyah' : dep.fromCityId, role, tripId: null, orderId: null, departureId: dep.id, counterpartId, label, vehicle, carFix };
    }
    case 'request': {
      const req = await src.request(subject.id);
      if (!req) throw new DriverError('sos_not_party');
      let role: SosRole;
      let counterpartId: string | null;
      if (req.riderId === personId) [role, counterpartId] = ['customer', req.pickedDriverId];
      else if (req.pickedDriverId && req.pickedDriverId === personId) [role, counterpartId] = ['driver', req.riderId];
      else throw new DriverError('sos_not_party');
      const done = req.state === 'completed';
      assertLive(LIVE_REQUEST.has(req.state) ? null : done ? (req.closedAt ?? now) : now, !LIVE_REQUEST.has(req.state) && !done, now);
      return { cityId: req.cityId ?? 'aziziyah', role, tripId: null, orderId: null, departureId: null, counterpartId, label: `مشوار خاص ${req.from} ← ${req.to}`, vehicle: null, carFix: null };
    }
  }
}

function vehicleText(v: { plate: string; label: string | null } | null): string | null {
  if (!v) return null;
  return [v.label, v.plate].filter(Boolean).join(' · ') || null;
}
