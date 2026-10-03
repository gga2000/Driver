export { DispatchModule } from './dispatch.module.js';
export { DispatchService, DispatchError, DISPATCH_POLICIES } from './dispatch.service.js';
export { DriverRanker, DEFAULT_WEIGHTS, DEFAULT_DECAY, campingFactor } from './ranker.js';
export type { RankWeights, RankedDriver, CampingDecay } from './ranker.js';
export type { Policy, DispatchJob, DispatchPlan, DriverCandidate, Wave } from './policy.js';
export type { DispatchRequest } from './dispatch.store.js';
export type { OfferRecord } from './dispatch.repository.js';
export type { DriverPresence } from './geo-index.js';
export type { GoOnlineInput } from './presence.service.js';
export { liveDriver } from './driver-pins.js';
export type { LiveDriver, LiveJobs, DispatchDriverState } from './driver-pins.js';
export { canBatch } from './batching.js';
export type { BatchOrder, BatchRules, BatchVerdict } from './batching.js';
/** Ports other modules implement (trips: offers/assign; ledger: caps; routes: departures). */
export { TRIP_OFFERS, CAPS, DEPARTURES, FakeTripOffers, FakeCaps, FakeDepartures } from './ports.js';
export type { TripOffersPort, CapsPort, DeparturesPort, CourierTripInput, JobExposure } from './ports.js';
export { TripsServiceTripOffers } from './trips.adapter.js';
/** The offer-timer queue (the simulator drains it on its fake clock). */
export { DISPATCH_QUEUE } from './offer.orchestrator.js';
export type { TimerJob as DispatchTimerJob } from './offer.orchestrator.js';
export { DispatchSubscribers, DISPATCH_AUTO_ASSIGN_SUBSCRIBER, DISPATCH_TRIP_SUBSCRIBER, DISPATCH_REDISPATCH_SUBSCRIBER } from './events.subscribers.js';
export { DispatchOfferCheck } from './offer-check.js';
export { DRIVER_LOCK } from './dispatch.store.js';
/** Roles × vehicle → what a driver may be offered (partner.goOnline sets it in presence; review #20). */
export { ROLE_VERTICALS, servedVerticals, vehicleFit } from './vehicles.js';
