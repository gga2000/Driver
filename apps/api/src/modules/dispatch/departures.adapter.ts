import { Injectable, Logger } from '@nestjs/common';
import type { DeparturesPort } from './ports.js';

/**
 * Minimal in-memory departures adapter, bound until the intercity / routes module ships its
 * departures and seats (M3). It only knows what someone registered with `register()` — nothing
 * registers in production yet, so a `scheduled` dispatch request's T−30 low-fill check finds the
 * departure unknown and puts it on the dispatcher's board ("departure_unknown") rather than
 * cancelling anything. `cancelLowFill` records and logs; it cannot move riders. Replace with the
 * routes module's port when it lands; nothing in the orchestrator changes.
 */
@Injectable()
export class InMemoryDepartures implements DeparturesPort {
  private readonly logger = new Logger(InMemoryDepartures.name);

  private readonly seats = new Map<string, number>();

  readonly cancelled: string[] = [];

  /** Seats filled (walk-ups included) for a departure; the Console/simulator may set it by hand. */
  register(departureId: string, seatsFilled: number): void {
    this.seats.set(departureId, seatsFilled);
  }

  async seatsFilled(departureId: string): Promise<number | null> {
    return this.seats.get(departureId) ?? null;
  }

  async cancelLowFill(departureId: string): Promise<void> {
    this.cancelled.push(departureId);
    this.logger.warn(`departure ${departureId} cancelled for low fill — riders must be moved by hand until routes ships`);
  }
}
