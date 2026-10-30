import { Inject, Injectable } from '@nestjs/common';
import {
  CHAT_CLOSE_AFTER_MIN,
  DriverError,
  type ChatThreadStatus,
  type TripCardKind,
  type TripCardState,
  type TripChatSubject,
  type TripChatTrip,
  type TripDealItem,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { haversineMeters } from '../trips/index.js';
import type { IntercityNetworkConfig } from './intercity.config.js';
import { OPEN_DEPARTURE, type AgreementRecord, type BookingRecord, type DepartureRecord, type RequestRecord } from './model.js';
import { RequestBoardService } from './request-board.service.js';
import { ROUTES_REPOSITORY, type RoutesRepository } from './routes.repository.js';
import { ROUTES_NETWORK } from './tokens.js';

/** One rider and one driver on a run or a private-car request, as the chat sees them (step 4c). */
export interface TripChatPair {
  subject: TripChatSubject;
  /** The run (`dep_…`) or request (`rq_…`). */
  id: string;
  riderId: string;
  driverId: string;
  /** The side the thread is keyed by: the rider on a run, the driver on a request. */
  partyId: string;
  status: ChatThreadStatus;
  /** When it closes (the trip's end + 30 min); null while it runs, or when it is closed for another reason. */
  closesAt: Date | null;
  trip: TripChatTrip;
}

/** A card's thing as it stands now. */
export interface TripCardLive {
  state: Exclude<TripCardState, 'replaced'>;
  /** The amount it carries now (a price; a cash ask's no-show amount); null while only asked. */
  amountIqd: number | null;
  note: string | null;
  distanceKm: number | null;
  expiresAt: Date | null;
}

/** Where a new card goes: the pair, who wrote it and what it names (from the routes event). */
export interface TripCardTarget {
  subject: TripChatSubject;
  id: string;
  partyId: string;
  riderId: string;
  driverId: string;
}

const RIDER_BOOKING_LIVE: ReadonlySet<BookingRecord['state']> = new Set(['held', 'booked', 'checked_in', 'completed', 'no_show']);

/**
 * The routes module's side of the Baghdad/Kut chat (private car round 2 step 4c): who the two people
 * of a run or a private-car request are, whether their thread is open, and the live state of the
 * prices agreed between them. The chat module owns the messages; it asks here on every call.
 *
 * Who may talk:
 *  - a run: its driver and a rider. A rider may start while the run is still taking bookings; once it
 *    leaves, only a rider with a seat (or one who already wrote) keeps the thread. The driver answers a
 *    rider who booked, asked for a price, or wrote first.
 *  - a private-car request: its rider and each driver who offered, while the offer is open; once the
 *    rider picks, only the picked driver.
 * A thread closes 30 minutes after the trip ends (`CHAT_CLOSE_AFTER_MIN`).
 */
@Injectable()
export class TripChatSubjects {
  constructor(
    @Inject(ROUTES_REPOSITORY) private readonly repo: RoutesRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ROUTES_NETWORK) private readonly network: IntercityNetworkConfig,
    private readonly board: RequestBoardService,
  ) {}

  /**
   * The pair `actorId` names, and his side in it. `withId` is the other person: needed by the driver of
   * a run (which rider) and the rider of a request (which driver). `hasThread`: they already talked,
   * which keeps a thread readable for a rider without a seat. `chat_not_party` otherwise.
   */
  async pair(subject: TripChatSubject, id: string, actorId: string, withId: string | undefined, hasThread: (partyId: string) => Promise<boolean>): Promise<{ pair: TripChatPair; role: 'customer' | 'courier' }> {
    if (subject === 'departure') {
      const dep = await this.repo.getDeparture(id);
      if (!dep) throw new DriverError('chat_not_party');
      if (actorId === dep.driverId) {
        if (!withId || withId === actorId) throw new DriverError('chat_not_party');
        const pair = await this.departurePair(dep, withId);
        if (!pair.engaged && !(await hasThread(withId))) throw new DriverError('chat_not_party');
        return { pair: pair.pair, role: 'courier' };
      }
      if (withId !== undefined && withId !== actorId && withId !== dep.driverId) throw new DriverError('chat_not_party');
      const pair = await this.departurePair(dep, actorId);
      if (!pair.engaged && !OPEN_DEPARTURE.includes(dep.state) && !(await hasThread(actorId))) throw new DriverError('chat_not_party');
      return { pair: pair.pair, role: 'customer' };
    }
    const r = await this.repo.getRequest(id);
    if (!r || !r.privateCar) throw new DriverError('chat_not_party');
    if (actorId === r.riderId) {
      if (!withId) throw new DriverError('chat_not_party');
      const offer = r.offers.find((o) => o.driverId === withId);
      if (!offer) throw new DriverError('chat_not_party');
      return { pair: this.requestPair(r, withId), role: 'customer' };
    }
    if (withId !== undefined && withId !== r.riderId && withId !== actorId) throw new DriverError('chat_not_party');
    if (!r.offers.some((o) => o.driverId === actorId)) throw new DriverError('chat_not_party');
    return { pair: this.requestPair(r, actorId), role: 'courier' };
  }

  /**
   * The pairs the caller may see on a run or request, for the list (the driver's riders, the rider's
   * drivers). `partyIds` are the threads that already exist, so a rider who only wrote is listed too.
   */
  async pairsOf(subject: TripChatSubject, id: string, actorId: string, partyIds: readonly string[]): Promise<TripChatPair[]> {
    if (subject === 'departure') {
      const dep = await this.repo.getDeparture(id);
      if (!dep) throw new DriverError('chat_not_party');
      if (actorId !== dep.driverId) return [(await this.pair('departure', id, actorId, undefined, async () => partyIds.includes(actorId))).pair];
      const riders = new Set<string>(partyIds);
      for (const b of await this.repo.bookingsFor(dep.id)) if (RIDER_BOOKING_LIVE.has(b.state)) riders.add(b.riderId);
      for (const a of await this.repo.agreementsFor(dep.id)) riders.add(a.riderId);
      riders.delete(dep.driverId);
      return Promise.all([...riders].map(async (riderId) => (await this.departurePair(dep, riderId)).pair));
    }
    const r = await this.repo.getRequest(id);
    if (!r || !r.privateCar) throw new DriverError('chat_not_party');
    if (actorId === r.riderId) return [...new Set(r.offers.map((o) => o.driverId))].map((d) => this.requestPair(r, d));
    if (!r.offers.some((o) => o.driverId === actorId)) throw new DriverError('chat_not_party');
    return [this.requestPair(r, actorId)];
  }

  /** A stored thread's pair by its keys (no caller: the chat's own retention asks); null when the trip is gone. */
  async pairByParty(subject: TripChatSubject, id: string, partyId: string): Promise<TripChatPair | null> {
    if (subject === 'departure') {
      const dep = await this.repo.getDeparture(id);
      return dep ? (await this.departurePair(dep, partyId)).pair : null;
    }
    const r = await this.repo.getRequest(id);
    return r ? this.requestPair(r, partyId) : null;
  }

  /** The pinned «اللي اتفقنا عليه» strip: the live prices between the two, newest kind first. */
  async deal(pair: TripChatPair): Promise<TripDealItem[]> {
    if (pair.subject === 'departure') {
      const out: TripDealItem[] = [];
      const seen = new Set<string>();
      for (const a of await this.repo.agreementsFor(pair.id, pair.riderId)) {
        if (seen.has(a.kind)) continue;
        const item = dealOf(a);
        if (!item) continue;
        seen.add(a.kind);
        out.push(item);
      }
      return out;
    }
    const r = await this.repo.getRequest(pair.id);
    const offer = r ? latestOffer(r, pair.driverId) : null;
    if (!r || !offer || (offer.cash !== 'asked' && offer.cash !== 'accepted')) return [];
    return [{ kind: 'cash_reservation', refId: offer.id, state: offer.cash === 'asked' ? 'asked' : 'agreed', amountIqd: this.board.depositFor(offer.priceIqd), locked: r.pickedOfferId === offer.id && r.cashReserved }];
  }

  /** The things some cards are about, as they stand now (by ref id; a missing ref is left out). */
  async cards(pair: TripChatPair, refs: ReadonlyArray<{ kind: TripCardKind; refId: string }>): Promise<Map<string, TripCardLive>> {
    const out = new Map<string, TripCardLive>();
    if (refs.length === 0) return out;
    if (pair.subject === 'departure') {
      const dep = await this.repo.getDeparture(pair.id);
      const byId = new Map((await this.repo.agreementsFor(pair.id, pair.riderId)).map((a) => [a.id, a]));
      for (const ref of refs) {
        const a = byId.get(ref.refId);
        if (!a) continue;
        out.set(ref.refId, { state: a.state, amountIqd: a.amountIqd, note: a.note, distanceKm: dep && a.kind === 'pin_pickup' ? this.kmFromGarage(dep, a) : null, expiresAt: a.state === 'proposed' ? a.expiresAt : null });
      }
      return out;
    }
    const r = await this.repo.getRequest(pair.id);
    if (!r) return out;
    for (const ref of refs) {
      const offer = r.offers.find((o) => o.id === ref.refId && o.driverId === pair.driverId);
      if (!offer) continue;
      const state: TripCardLive['state'] = offer.cash === 'accepted' ? (r.pickedOfferId === offer.id && r.cashReserved ? 'used' : 'accepted') : offer.cash === 'declined' ? 'declined' : offer.state === 'open' ? 'asked' : 'expired';
      out.set(ref.refId, { state, amountIqd: this.board.depositFor(offer.priceIqd), note: null, distanceKm: null, expiresAt: null });
    }
    return out;
  }

  /** Who a new card is between, from the routes event that made it (null when the trip is gone). */
  async cardTarget(subject: TripChatSubject, id: string, person: { riderId?: string | null; driverId?: string | null }): Promise<TripCardTarget | null> {
    if (subject === 'departure') {
      const dep = await this.repo.getDeparture(id);
      if (!dep || !person.riderId) return null;
      return { subject, id, partyId: person.riderId, riderId: person.riderId, driverId: dep.driverId };
    }
    const r = await this.repo.getRequest(id);
    if (!r || !person.driverId) return null;
    return { subject, id, partyId: person.driverId, riderId: r.riderId, driverId: person.driverId };
  }

  // ───────────────────────── internals ─────────────────────────

  private async departurePair(dep: DepartureRecord, riderId: string): Promise<{ pair: TripChatPair; engaged: boolean }> {
    const bookings = (await this.repo.bookingsFor(dep.id)).filter((b) => b.riderId === riderId);
    const booked = bookings.some((b) => RIDER_BOOKING_LIVE.has(b.state));
    const asked = (await this.repo.agreementsFor(dep.id, riderId)).length > 0;
    const ended = dep.closedAt ?? dep.arrivedAt ?? dep.cancelledAt;
    // A rider without a seat talks until the car leaves; a rider in the car, until it arrives.
    const end = ended ?? (!booked ? dep.departedAt : null);
    const { status, closesAt } = this.closing(end);
    return {
      pair: {
        subject: 'departure',
        id: dep.id,
        riderId,
        driverId: dep.driverId,
        partyId: riderId,
        status,
        closesAt,
        trip: { subject: 'departure', id: dep.id, fromCityId: dep.fromCityId, toCityId: dep.toCityId, toLabel: null, when: dep.departAt, booked },
      },
      engaged: booked || asked,
    };
  }

  private requestPair(r: RequestRecord, driverId: string): TripChatPair {
    const offer = latestOffer(r, driverId);
    const picked = r.pickedOfferId !== null && r.offers.some((o) => o.id === r.pickedOfferId && o.driverId === driverId);
    let status: ChatThreadStatus;
    let closesAt: Date | null = null;
    if (r.state === 'open') status = offer?.state === 'open' ? 'open' : 'closed';
    else if (!picked) status = 'closed';
    else if (r.state === 'matched' || r.state === 'driver_arrived') status = 'open';
    else ({ status, closesAt } = this.closing(r.closedAt ?? this.clock.now()));
    return {
      subject: 'request',
      id: r.id,
      riderId: r.riderId,
      driverId,
      partyId: driverId,
      status,
      closesAt,
      trip: { subject: 'request', id: r.id, fromCityId: r.cityId, toCityId: null, toLabel: r.to.label, when: r.when, booked: picked },
    };
  }

  private closing(end: Date | null): { status: ChatThreadStatus; closesAt: Date | null } {
    if (!end) return { status: 'open', closesAt: null };
    const closesAt = new Date(end.getTime() + CHAT_CLOSE_AFTER_MIN * 60_000);
    return { status: this.clock.now().getTime() >= closesAt.getTime() ? 'closed' : 'open', closesAt };
  }

  /** How far a pin is from the garage the run leaves from (the driver's reason for a price), km to one decimal. */
  private kmFromGarage(dep: DepartureRecord, place: { lat: number; lng: number }): number | null {
    const g = this.network.garages.find((x) => x.id === dep.garageId);
    return g ? Math.round(haversineMeters(g, place) / 100) / 10 : null;
  }
}

/** A driver's newest offer on a request (a withdrawn one may be followed by a new price). */
function latestOffer(r: RequestRecord, driverId: string) {
  const mine = r.offers.filter((o) => o.driverId === driverId);
  return mine.find((o) => o.state === 'open' || o.state === 'picked') ?? mine[mine.length - 1] ?? null;
}

function dealOf(a: AgreementRecord): TripDealItem | null {
  if (a.state === 'asked') return { kind: a.kind, refId: a.id, state: 'asked', amountIqd: null, locked: false };
  if (a.state === 'proposed') return { kind: a.kind, refId: a.id, state: 'proposed', amountIqd: a.amountIqd, locked: false };
  if (a.state === 'accepted' || a.state === 'used') return { kind: a.kind, refId: a.id, state: 'agreed', amountIqd: a.amountIqd, locked: a.state === 'used' };
  return null;
}
