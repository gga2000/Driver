import { useMemo } from 'react';
import { decodePolyline } from '@driver/map';
import { useActiveOrder } from '@/features/home/queries';
import { useCourierPosition, useOrderRoute, useTracking } from '@/features/track/queries';
import { phaseOf } from '@/features/track/timeline';
import { minutesLeft, orderStep, showsOnLiveMap, type LiveOrder, type OrderStep } from './logic';

/** Phases with a courier moving: his dot and the street route show. */
const MOVING = new Set(['to_pickup', 'at_pickup', 'on_the_way']);

export interface OrderOnMap {
  order: LiveOrder;
  step: OrderStep;
  /** Minutes until it reaches them (the one ETA everywhere), null before a courier has it. */
  minutes: number | null;
}

/**
 * Their own food order on the live map, from the same reads the tracking screen keeps fresh: the
 * kitchen, their courier and the road still ahead (only while a courier is on it), their door.
 * Nobody else's courier ever shows. Null without a food order on its way.
 */
export function useOrderOnMap(now: number): { onMap: OrderOnMap | null; pending: boolean } {
  const active = useActiveOrder();
  const food = showsOnLiveMap(active.data) ? active.data! : null;
  const id = food?.id ?? '';
  const tracking = useTracking(id);
  const v = food ? tracking.data : undefined;
  const phase = v ? phaseOf(v) : null;
  const moving = Boolean(phase && MOVING.has(phase));
  const pos = useCourierPosition(id, Boolean(food) && moving);
  const route = useOrderRoute(id, Boolean(food) && moving, phase ?? '');
  const polyline = moving ? (route.data?.polyline6 ?? null) : null;
  const road = useMemo(
    () =>
      polyline ? decodePolyline(polyline).map((p) => [p.lng, p.lat] as [number, number]) : null,
    [polyline],
  );
  // Still finding out whether there is an order (the tour waits for this, so it never plays over one).
  const pending =
    (active.fetchStatus === 'fetching' && active.data === undefined) ||
    (Boolean(food) && !tracking.data && !tracking.isError);
  if (
    !food ||
    !v ||
    !phase ||
    phase === 'arrived' ||
    phase === 'done' ||
    phase === 'cancelled' ||
    phase === 'failed' ||
    phase === 'disputed'
  )
    return { onMap: null, pending };
  const fix = moving ? (pos.data ?? null) : null;
  const door = v.dropoff?.pin ?? null;
  const doorAt: [number, number] | null = door ? [door.lng, door.lat] : null;
  // No street route yet (or the router is down): a straight line from the courier to the door, as the tracking map does.
  const line =
    road ?? (fix && doorAt ? [[fix.pin.lng, fix.pin.lat] as [number, number], doorAt] : null);
  return {
    pending,
    onMap: {
      order: {
        id: food.id,
        kitchen: v.merchant?.pin
          ? { at: [v.merchant.pin.lng, v.merchant.pin.lat], name: v.merchant.name }
          : null,
        courier: fix ? [fix.pin.lng, fix.pin.lat] : null,
        route: line,
        door: doorAt,
        cooking: phase === 'waiting_merchant' || phase === 'preparing',
      },
      step: orderStep(phase),
      minutes: minutesLeft(fix?.etaAt ?? v.promisedAt, now),
    },
  };
}
