/**
 * M2 review follow-up: a driver may accept or decline a trip only while he holds an OPEN offer for
 * it — dispatch's `DispatchOffer` records are the only source of offers. Trips asks this narrow
 * question before `accept` / `decline`; dispatch answers it (`DispatchOfferCheck`, bound by the
 * dispatch module at start-up, since dispatch depends on trips and not the other way round).
 *
 * "Open" includes the response being recorded: dispatch marks the offer `accepted` (or `declined`)
 * in the same unit of work, just before it tells trips. Over-cap drivers never pass an accept.
 *
 * Until dispatch binds the real check, `DenyAllOfferCheck` refuses everything (fail closed).
 */
export type OfferCheckVerdict = 'ok' | 'offer_not_found' | 'offer_not_yours' | 'over_cap';

export interface TripOfferCheck {
  check(tripId: string, driverId: string, intent: 'accept' | 'decline'): Promise<OfferCheckVerdict>;
}

export class DenyAllOfferCheck implements TripOfferCheck {
  async check(): Promise<OfferCheckVerdict> {
    return 'offer_not_found';
  }
}

/**
 * Test double for trips-only tests (no dispatch in the harness): every check passes unless a test
 * scripted a verdict for that (trip, driver).
 */
export class ScriptedOfferCheck implements TripOfferCheck {
  readonly verdicts = new Map<string, OfferCheckVerdict>();

  readonly asked: Array<{ tripId: string; driverId: string; intent: 'accept' | 'decline' }> = [];

  set(tripId: string, driverId: string, verdict: OfferCheckVerdict): void {
    this.verdicts.set(`${tripId}/${driverId}`, verdict);
  }

  async check(tripId: string, driverId: string, intent: 'accept' | 'decline'): Promise<OfferCheckVerdict> {
    this.asked.push({ tripId, driverId, intent });
    return this.verdicts.get(`${tripId}/${driverId}`) ?? 'ok';
  }
}
