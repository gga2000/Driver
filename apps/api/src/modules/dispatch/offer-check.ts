import type { TripOfferCheck, OfferCheckVerdict } from '../trips/index.js';
import { OPEN_STATES, type DispatchRepository, type OfferRecord } from './dispatch.repository.js';
import type { CapsPort } from './ports.js';

/**
 * Dispatch's answer to trips' "does this driver hold an open offer for this trip?" (M2 review
 * follow-up), from the `DispatchOffer` records. Bound into `TripsService` by the dispatch module.
 *
 * - accept: the driver's offer is open (sent/seen, not expired) — or `accepted`, the state
 *   `respond` writes in the same unit of work just before it tells trips — and he is not over cap;
 * - decline: his offer is open, or `declined` (written by `respond` just before trips hears it);
 * - otherwise `offer_not_yours` when someone else holds a live offer on the trip, `offer_not_found`
 *   when nobody does.
 */
export class DispatchOfferCheck implements TripOfferCheck {
  constructor(
    private readonly repo: Pick<DispatchRepository, 'listByTrip'>,
    private readonly caps: Pick<CapsPort, 'isOverCap'>,
    private readonly now: () => Date,
  ) {}

  async check(tripId: string, driverId: string, intent: 'accept' | 'decline'): Promise<OfferCheckVerdict> {
    const offers = await this.repo.listByTrip(tripId);
    const at = this.now().getTime();
    const live = (o: OfferRecord) => OPEN_STATES.includes(o.state) && at < o.expiresAt.getTime();
    const answered = intent === 'accept' ? 'accepted' : 'declined';
    const holds = offers.some((o) => o.driverId === driverId && (live(o) || o.state === answered));
    if (!holds) return offers.some((o) => o.driverId !== driverId && (live(o) || o.state === 'accepted')) ? 'offer_not_yours' : 'offer_not_found';
    if (intent === 'accept' && (await this.caps.isOverCap(driverId))) return 'over_cap';
    return 'ok';
  }
}
