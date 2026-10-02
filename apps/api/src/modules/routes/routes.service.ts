import { Injectable } from '@nestjs/common';

export type SeatPosition = 'front' | 'back_left' | 'back_middle' | 'back_right';
export type SeatStatus = 'open' | 'held' | 'booked' | 'boarded' | 'released';

export interface Seat {
  position: SeatPosition;
  riderId?: string;
  priceIqd: number;
  status: SeatStatus;
}

export interface Departure {
  routeId: string;
  at: Date;
  seats: Seat[];
}

export const CAR_SEATS: readonly SeatPosition[] = ['front', 'back_left', 'back_middle', 'back_right'];

export class SeatError extends Error {
  constructor(readonly code: 'seat_taken' | 'seat_unknown' | 'departure_unknown', message: string) {
    super(message);
    this.name = 'SeatError';
  }
}

@Injectable()
export class RoutesService {
  private readonly departures = new Map<string, Departure>();

  private key(routeId: string, at: Date): string {
    return `${routeId}@${at.toISOString()}`;
  }

  openDeparture(routeId: string, at: Date, basePriceIqd: number, frontSeatPremiumIqd = 2000): Departure {
    const dep: Departure = {
      routeId,
      at,
      seats: CAR_SEATS.map((position) => ({
        position,
        priceIqd: basePriceIqd + (position === 'front' ? frontSeatPremiumIqd : 0),
        status: 'open',
      })),
    };
    this.departures.set(this.key(routeId, at), dep);
    return dep;
  }

  book(routeId: string, at: Date, position: SeatPosition, riderId: string): Seat {
    const dep = this.departures.get(this.key(routeId, at));
    if (!dep) throw new SeatError('departure_unknown', `no departure ${routeId} at ${at.toISOString()}`);
    const seat = dep.seats.find((s) => s.position === position);
    if (!seat) throw new SeatError('seat_unknown', position);
    if (seat.status !== 'open' && seat.status !== 'released') throw new SeatError('seat_taken', `${position} is ${seat.status}`);
    seat.status = 'booked';
    seat.riderId = riderId;
    return seat;
  }

  release(routeId: string, at: Date, position: SeatPosition): void {
    const seat = this.departures.get(this.key(routeId, at))?.seats.find((s) => s.position === position);
    if (seat) {
      seat.status = 'released';
      seat.riderId = undefined;
    }
  }

  openSeats(routeId: string, at: Date): Seat[] {
    return (this.departures.get(this.key(routeId, at))?.seats ?? []).filter((s) => s.status === 'open' || s.status === 'released');
  }
}
