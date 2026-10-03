import type { BoardCard, Vertical } from '@driver/contracts';
import { haversineMeters } from '../../trips/index.js';
import type { DriverRun, SimContext } from '../context.js';
import { createRand, type Rand } from '../prng.js';
import { zoneSeed } from '../world.js';

/**
 * The ops desk (Console dispatcher) in the simulation, the same actor in the in-process run and
 * in live mode: a card that needs the dispatcher is picked up after a human reaction time (20–60 s
 * sim time from when the desk first sees it red) and gets a manual offer (`dispatch.override`) to
 * the nearest free driver who fits; when nobody fits, the desk looks again after another reaction
 * time. A courier offline for 4 minutes before pickup loses the job (the platform cancels his trip
 * and dispatch finds another courier).
 */
export const DISPATCHER_BEHAVIOUR = {
  /** Sim seconds from the desk seeing a red card (or finding nobody for it) to acting on it. */
  reactionSec: [20, 60] as const,
  reassignOfflineAfterMin: 4,
};

const FITS: Partial<Record<Vertical, ReadonlyArray<DriverRun['def']['vehicle']>>> = {
  food: ['bike', 'tuktuk', 'car'],
  grocery: ['bike', 'tuktuk', 'car'],
  taxi: ['car'],
  tuktuk: ['tuktuk'],
};

/** One manual offer the desk sent (sim ms). */
export interface DeskOverride {
  tripId: string;
  driverId: string;
  /** When the desk first saw the card red. */
  redSinceT: number;
  at: number;
}

export interface DispatcherState {
  rand: Rand;
  /** Red card (trip id) → when the desk first saw it red and when it will act on it next. */
  red: Map<string, { sinceT: number; actAt: number }>;
  overrides: DeskOverride[];
  /** Offer ids of the desk's manual offers (the driver's phone shows them as the desk calling). */
  offerIds: Set<string>;
}

export function newDispatcherState(seed: number): DispatcherState {
  return { rand: createRand(seed).fork('dispatcher'), red: new Map(), overrides: [], offerIds: new Set() };
}

function reaction(state: DispatcherState): number {
  return state.rand.int(...DISPATCHER_BEHAVIOUR.reactionSec) * 1000;
}

export async function dispatcherStep(ctx: SimContext, cards: readonly BoardCard[], state: DispatcherState): Promise<void> {
  const actor = { personId: ctx.dispatcherId, sessionId: 'sim-dispatcher' };
  // Drivers holding an open offer (or just given one by the desk) are not free.
  const offered = new Set(cards.flatMap((c) => c.offers.filter((o) => o.state === 'sent' || o.state === 'seen').map((o) => o.driverId)));
  const red = cards.filter((c) => c.status === 'needs_dispatcher' && !c.assignedDriverId);
  // A card that left the red queue (taken, cancelled, back to searching) starts afresh if it returns.
  const redIds = new Set(red.map((c) => c.tripId));
  for (const id of state.red.keys()) if (!redIds.has(id)) state.red.delete(id);

  for (const card of red) {
    const seen = state.red.get(card.tripId);
    if (!seen) {
      state.red.set(card.tripId, { sinceT: ctx.t, actAt: ctx.t + reaction(state) });
      continue;
    }
    if (ctx.t < seen.actAt) continue;
    // Whatever happens now, the next look at this card is another reaction time away.
    seen.actAt = ctx.t + reaction(state);
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
        state.offerIds.add(res.offerId);
        state.overrides.push({ tripId: card.tripId, driverId: d.personId, redSinceT: seen.sinceT, at: ctx.t });
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
