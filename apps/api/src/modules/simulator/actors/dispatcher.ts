import type { BoardCard, Vertical } from '@driver/contracts';
import { haversineMeters } from '../../trips/index.js';
import type { DriverRun, SimContext } from '../context.js';
import { zoneSeed } from '../world.js';

/**
 * The ops desk (Console dispatcher) in the simulation: a card that needs the dispatcher gets a
 * manual offer to the nearest free driver who fits; a courier offline for 4 minutes before pickup
 * loses the job (the platform cancels his trip and dispatch finds another courier).
 */
export const DISPATCHER_BEHAVIOUR = {
  overrideEverySec: 30,
  reassignOfflineAfterMin: 4,
};

const FITS: Partial<Record<Vertical, ReadonlyArray<DriverRun['def']['vehicle']>>> = {
  food: ['bike', 'tuktuk', 'car'],
  grocery: ['bike', 'tuktuk', 'car'],
  taxi: ['car'],
  tuktuk: ['tuktuk'],
};

export interface DispatcherState {
  lastOverride: Map<string, number>;
}

export async function dispatcherStep(ctx: SimContext, cards: readonly BoardCard[], state: DispatcherState): Promise<void> {
  const actor = { personId: ctx.dispatcherId, sessionId: 'sim-dispatcher' };
  // Drivers holding an open offer (or just given one by the desk) are not free.
  const offered = new Set(cards.flatMap((c) => c.offers.filter((o) => o.state === 'sent' || o.state === 'seen').map((o) => o.driverId)));
  for (const card of cards) {
    if (card.status !== 'needs_dispatcher' || card.assignedDriverId) continue;
    const last = state.lastOverride.get(card.tripId) ?? -Infinity;
    if (ctx.t - last < DISPATCHER_BEHAVIOUR.overrideEverySec * 1000) continue;
    state.lastOverride.set(card.tripId, ctx.t);
    const req = await ctx.s.dispatch.getRequest(card.tripId);
    if (!req) continue;
    const declined = new Set(card.offers.filter((o) => o.state === 'declined').map((o) => o.driverId));
    const fits = FITS[card.vertical] ?? [];
    const edge = zoneSeed(card.zoneId).tier === 'edge' || (req.dropoffZoneId !== null && zoneSeed(req.dropoffZoneId).tier === 'edge');
    const free = ctx.drivers
      .filter((d) => d.online && !d.loggedOff && d.trips.size === 0 && d.pending.length === 0 && !offered.has(d.personId) && fits.includes(d.def.vehicle) && !declined.has(d.personId))
      .filter((d) => !(edge && d.def.vehicle === 'tuktuk' && !d.def.edgeOptIn))
      .sort((a, b) => haversineMeters(a.pos, req.pickup) - haversineMeters(b.pos, req.pickup));
    for (const d of free.slice(0, 3)) {
      const status = await ctx.s.caps.status(d.personId);
      if (status.overCap) continue;
      const res = await ctx.call('dispatcher.override', () => ctx.s.dispatch.override(actor, { tripId: card.tripId, driverId: d.personId }));
      if (res) {
        offered.add(d.personId);
        break;
      }
    }
  }

  // Couriers who went dark before pickup: give the order to someone else.
  for (const d of ctx.drivers) {
    if (d.online || d.offlineSinceT === null || ctx.t - d.offlineSinceT < DISPATCHER_BEHAVIOUR.reassignOfflineAfterMin * 60_000) continue;
    for (const trip of d.trips.values()) {
      if (trip.vertical !== 'food' && trip.vertical !== 'grocery') continue;
      const view = await ctx.s.trips.get(trip.tripId);
      if (!['accepted', 'en_route_to_pickup', 'arrived_pickup'].includes(view.state) || view.courierId !== d.personId) continue;
      await ctx.call('dispatcher.reassign', () => ctx.s.trips.cancel(trip.tripId, 'platform', ctx.dispatcherId, 'courier_offline'));
    }
  }
}
