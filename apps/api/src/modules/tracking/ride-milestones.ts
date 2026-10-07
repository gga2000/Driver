import { isNightAt, RIDE_STICKER_MILESTONES, type OrderFirsts } from '@driver/contracts';

/** A finished city ride (taxi or tuktuk) of the person, as the milestones need it. */
export interface FinishedRide {
  id: string;
  placedAt: Date;
  /** When it reached him. */
  doneAt: Date;
}

/**
 * Ride stickers (ride idea g2): the person's first ride booked at night (Baghdad 21:00–05:59) and the
 * latest finished ride whose count is a milestone (10th, 25th, …), in the order the rides reached him,
 * so once a ride holds a sticker no later ride takes it.
 */
export function rideMilestones(rides: readonly FinishedRide[]): Pick<OrderFirsts, 'nightRideOrderId' | 'rideMilestone'> {
  const done = [...rides].sort((a, b) => a.doneAt.getTime() - b.doneAt.getTime());
  const night = done.find((r) => isNightAt(r.placedAt)) ?? null;
  let milestone: OrderFirsts['rideMilestone'] = null;
  for (const count of RIDE_STICKER_MILESTONES) {
    const ride = done[count - 1];
    if (ride) milestone = { orderId: ride.id, count };
  }
  return { nightRideOrderId: night?.id ?? null, rideMilestone: milestone };
}
