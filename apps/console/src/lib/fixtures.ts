import type { BoardCard, BoardOffer, Order, OrderLine, Participant, Stop, Trip } from '@driver/contracts';

/** Test fixtures for the pure helpers (not imported by app code). */

export function card(p: Partial<BoardCard> & { tripId: string }): BoardCard {
  return {
    vertical: 'food',
    zoneId: 'centre',
    policy: 'smart_broadcast',
    status: 'searching',
    status_ar: 'دا ندوّر سايق',
    wave: 1,
    pass: 0,
    elapsedSec: 10,
    countdownSec: 20,
    red: false,
    compensationLabel_ar: null,
    customerMayCancelFree: false,
    assignedDriverId: null,
    suggestion: [],
    offers: [],
    ...p,
  };
}

export function offer(p: Partial<BoardOffer> & { driverId: string }): BoardOffer {
  return { offerId: `o-${p.driverId}`, wave: 1, pass: 0, state: 'sent', compensationIqd: 0, expiresInSec: 12, ...p };
}

const D = new Date('2026-10-03T10:00:00Z');

export function stop(p: Partial<Stop> & { id: string; seq: number }): Stop {
  return {
    tripId: 't1',
    orderId: null,
    type: 'pickup',
    state: 'pending',
    placeId: null,
    meetingPointId: null,
    zoneKey: 'centre',
    target: null,
    windowStart: null,
    windowEnd: null,
    geofenceEnteredAt: null,
    arrivedAt: null,
    arrivedOutsideGeofence: false,
    arrivalDistanceM: null,
    completedAt: null,
    skippedAt: null,
    skipReason: null,
    handoverProof: {},
    childName: null,
    childTapInAt: null,
    childTapOutAt: null,
    ...p,
  };
}

export function trip(p: Partial<Trip> & { id: string }): Trip {
  return {
    cityId: 'aziziyah',
    vertical: 'food',
    state: 'en_route_to_pickup',
    courierId: null,
    vehicleId: null,
    quoteId: null,
    batchId: null,
    offeredAt: null,
    acceptedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    unreachable: null,
    stops: [],
    orders: [],
    createdAt: D,
    updatedAt: D,
    ...p,
  };
}

export function line(p: Partial<OrderLine> & { id: string }): OrderLine {
  return {
    catalogItemId: null,
    freeText: 'تكة',
    qty: 1,
    unitPriceIqd: 1000,
    modifiers: [],
    participantId: null,
    note: null,
    pointsEligible: true,
    availability: 'available',
    ...p,
  };
}

export function participant(p: Partial<Participant> & { id: string }): Participant {
  return { role: 'diner', personId: null, phoneOnly: true, label: null, note: null, ...p };
}

export function order(p: Partial<Order> & { id: string }): Order {
  return {
    cityId: 'aziziyah',
    type: 'food',
    state: 'placed',
    ordererId: 'person-1',
    merchantOrgId: 'merchant-1',
    householdOrgId: null,
    quoteId: null,
    paymentMethod: 'cash',
    itemsTotalIqd: 0,
    deliveryFeeIqd: 0,
    serviceFeeIqd: 0,
    discountIqd: 0,
    tipIqd: 0,
    totalIqd: 0,
    minVehicleClass: null,
    cateringRequest: false,
    lines: [],
    participants: [],
    partial: null,
    scheduledFor: null,
    merchantOfferedAt: null,
    promisedReadyAt: null,
    placedAt: D,
    acceptedAt: null,
    preparingAt: null,
    readyAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    closedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    cancellationFeeIqd: 0,
    refundState: 'none',
    note: null,
    ...p,
  };
}

export const at = (min: number) => new Date(D.getTime() + min * 60_000);
