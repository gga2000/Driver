import { Injectable } from '@nestjs/common';
import { DeparturesService } from './departures.service.js';

/**
 * Dispatch's `DeparturesPort` (structurally: `seatsFilled`, `cancelLowFill`), implemented by the
 * routes module and bound in `DispatchModule` in place of the old in-memory stub.
 *
 * Owner of low fill: this module. `RoutesScheduler` runs the T−30 rule for every announced
 * departure; a dispatch `scheduled` request (if one is ever opened for a departure) reads the same
 * fill here and its cancel re-applies the same rule — it is refused, and logged, when the departure
 * is at or above the minimum or no longer open, so the two can never disagree.
 */
@Injectable()
export class RoutesDeparturesPort {
  constructor(private readonly departures: DeparturesService) {}

  /** Seats filled: booked seats plus walk-ups once the driver's per-run selfie is in; null when unknown. */
  seatsFilled(departureId: string): Promise<number | null> {
    return this.departures.seatsFilled(departureId);
  }

  /** True when it cancelled; false when the rule does not hold (yet): filled, not open, or before its low-fill time. */
  cancelLowFill(departureId: string): Promise<boolean> {
    return this.departures.cancelLowFill(departureId);
  }

  /** When the low-fill rule may cancel it: T−10, or the latest departure for a car announced < 30 min ahead. */
  lowFillCheckAt(departureId: string): Promise<Date | null> {
    return this.departures.lowFillCheckAt(departureId);
  }
}
