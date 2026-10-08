import { Inject, Injectable } from '@nestjs/common';
import {
  DRIVER_PROFILE_RULES,
  DriverError,
  type Actor,
  type AvoidDriverInput,
  type AvoidedDriverView,
  type DriverProfile,
  type DriverProfileInput,
  type MyRideOffers,
  type MyRideOffersInput,
  type NudgeOfferInput,
  type NudgeOfferResult,
  type RideOfferCard,
  type RideOfferState,
  type UnavoidInput,
  type VehicleClass,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { AVOIDED_READ_PURPOSE, DRIVER_CARD_PURPOSE, HABITS_RIDES, HABITS_SEARCH, type DriverFacts, type HabitsRidesPort, type HabitsSearchPort, type SearchOffer } from './ports.js';
import { RIDE_HABITS_REPOSITORY, type RideHabitsRepository } from './ride-habits.repository.js';

/** What a driver's card says that does not move during one search (one vault read per driver per search). */
interface StaticCard {
  firstName: string | null;
  photoRef: string | null;
  rating: { rating: number; count: number } | null;
  facts: DriverFacts;
}

/** Cards cached per search, driver and reader, so a polling list logs one vault read per driver, not one per poll. */
const CARD_CACHE_MAX = 2000;

const NO_FACTS: DriverFacts = { vehicleClass: null, model: null, colour: null, features: [], tripCount: 0 };

/** The car a ride of this kind is in when the registry has none on file. */
const DEFAULT_CLASS: Record<'taxi' | 'tuktuk', VehicleClass> = { taxi: 'car', tuktuk: 'tuktuk' };

/** How an offer reads to the rider: open (sent / seen) until it runs out; withdrawn counts as expired. */
export function rideOfferState(o: Pick<SearchOffer, 'state' | 'expiresAt'>, now: Date): RideOfferState | null {
  if (o.state === 'accepted') return null;
  if (o.state === 'declined') return 'declined';
  if (o.state === 'timed_out' || o.state === 'withdrawn' || o.expiresAt.getTime() <= now.getTime()) return 'expired';
  return o.state;
}

const OPEN: ReadonlySet<RideOfferState> = new Set(['sent', 'seen']);

/**
 * Ride step 3: the rider and the drivers of his ride — the live list of the drivers it was sent to
 * (n3), «نبّهه» (n4), a driver's profile on tap (n5) and «ما أريده مرة ثانية» (s5). Only the ride's
 * orderer or its rider may look; the offered list and «نبّهه» only while it searches; the profile of
 * an offered driver while it searches, of the assigned driver any time (with his plate). First name and
 * approved photo only — never a position, a phone or a last name.
 */
@Injectable()
export class RiderDriversService {
  private readonly cards = new Map<string, StaticCard>();

  constructor(
    @Inject(HABITS_SEARCH) private readonly search: HabitsSearchPort,
    @Inject(HABITS_RIDES) private readonly rides: HabitsRidesPort,
    @Inject(RIDE_HABITS_REPOSITORY) private readonly repo: RideHabitsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ───────────────────────── n3: who was sent my ride ─────────────────────────

  async myRideOffers(actor: Actor, input: MyRideOffersInput): Promise<MyRideOffers> {
    await this.party(actor, input.orderId);
    const search = await this.search.search(input.orderId);
    if (!search) throw new DriverError('ride_not_searching');
    const now = this.clock.now();
    // One card per driver: his latest offer (wave, then the re-broadcast); a nudge on any of them stands.
    const latest = new Map<string, SearchOffer>();
    const nudged = new Map<string, Date>();
    for (const o of search.offers) {
      if (o.nudgedAt) nudged.set(o.driverId, o.nudgedAt);
      const prior = latest.get(o.driverId);
      if (!prior || o.sentAt.getTime() >= prior.sentAt.getTime()) latest.set(o.driverId, o);
    }
    const shown = [...latest.values()].flatMap((o) => {
      const state = rideOfferState(o, now);
      return state ? [{ o, state }] : [];
    });
    const [statics, favourites] = await Promise.all([this.statics(search.tripId, shown.map((s) => s.o.driverId), actor.personId), this.repo.favouritesOf(actor.personId)]);
    const fav = new Set(favourites.map((f) => f.driverId));
    const offers: RideOfferCard[] = await Promise.all(
      shown.map(async ({ o, state }) => {
        const card = statics.get(o.driverId)!;
        return {
          offerId: o.offerId,
          firstName: card.firstName,
          photoUrl: card.photoRef ? this.search.photoUrl(card.photoRef) : null,
          rating: card.rating?.rating ?? null,
          ratingCount: card.rating?.count ?? 0,
          tripCount: card.facts.tripCount,
          vehicleClass: card.facts.vehicleClass ?? DEFAULT_CLASS[search.vertical],
          vehicleModel: card.facts.model,
          vehicleColour: card.facts.colour,
          features: card.facts.features,
          minutesAway: OPEN.has(state) ? await this.search.minutesAway(o.driverId, search.pickup) : null,
          state,
          nudgedAt: nudged.get(o.driverId) ?? null,
          favourite: fav.has(o.driverId),
        };
      }),
    );
    return { offers: sortOffers(offers, new Map(shown.map((s) => [s.o.offerId, s.o.sentAt.getTime()]))), at: now };
  }

  // ───────────────────────── n4: «نبّهه» ─────────────────────────

  async nudgeOffer(actor: Actor, input: NudgeOfferInput): Promise<NudgeOfferResult> {
    await this.party(actor, input.orderId);
    const search = await this.search.search(input.orderId);
    if (!search) throw new DriverError('ride_not_searching');
    // Only a driver this ride was sent to; dispatch re-checks the offer is open and his one nudge unused.
    if (!search.offers.some((o) => o.offerId === input.offerId)) throw new DriverError('nudge_offer_closed');
    return { nudgedAt: await this.search.nudge(search.tripId, input.offerId, actor.personId) };
  }

  // ───────────────────────── n5: the profile ─────────────────────────

  async driverProfile(actor: Actor, input: DriverProfileInput): Promise<DriverProfile> {
    await this.party(actor, input.orderId);
    let driverId: string;
    let plate: string | null = null;
    let carClass: VehicleClass | null = null;
    let vertical: 'taxi' | 'tuktuk';
    if (input.offerId) {
      const search = await this.search.search(input.orderId);
      if (!search) throw new DriverError('ride_not_searching');
      const offer = search.offers.find((o) => o.offerId === input.offerId);
      if (!offer) throw new DriverError('not_found');
      driverId = offer.driverId;
      vertical = search.vertical;
    } else {
      const assigned = await this.search.assigned(input.orderId);
      if (!assigned) throw new DriverError('not_found');
      driverId = assigned.driverId;
      plate = assigned.plate;
      carClass = assigned.vehicleClass;
      vertical = assigned.vertical;
    }
    const [cards, rating, facts, record] = await Promise.all([
      this.search.cards([driverId], actor.personId, DRIVER_CARD_PURPOSE),
      this.rides.driverRating(driverId),
      this.search.facts([driverId]),
      this.search.record(driverId),
    ]);
    const card = cards[driverId];
    const car = facts.get(driverId) ?? NO_FACTS;
    return {
      firstName: card?.firstName ?? null,
      photoUrl: card?.photoRef ? this.search.photoUrl(card.photoRef) : null,
      rating: rating?.rating ?? null,
      ratingCount: rating?.count ?? 0,
      tripCount: car.tripCount,
      onTimePct: record.onTimePct,
      memberSince: record.driverSince,
      vehicleClass: carClass ?? car.vehicleClass ?? DEFAULT_CLASS[vertical],
      vehicleModel: car.model,
      vehicleColour: car.colour,
      plate,
      features: car.features,
      compliments: record.compliments.slice(0, DRIVER_PROFILE_RULES.compliments),
    };
  }

  /**
   * Partner redesign r4 «هيج يشوفك الزبون»: the profile riders open (`driverProfile`), built the same
   * way for the driver himself. No plate: riders see it only once he is their assigned driver.
   */
  async ownProfile(actor: Actor): Promise<DriverProfile> {
    const driverId = actor.personId;
    const [cards, rating, facts, record] = await Promise.all([
      this.search.cards([driverId], driverId, DRIVER_CARD_PURPOSE),
      this.rides.driverRating(driverId),
      this.search.facts([driverId]),
      this.search.record(driverId),
    ]);
    const card = cards[driverId];
    const car = facts.get(driverId) ?? NO_FACTS;
    return {
      firstName: card?.firstName ?? null,
      photoUrl: card?.photoRef ? this.search.photoUrl(card.photoRef) : null,
      rating: rating?.rating ?? null,
      ratingCount: rating?.count ?? 0,
      tripCount: car.tripCount,
      onTimePct: record.onTimePct,
      memberSince: record.driverSince,
      vehicleClass: car.vehicleClass ?? DEFAULT_CLASS.taxi,
      vehicleModel: car.model,
      vehicleColour: car.colour,
      plate: null,
      features: car.features,
      compliments: record.compliments.slice(0, DRIVER_PROFILE_RULES.compliments),
    };
  }

  // ───────────────────────── s5: «ما أريده مرة ثانية» ─────────────────────────

  /**
   * Keeps the driver of one of his rides (finished, or the one assigned now) off his rides for good:
   * dispatch reads the list when each of his rides starts searching. A favourite stops being one.
   */
  async avoid(actor: Actor, input: AvoidDriverInput): Promise<AvoidedDriverView[]> {
    await this.party(actor, input.orderId);
    const driver = await this.search.assigned(input.orderId);
    if (!driver) throw new DriverError('not_found');
    if (driver.driverId === actor.personId) throw new DriverError('invalid_input');
    await this.repo.removeFavourite(actor.personId, driver.driverId);
    await this.repo.addAvoid(actor.personId, driver.driverId, this.clock.now());
    return this.avoided(actor);
  }

  async avoided(actor: Actor): Promise<AvoidedDriverView[]> {
    const rows = await this.repo.avoidedOf(actor.personId);
    if (rows.length === 0) return [];
    const cards = await this.search.cards(
      rows.map((r) => r.driverId),
      actor.personId,
      AVOIDED_READ_PURPOSE,
    );
    return rows.map((r) => {
      const card = cards[r.driverId];
      return { id: r.id, firstName: card?.firstName ?? null, photoUrl: card?.photoRef ? this.search.photoUrl(card.photoRef) : null, since: r.createdAt };
    });
  }

  async unavoid(actor: Actor, input: UnavoidInput): Promise<AvoidedDriverView[]> {
    const row = (await this.repo.avoidedOf(actor.personId)).find((r) => r.id === input.avoidId);
    if (!row) throw new DriverError('avoid_not_found');
    await this.repo.removeAvoid(actor.personId, row.driverId);
    return this.avoided(actor);
  }

  /** Dispatch's read when a ride starts searching (s5). */
  async avoidedDriverIds(personId: string): Promise<string[]> {
    return (await this.repo.avoidedOf(personId)).map((r) => r.driverId);
  }

  // ───────────────────────── internals ─────────────────────────

  /** The ride, when the actor is its orderer or its rider; `not_found` for anything but a ride. */
  private async party(actor: Actor, orderId: string) {
    const ride = await this.search.ride(orderId);
    if (!ride) throw new DriverError('not_found');
    if (ride.ordererId !== actor.personId && !ride.riderIds.includes(actor.personId)) throw new DriverError('forbidden');
    return ride;
  }

  /** Name, photo ref, rating and car per driver for this search and reader, read once and cached. */
  private async statics(tripId: string, driverIds: readonly string[], readerId: string): Promise<Map<string, StaticCard>> {
    const key = (id: string) => `${tripId}:${id}:${readerId}`;
    const missing = driverIds.filter((id) => !this.cards.has(key(id)));
    if (missing.length > 0) {
      const [cards, facts, ratings] = await Promise.all([
        this.search.cards(missing, readerId, DRIVER_CARD_PURPOSE),
        this.search.facts(missing),
        Promise.all(missing.map((id) => this.rides.driverRating(id))),
      ]);
      missing.forEach((id, i) => {
        if (this.cards.size >= CARD_CACHE_MAX) this.cards.delete(this.cards.keys().next().value!);
        this.cards.set(key(id), { firstName: cards[id]?.firstName ?? null, photoRef: cards[id]?.photoRef ?? null, rating: ratings[i] ?? null, facts: facts.get(id) ?? NO_FACTS });
      });
    }
    return new Map(driverIds.map((id) => [id, this.cards.get(key(id))!]));
  }
}

/** Open offers nearest first (unknown minutes last), then the closed ones, newest first. */
export function sortOffers(cards: readonly RideOfferCard[], sentAt: ReadonlyMap<string, number>): RideOfferCard[] {
  const open = (c: RideOfferCard) => OPEN.has(c.state);
  return [...cards].sort((a, b) => {
    if (open(a) !== open(b)) return open(a) ? -1 : 1;
    if (open(a)) return (a.minutesAway ?? Number.POSITIVE_INFINITY) - (b.minutesAway ?? Number.POSITIVE_INFINITY) || (sentAt.get(a.offerId) ?? 0) - (sentAt.get(b.offerId) ?? 0);
    return (sentAt.get(b.offerId) ?? 0) - (sentAt.get(a.offerId) ?? 0);
  });
}
