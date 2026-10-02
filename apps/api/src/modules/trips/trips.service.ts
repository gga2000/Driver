import { Injectable } from '@nestjs/common';
import type { Trip, TripState } from '@driver/contracts';
import { EventsService } from '../events/index.js';

/** Legal transitions (spec §5). cancelled/disputed reachable from any active state. */
const NEXT: Record<TripState, readonly TripState[]> = {
  draft: ['quoted', 'cancelled'],
  quoted: ['requested', 'cancelled', 'disputed'],
  requested: ['assigned', 'cancelled', 'disputed'],
  assigned: ['en_route', 'cancelled', 'disputed'],
  en_route: ['arrived', 'cancelled', 'disputed'],
  arrived: ['in_progress', 'cancelled', 'disputed'],
  in_progress: ['completed', 'cancelled', 'disputed'],
  completed: ['disputed'],
  cancelled: [],
  disputed: [],
};

export class TripStateError extends Error {
  constructor(readonly from: TripState, readonly to: TripState) {
    super(`illegal trip transition ${from} → ${to}`);
    this.name = 'TripStateError';
  }
}

export function canTransition(from: TripState, to: TripState): boolean {
  return NEXT[from].includes(to);
}

@Injectable()
export class TripsService {
  private readonly trips = new Map<string, Trip>();
  private seq = 0;

  constructor(private readonly events: EventsService) {}

  create(input: Omit<Trip, 'id' | 'state' | 'createdAt' | 'updatedAt'>): Trip {
    this.seq += 1;
    const now = new Date();
    const trip: Trip = { ...input, id: `trip_${this.seq}`, state: 'draft', createdAt: now, updatedAt: now };
    this.trips.set(trip.id, trip);
    this.events.emit(
      { actorId: trip.customerId, type: 'trip.created', occurredAt: now, tripId: trip.id, payload: { vertical: trip.vertical } },
      { name: 'trip', id: trip.id },
    );
    return trip;
  }

  transition(tripId: string, to: TripState, actorId: string, patch: Partial<Trip> = {}): Trip {
    const trip = this.get(tripId);
    if (!canTransition(trip.state, to)) throw new TripStateError(trip.state, to);
    const now = new Date();
    const next: Trip = { ...trip, ...patch, state: to, updatedAt: now };
    this.trips.set(tripId, next);
    this.events.emit(
      { actorId, type: `trip.${to}`, occurredAt: now, tripId, payload: { from: trip.state } },
      { name: 'trip', id: tripId },
    );
    return next;
  }

  get(tripId: string): Trip {
    const trip = this.trips.get(tripId);
    if (!trip) throw new Error(`trip ${tripId} not found`);
    return trip;
  }

  active(cityId: string): Trip[] {
    return [...this.trips.values()].filter(
      (t) => t.cityId === cityId && !['draft', 'completed', 'cancelled', 'disputed'].includes(t.state),
    );
  }
}
