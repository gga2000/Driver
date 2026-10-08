import type {
  BoardSeat,
  BookingView,
  CorridorView,
  DemandPostView,
  DepartureCard,
  DepartureSummary,
  DriverBookingRow,
  DriverDepartureView,
  GarageView,
  PickupView,
  PrepayRail,
  RequestOfferDriver,
  RequestPostView,
  TravellingAs,
} from '@driver/contracts';
import { haversineMeters } from '../trips/index.js';
import type { DeparturesService } from './departures.service.js';
import type { CorridorConfig, GarageConfig } from './intercity.config.js';
import { riderMeterMinutes, riderMeterStart } from './late-meter.js';
import {
  bookingTotal,
  LIVE,
  type BookingRecord,
  type DemandPostRecord,
  type DepartureRecord,
  type PickupRecord,
  type RequestRecord,
} from './model.js';
import { adjacencyViolation, hasFrontSeat, seatsOf } from './seat-map.js';

/** Wire views of the routes records (contracts `routes-io.ts`). Pure apart from reading the clock and config through `DeparturesService`. */

export function garageView(g: GarageConfig): GarageView {
  return {
    id: g.id,
    cityId: g.cityId,
    nameAr: g.nameAr,
    nameEn: g.nameEn,
    lat: g.lat,
    lng: g.lng,
    geofenceM: g.geofenceM,
    draft: g.draft,
  };
}

export function corridorView(c: CorridorConfig): CorridorView {
  return {
    id: c.id,
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    primary: c.primary,
    cityId: c.cityId,
    seatPriceIqd: c.seatPriceIqd,
    frontPremiumIqd: c.frontPremiumIqd,
    travelMin: c.travelMin,
    placeholderPrice: c.placeholderPrice,
    meetingPoints: c.meetingPoints.map((m) => ({
      id: m.id,
      corridorId: c.id,
      nameAr: m.nameAr,
      nameEn: m.nameEn,
      lat: m.lat,
      lng: m.lng,
      feeIqd: m.feeIqd,
      photoUrl: m.photoUrl,
      draft: m.draft,
    })),
    checkpoints: c.checkpoints.map((k) => ({ id: k.id, nameAr: k.nameAr, lat: k.lat, lng: k.lng, draft: k.draft })),
  };
}

export function pickupView(
  p: PickupRecord,
  s: DeparturesService,
  dep: DepartureRecord,
): PickupView {
  let nameAr: string | null = null;
  if (p.kind === 'garage') nameAr = s.garage(dep.garageId).nameAr;
  if (p.kind === 'meeting_point')
    nameAr =
      s.corridor(dep.corridorId).meetingPoints.find((m) => m.id === p.meetingPointId)?.nameAr ??
      null;
  return {
    kind: p.kind,
    meetingPointId: p.meetingPointId,
    nameAr,
    lat: p.lat,
    lng: p.lng,
    note: p.note,
    feeIqd: p.feeIqd,
    status: p.status,
    detourMin: p.detourMin,
  };
}

export function prepayRail(b: BookingRecord): PrepayRail | null {
  if (!b.payment) return null;
  if (b.prepaid) return 'wallet';
  return b.trusted ? 'trusted_cash' : 'cash_reservation';
}

export function departureSummary(s: DeparturesService, dep: DepartureRecord): DepartureSummary {
  return {
    id: dep.id,
    corridorId: dep.corridorId,
    cityId: s.corridor(dep.corridorId).cityId,
    direction: dep.direction,
    garageId: dep.garageId,
    departAt: dep.departAt,
    latestDepartureAt: dep.latestDepartureAt,
    state: dep.state,
    departedAt: dep.departedAt,
    vehicle: { ...dep.vehicle, layout: dep.layout },
    driverId: dep.driverId,
  };
}

/** The board card: seats as the SeatMap draws them, fill, front-seat status; `viewer` marks seats it can't take. */
export function departureCard(
  s: DeparturesService,
  dep: DepartureRecord,
  bookings: readonly BookingRecord[],
  viewer?: TravellingAs,
): DepartureCard {
  const now = s.now();
  const occ = s.occupants(dep, bookings, now);
  const state = new Map<string, BoardSeat['state']>();
  for (const b of bookings)
    if (s.occupies(b, now))
      for (const id of b.seatIds) state.set(id, b.state === 'held' ? 'held' : 'taken');
  for (const w of dep.walkUps) state.set(w.seatId, 'walkup');
  const seats: BoardSeat[] = seatsOf(dep.layout).map((id) => {
    const st = state.get(id) ?? 'free';
    let blocked: BoardSeat['blocked'] = null;
    if (st === 'free' && viewer) {
      if (dep.familyOnly && viewer !== 'aila') blocked = 'family_only';
      else if (
        adjacencyViolation(dep.layout, [
          ...occ,
          { seatId: id, groupId: '__viewer__', travellingAs: viewer },
        ])
      )
        blocked = 'adjacency';
    }
    return { id, state: st, premiumIqd: id === 'front' ? dep.frontPremiumIqd : 0, blocked };
  });
  const corridor = s.corridor(dep.corridorId);
  const door = s.doorLoad(bookings, now);
  return {
    id: dep.id,
    corridorId: dep.corridorId,
    direction: dep.direction,
    garageId: dep.garageId,
    fromCityId: dep.fromCityId,
    toCityId: dep.toCityId,
    driverId: dep.driverId,
    vehicle: { ...dep.vehicle, layout: dep.layout },
    departAt: dep.departAt,
    latestDepartureAt: dep.latestDepartureAt,
    state: dep.state,
    familyOnly: dep.familyOnly,
    seatPriceIqd: dep.seatPriceIqd,
    frontPremiumIqd: dep.frontPremiumIqd,
    seats,
    fill: s.fill(dep, bookings, now),
    frontSeat: hasFrontSeat(dep.layout) ? (state.get('front') ?? 'free') : 'none',
    doorPickupsLeft: Math.max(0, s.rules.door.maxPerDeparture - door.count),
    meetingPoints: corridorView(corridor).meetingPoints,
  };
}

export function bookingView(
  s: DeparturesService,
  b: BookingRecord,
  dep: DepartureRecord,
  owner: boolean,
  pointsEarned: number | null = null,
): BookingView {
  return {
    id: b.id,
    departureId: b.departureId,
    riderId: b.riderId,
    state: b.state,
    origin: b.origin,
    seatIds: b.seatIds,
    travellingAs: b.travellingAs,
    seatPriceIqd: b.seatPriceIqd,
    frontPremiumIqd: b.frontPremiumIqd,
    pickupFeeIqd: b.pickupFeeIqd,
    totalIqd: bookingTotal(b),
    payment: b.payment,
    prepaid: b.prepaid,
    prepayRail: prepayRail(b),
    heldUntil: b.heldUntil,
    pin: owner && LIVE.includes(b.state) ? b.pin : null,
    pickup: pickupView(b.pickup, s, dep),
    largeBags: b.largeBags,
    movedToBookingId: b.movedToBookingId,
    movedFromBookingId: b.movedFromBookingId,
    checkedInAt: b.checkedInAt,
    lateMinutes: b.lateMinutes,
    departure: departureSummary(s, dep),
    createdAt: b.createdAt,
    completedAt: b.completedAt,
    // The rider sees his own line as he wrote it, hidden or not.
    rating: b.rating ? { ...b.rating, comment: b.review?.text ?? null } : null,
    pointsEarned,
  };
}

export function driverDepartureView(
  s: DeparturesService,
  dep: DepartureRecord,
  bookings: readonly BookingRecord[],
): DriverDepartureView {
  const now = s.now();
  const card = departureCard(s, dep, bookings);
  const rows: DriverBookingRow[] = bookings
    .filter((b) => LIVE.includes(b.state) || b.state === 'completed' || b.state === 'no_show')
    .map((b) => ({
      bookingId: b.id,
      riderId: b.riderId,
      seatIds: b.seatIds,
      state: b.state,
      travellingAs: b.travellingAs,
      payment: b.payment,
      prepaid: b.prepaid,
      prepayRail: prepayRail(b),
      totalIqd: bookingTotal(b),
      pickup: pickupView(b.pickup, s, dep),
      largeBags: b.largeBags,
      atGarage: b.atGarageAt !== null,
      checkedInAt: b.checkedInAt,
      meterMinutes: b.state === 'booked' ? riderMeterMinutes(dep, bookings, b, now) : b.lateMinutes,
      canNoShow: s.noShowVerdict(dep, bookings, b, now) !== null,
      taxiDueAt: b.state === 'booked' ? (b.taxiLateUntil ?? null) : null,
      seatHeld: b.state === 'booked' && (s.seatHeldUntil(dep, b)?.getTime() ?? 0) > now.getTime(),
    }));
  const open = dep.state === 'scheduled' || dep.state === 'boarding';
  const g = s.garage(dep.garageId);
  return {
    ...card,
    bookings: rows,
    walkUps: dep.walkUps.map((w) => ({ seatId: w.seatId, travellingAs: w.travellingAs })),
    selfieAt: dep.selfieAt,
    driverCheckedInAt: dep.driverCheckIn?.at ?? null,
    driverInsideGarage: dep.lastPosition
      ? haversineMeters(dep.lastPosition, g) <= g.geofenceM
      : null,
    departBlockers: open ? s.departBlockers(dep, bookings, now) : [],
    departedAt: dep.departedAt,
    arrivedAt: dep.arrivedAt,
    cancelReason: dep.cancelReason,
  };
}

/** Grace end on the rider's meter: meter start + grace (null when no meter applies). */
export function graceEndsAt(
  s: DeparturesService,
  dep: DepartureRecord,
  bookings: readonly BookingRecord[],
  b: BookingRecord,
): Date | null {
  const start = riderMeterStart(dep, bookings, b);
  return start ? new Date(start.getTime() + s.money.lateMeter.graceMin * 60_000) : null;
}

export function demandView(p: DemandPostRecord): DemandPostView {
  return {
    id: p.id,
    riderId: p.riderId,
    corridorId: p.corridorId,
    direction: p.direction,
    garageId: p.garageId,
    pickupKind: p.pickup.kind,
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
    seats: p.seats,
    travellingAs: p.travellingAs,
    state: p.state,
    bookingId: p.bookingId,
    createdAt: p.createdAt,
  };
}

/** `viewerDriverId`: a driver sees only his own offer among the others' (prices are not shown to rivals). */
/**
 * A request as its rider (or, with `viewerDriverId`, one offering driver) sees it. `drivers` carries
 * the offering drivers' cards for the rider (R-01); without it every offer's `driver` is null.
 */
export function requestView(r: RequestRecord, viewerDriverId?: string, drivers?: ReadonlyMap<string, RequestOfferDriver>): RequestPostView {
  const offers = viewerDriverId ? r.offers.filter((o) => o.driverId === viewerDriverId) : r.offers;
  return {
    id: r.id,
    riderId: r.riderId,
    from: r.from,
    to: r.to,
    when: r.when,
    seats: r.seats,
    privateCar: r.privateCar,
    travellingAs: r.travellingAs,
    note: r.note,
    details: r.details,
    // y4: only the rider learns how many drivers opened it.
    seenBy: viewerDriverId ? 0 : r.seenDriverIds.length,
    state: r.state,
    origin: r.origin,
    priceCapIqd: r.priceCapIqd,
    offers: offers.map((o) => ({
      id: o.id,
      driverId: o.driverId,
      priceIqd: o.priceIqd,
      at: o.at,
      state: o.state,
      driver: drivers?.get(o.driverId) ?? null,
    })),
    pickedOfferId: r.pickedOfferId,
    depositIqd: r.depositIqd,
    createdAt: r.createdAt,
  };
}
