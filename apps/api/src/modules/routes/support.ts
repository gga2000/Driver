import { randomInt, randomUUID } from 'node:crypto';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { bookingTotal } from './model.js';
import type { RoutesRepository } from './routes.repository.js';

/** Where ids and boarding PINs come from (tests swap in a deterministic source). */
export interface IdSource {
  id(prefix: string): string;
  /** A 4-digit boarding PIN. */
  pin(): string;
}

export const ROUTES_IDS = Symbol('ROUTES_IDS');

export const randomIds: IdSource = {
  id: (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
  pin: () => String(randomInt(0, 10_000)).padStart(4, '0'),
};

/** Deterministic ids and PINs for tests. */
export class SequentialIds implements IdSource {
  private n = 0;
  private p = 1234;

  id(prefix: string): string {
    this.n += 1;
    return `${prefix}_${this.n}`;
  }

  pin(): string {
    this.p = (this.p * 7 + 1111) % 10_000;
    return String(this.p).padStart(4, '0');
  }
}

/**
 * What the routes module holds against a rider's wallet: prepaid seats not yet completed (the
 * ledger debits them on `seat.completed`) and request-board deposits not yet settled.
 */
export async function walletHolds(
  repo: RoutesRepository,
  riderId: string,
  tx?: Tx,
  excludeBookingId?: string,
): Promise<number> {
  const seats = (await repo.bookingsOfRider(riderId, ['booked', 'checked_in'], tx))
    .filter((b) => b.payment === 'wallet' && b.id !== excludeBookingId)
    .reduce((s, b) => s + bookingTotal(b), 0);
  const deposits = (
    await repo.listRequests({ riderId, states: ['matched', 'driver_arrived'] }, tx)
  )
    // A cash reservation (step 4b) holds nothing on the wallet.
    .filter((r) => !r.cashReserved)
    .reduce((s, r) => s + (r.depositIqd ?? 0), 0);
  return seats + deposits;
}

export function roundUpTo(amount: number, step: number): number {
  return Math.ceil(amount / step) * step;
}

/** Local wall-clock hour (Baghdad is UTC+3 all year). */
export function localHour(at: Date, utcOffsetMin: number): number {
  return new Date(at.getTime() + utcOffsetMin * 60_000).getUTCHours();
}

export const MIN_MS = 60_000;
