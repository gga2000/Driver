import { describe, expect, it } from 'vitest';
import type { Order, OrderTracking } from '@driver/contracts';
import { createT, formatClock } from '@driver/i18n';
import { FOOD_STEPS, foodStep, liveNoticeCard, liveNoticeId, liveNoticeKey, RIDE_STEPS, stepDots } from './content';

const t = createT('ar-IQ');
const T0 = new Date('2026-10-07T12:00:00Z');
const at = (m: number) => new Date(T0.getTime() + m * 60_000);
const amount = (n: number) => n.toLocaleString('en-US');

function order(patch: Partial<Order> = {}): Order {
  return {
    id: 'ord_1',
    cityId: 'aziziyah',
    type: 'food',
    state: 'placed',
    ordererId: 'c1',
    merchantOrgId: 'rest_1',
    householdOrgId: null,
    quoteId: null,
    paymentMethod: 'cash',
    itemsTotalIqd: 14000,
    deliveryFeeIqd: 1000,
    serviceFeeIqd: 500,
    discountIqd: 0,
    tipIqd: 0,
    totalIqd: 15500,
    minVehicleClass: 'bike',
    cateringRequest: false,
    lines: [],
    participants: [],
    partial: null,
    scheduledFor: null,
    merchantOfferedAt: T0,
    promisedReadyAt: null,
    placedAt: T0,
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
    rating: null,
    ...patch,
  };
}

type Trip = NonNullable<OrderTracking['trip']>;
function trip(state: Trip['state']): Trip {
  return {
    id: 'trp_1',
    state,
    acceptedAt: at(3),
    completedAt: null,
    stops: [
      { id: 's1', seq: 0, type: 'pickup', state: 'pending', mine: true, target: null, courierNearAt: null, arrivedAt: null, completedAt: null },
      { id: 's2', seq: 1, type: 'dropoff', state: 'pending', mine: true, target: null, courierNearAt: null, arrivedAt: null, completedAt: null },
    ],
    dropsBeforeMine: 0,
    unreachable: null,
  };
}
const courier = { firstName: 'حيدر', vehicleClass: 'bike' as const, plate: 'واسط 12345', vehicleLabel: null, rating: null, ratingCount: 0, verifiedTodayAt: T0, photoUrl: null };

function view(o: Partial<Order> = {}, patch: Partial<OrderTracking> = {}): OrderTracking {
  return { order: order(o), items: [], merchant: { id: 'rest_1', name: 'مطعم خالد', pin: null }, dropoff: null, trip: null, courier: null, reassigning: false, promisedAt: null, pointsEarned: null, serverNow: T0, ...patch };
}
const card = (v: OrderTracking, eta: Date | null = null) => liveNoticeCard(v, { eta, now: T0.getTime(), t, amount });

describe('the live order on the lock screen (joy l1)', () => {
  it('dots count real steps only', () => {
    expect(stepDots(3, 6)).toBe('●●●○○○');
    expect(stepDots(9, 4)).toBe('●●●●');
    expect(foodStep(view())).toBe(1);
    expect(foodStep(view({ state: 'merchant_accepted', acceptedAt: at(1) }))).toBe(2);
    expect(foodStep(view({ state: 'preparing', acceptedAt: at(1), preparingAt: at(2) }))).toBe(3);
    expect(foodStep(view({ state: 'ready', acceptedAt: at(1), readyAt: at(12) }))).toBe(4);
    expect(foodStep(view({ state: 'picked_up', acceptedAt: at(1), pickedUpAt: at(15) }, { trip: trip('in_transit'), courier }))).toBe(5);
    expect(foodStep(view({ state: 'picked_up', acceptedAt: at(1), pickedUpAt: at(15) }, { trip: trip('arrived_dropoff'), courier }))).toBe(6);
  });

  it('food while cooking: the status line, the kitchen and the ETA, sticky', () => {
    const c = card(view({ state: 'preparing', acceptedAt: at(1), preparingAt: at(2) }), at(25))!;
    expect(c).toMatchObject({ id: liveNoticeId('ord_1'), sticky: true, sub: '●●●○○○', deepLink: 'driver://order/ord_1' });
    expect(c.title).toBe(t('order.status.preparing'));
    expect(c.body).toBe(`مطعم خالد · ${t('live_notice.eta', { time: formatClock(at(25)) })}`);
    expect(FOOD_STEPS).toBe(6);
  });

  it('on the way the kitchen drops out; at the door it says the cash to have ready', () => {
    const onWay = card(view({ state: 'picked_up', acceptedAt: at(1), pickedUpAt: at(15) }, { trip: trip('in_transit'), courier }), at(30))!;
    expect(onWay.body).toBe(t('live_notice.eta', { time: formatClock(at(30)) }));
    const door = card(view({ state: 'picked_up', acceptedAt: at(1), pickedUpAt: at(15) }, { trip: trip('arrived_dropoff'), courier }))!;
    expect(door.title).toBe(t('track.courier_at_door'));
    expect(door.body).toBe(t('track.cash_ready', { amount: '15,500' }));
    expect(door.sub).toBe('●●●●●●');
  });

  it('a past ETA is not shown', () => {
    expect(card(view({ state: 'preparing', acceptedAt: at(1), preparingAt: at(2) }), at(-5))!.body).toBe('مطعم خالد');
  });

  it('rides: the car and plate while he comes, the ETA on the trip', () => {
    const r = (state: Trip['state'], patch: Partial<OrderTracking> = {}) => view({ type: 'ride', state: 'matched', merchantOrgId: null }, { merchant: null, trip: trip(state), courier: { ...courier, vehicleLabel: 'تويوتا كورولا · أبيض' }, serverNow: at(10), ...patch });
    expect(card(r('en_route_to_pickup'))).toMatchObject({ body: 'تويوتا كورولا · أبيض · واسط 12345', sub: '●●○○', sticky: true });
    expect(card(r('arrived_pickup'))!.sub).toBe('●●●○');
    expect(card(r('in_transit'), at(20))!.body).toBe(t('live_notice.eta_ride', { time: formatClock(at(20)) }));
    expect(RIDE_STEPS).toBe(4);
  });

  it('delivered: one dismissible card asking for the rating; ended orders have none', () => {
    const end = card(view({ state: 'delivered', acceptedAt: at(1), pickedUpAt: at(15), deliveredAt: at(30) }, { courier, trip: trip('completed') }))!;
    expect(end).toMatchObject({ sticky: false, sub: null, body: t('live_notice.rate', { name: 'حيدر' }) });
    expect(card(view({ state: 'customer_cancelled' }))).toBeNull();
    expect(card(view({ state: 'closed', deliveredAt: at(30) }))).toBeNull();
  });

  it('the key changes only when the words do', () => {
    const v = view({ state: 'preparing', acceptedAt: at(1), preparingAt: at(2) });
    expect(liveNoticeKey(card(v, at(25))!)).toBe(liveNoticeKey(card(v, at(25))!));
    expect(liveNoticeKey(card(v, at(25))!)).not.toBe(liveNoticeKey(card(v, at(30))!));
  });
});
