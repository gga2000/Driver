import type { OrderTracking } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/**
 * Status → timeline mapping for the live screen (spec §4), pure so it is unit-tested. Labels come
 * through the injected `t`, times through `clock` (formatClock on screen), so this file never
 * imports React Native.
 */

export type TFn = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Same shape as @driver/ui `TimelineStep` (kept local so tests stay React-Native-free). */
export interface Step {
  key: string;
  label: string;
  time?: string;
  note?: string;
  late?: boolean;
}

export type Phase =
  | 'waiting_merchant'
  | 'preparing'
  | 'searching'
  | 'reassigning'
  | 'to_pickup'
  | 'at_pickup'
  | 'on_the_way'
  | 'unreachable'
  | 'arrived'
  | 'done'
  | 'cancelled'
  | 'failed'
  | 'disputed';

const CANCELLED = new Set(['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded']);

/** True when the courier started the unreachable protocol at my door and it is still running. */
export function unreachableActive(v: OrderTracking): boolean {
  if (!v.trip?.unreachable) return false;
  const drop = v.trip.stops.find((s) => s.mine && s.type === 'dropoff');
  return !drop || (drop.state !== 'completed' && drop.state !== 'skipped');
}

export function phaseOf(v: OrderTracking): Phase {
  const o = v.order;
  if (CANCELLED.has(o.state)) return 'cancelled';
  if (o.state === 'failed') return 'failed';
  if (o.state === 'disputed') return 'disputed';
  if (o.state === 'closed') return 'done';
  if (o.state === 'delivered' || o.state === 'completed') return 'arrived';
  if (unreachableActive(v)) return 'unreachable';
  if (v.reassigning) return 'reassigning';
  const trip = v.trip;
  if (o.type === 'ride') {
    if (!trip || trip.state === 'created' || trip.state === 'offered' || trip.state === 'declined' || trip.state === 'timed_out') return 'searching';
    if (trip.state === 'arrived_pickup') return 'at_pickup';
    if (trip.state === 'in_transit' || trip.state === 'arrived_dropoff') return 'on_the_way';
    return 'to_pickup';
  }
  if (o.state === 'placed') return 'waiting_merchant';
  if (o.state === 'picked_up') return 'on_the_way';
  // The food is ready and a courier holds the job: say where he is (the kitchen's board already
  // shows "حيدر بالطريق" / "الدليفري وصل"), instead of "ready and waiting for a courier".
  if (o.state === 'ready' && trip) {
    if (trip.state === 'arrived_pickup') return 'at_pickup';
    if (trip.state === 'accepted' || trip.state === 'en_route_to_pickup') return 'to_pickup';
  }
  return 'preparing';
}

export interface TimelineInput {
  eta: Date | null;
  lateMin: number;
  /** Courier/driver first name for notes; falls back to "الدليفري"/"السايق". */
  courierName: string | null;
}

/** The status line of the collapsed sheet. */
export function statusLine(v: OrderTracking, t: TFn): string {
  const ride = v.order.type === 'ride';
  switch (phaseOf(v)) {
    case 'waiting_merchant':
      return t('order.status.placed');
    case 'preparing':
      return v.order.readyAt ? t('order.status.ready') : t('order.status.preparing');
    case 'searching':
      return t('trip.status.offered');
    case 'reassigning':
      return t('track.reassigning');
    case 'to_pickup':
      return ride ? t('trip.status.en_route_to_pickup') : t('track.courier_to_kitchen_short');
    case 'at_pickup':
      return t('trip.status.arrived_pickup');
    case 'on_the_way':
      if (ride) return t('trip.status.in_transit');
      // He pressed "وصلت" at my door (not someone else's drop first): say so, not "on the way".
      return v.trip?.state === 'arrived_dropoff' && v.trip.dropsBeforeMine === 0 ? t('track.courier_at_door') : t('track.on_the_way');
    case 'unreachable':
      return t('unreachable.customer_title');
    case 'arrived':
      return ride ? t('trip.status.completed') : t('order.status.delivered');
    case 'done':
      return t('order.status.closed');
    case 'cancelled':
      return t(`order.status.${v.order.state}` as MessageKey);
    case 'failed':
      return t('order.status.failed');
    case 'disputed':
      return t('order.status.disputed');
  }
}

/** Steps with real timestamps (done), ETA for the last one, and the key of the step in progress. */
export function buildTimeline(v: OrderTracking, input: TimelineInput, t: TFn, clock: (d: Date) => string): { steps: Step[]; current: string } {
  return v.order.type === 'ride' ? rideTimeline(v, input, t, clock) : deliveryTimeline(v, input, t, clock);
}

function lateNote(input: TimelineInput, t: TFn, clock: (d: Date) => string): Pick<Step, 'note' | 'late'> {
  if (input.lateMin <= 0 || !input.eta) return {};
  return { note: `${t('track.note_late', { minutes: input.lateMin, time: clock(input.eta) })} ${t('track.note_late_credit')}`, late: true };
}

function deliveryTimeline(v: OrderTracking, input: TimelineInput, t: TFn, clock: (d: Date) => string) {
  const o = v.order;
  const name = input.courierName ?? t('track.courier_fallback');
  const at = (d: Date | null | undefined) => (d ? clock(d) : undefined);
  const phase = phaseOf(v);
  const courierAccepted = Boolean(v.trip?.acceptedAt && v.courier);
  const pickupStop = v.trip?.stops.find((s) => s.mine && (s.type === 'pickup' || s.type === 'shop'));

  const prepNote = (): string | undefined => {
    if (phase === 'reassigning') return t('track.reassigning_note');
    if (courierAccepted && pickupStop?.arrivedAt) return t('track.note_courier_waiting', { name });
    if (courierAccepted) return t('track.note_courier_to_kitchen', { name });
    if (!o.readyAt && o.promisedReadyAt) return t('track.note_ready_at', { time: clock(o.promisedReadyAt) });
    return undefined;
  };

  const onTheWayNote = (): string | undefined => {
    if (phase === 'reassigning') return t('track.reassigning_note');
    if ((v.trip?.dropsBeforeMine ?? 0) > 0 && input.eta) return t('order.eta_batched', { time: clock(input.eta) });
    return t('track.note_on_the_way', { name });
  };

  const steps: Step[] = [
    { key: 'placed', label: t('order.status.placed'), time: at(o.placedAt), ...(o.state === 'placed' ? { note: t('order.status.placed_hint') } : {}) },
    { key: 'accepted', label: t('order.status.merchant_accepted'), time: at(o.acceptedAt) },
    {
      key: 'preparing',
      label: o.readyAt ? t('order.status.ready') : t('order.status.preparing'),
      time: at(o.readyAt ?? o.preparingAt),
      note: prepNote(),
    },
    { key: 'picked_up', label: t('order.status.picked_up'), time: at(o.pickedUpAt), note: o.pickedUpAt && !o.deliveredAt ? onTheWayNote() : undefined },
    {
      key: 'delivered',
      label: o.deliveredAt ? t('order.status.delivered') : t('track.step_arrive'),
      time: o.deliveredAt ? clock(o.deliveredAt) : input.eta ? `~${clock(input.eta)}` : undefined,
    },
  ];

  const current =
    o.deliveredAt || phase === 'arrived' || phase === 'done' || phase === 'disputed'
      ? 'delivered'
      : o.pickedUpAt || o.state === 'picked_up'
        ? 'picked_up'
        : o.state === 'preparing' || o.state === 'ready' || o.preparingAt
          ? 'preparing'
          : o.state === 'merchant_accepted' || o.acceptedAt
            ? 'accepted'
            : 'placed';

  const late = lateNote(input, t, clock);
  if (late.note) {
    const step = steps.find((s) => s.key === current);
    if (step) Object.assign(step, late);
  }
  return { steps, current };
}

function rideTimeline(v: OrderTracking, input: TimelineInput, t: TFn, clock: (d: Date) => string) {
  const trip = v.trip;
  const pickup = trip?.stops.find((s) => s.mine && s.type === 'pickup');
  const name = input.courierName ?? t('track.driver_fallback');
  const at = (d: Date | null | undefined) => (d ? clock(d) : undefined);
  const done = trip?.state === 'completed' || v.order.state === 'completed' || v.order.state === 'closed';
  const steps: Step[] = [
    { key: 'searching', label: t('trip.status.offered'), time: at(v.order.placedAt) },
    { key: 'matched', label: t('trip.status.en_route_to_pickup'), time: at(trip?.acceptedAt), note: trip?.acceptedAt && !pickup?.arrivedAt ? t('track.note_driver_coming', { name }) : undefined },
    { key: 'arrived_pickup', label: t('trip.status.arrived_pickup'), time: at(pickup?.arrivedAt) },
    { key: 'in_transit', label: t('trip.status.in_transit'), time: at(pickup?.completedAt) },
    {
      key: 'completed',
      label: t('trip.status.completed'),
      time: done ? at(trip?.completedAt ?? v.order.closedAt) : input.eta && pickup?.completedAt ? `~${clock(input.eta)}` : undefined,
    },
  ];
  const s = trip?.state;
  const current = done
    ? 'completed'
    : s === 'in_transit' || s === 'arrived_dropoff'
      ? 'in_transit'
      : s === 'arrived_pickup'
        ? 'arrived_pickup'
        : s === 'accepted' || s === 'en_route_to_pickup'
          ? 'matched'
          : 'searching';
  const late = lateNote(input, t, clock);
  if (late.note) {
    const step = steps.find((x) => x.key === current);
    if (step) Object.assign(step, late);
  }
  return { steps, current };
}
