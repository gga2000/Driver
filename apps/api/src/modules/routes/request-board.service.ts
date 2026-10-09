import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AZIZIYAH_MONEY_RULES,
  DEFAULT_REQUEST_DETAILS,
  DriverError,
  encodeDomainEvent,
  isDomainEventType,
  offerNeedsWaitTerms,
  PostRequestInput,
  requestKnownPlace,
  sharePlaceIqd,
  USUAL_RANGE_DAYS,
  usualRangeOf,
  waitExtraIqd,
  waitedMinutes,
  type MoneyRules,
  type OfferWaitTerms,
  type RequestPlaceId,
  type RequestShareBoardedBy,
  type RequestShareView,
  type RequestTripKind,
  type RequestWaitClock,
  type TravellingAs,
  type UsualRange,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { haversineMeters } from '../trips/index.js';
import { ROUTES_EVENTS, type RoutesEventEmitter } from './events.adapter.js';
import type { IntercityNetworkConfig, IntercityRules } from './intercity.config.js';
import { randomInt } from 'node:crypto';
import { sharedIqd, sharedPlaces, type RequestOfferRecord, type RequestRecord, type RequestShareMemberRecord } from './model.js';
import { ROUTES_REQUEST_RIDERS, type RequestRidersPort } from './request-riders.js';
import { ROUTES_REPOSITORY, type RoutesRepository } from './routes.repository.js';
import { MIN_MS, ROUTES_IDS, roundUpTo, walletHolds, type IdSource } from './support.js';
import { ROUTES_NETWORK, ROUTES_RULES } from './tokens.js';
import { ROUTES_WALLET, type WalletPort } from './wallet.js';
import { RoutesWriter } from './writer.js';

type PostInput = z.output<typeof PostRequestInput>;

/**
 * The request board (customer spec §2, review C-50): trips to other destinations and private cars.
 * A rider posts; intercity drivers offer in multiples of 1,000; the rider picks one and 20 % of it
 * (min 5,000) is held on the wallet. Driver no-show: the rider is credited 2× the deposit from the
 * driver's balance; rider no-show (or a late cancel): the deposit goes to the driver. A completed
 * trip settles as a private intercity ride (8 % take), the deposit counted as paid from the wallet.
 *
 * Money goes through the ledger's existing posting groups via the events it already subscribes to:
 * completion → `order.closed` (kind `ride`, `intercity_private`), rider no-show → `order.cancelled`
 * (fee = deposit, beneficiary the driver), driver no-show → `departure.cancelled` (fee = 2× deposit,
 * driver → rider). Each carries `requestId` (`rq_…`) and no trip / order / departure id, so the ledger
 * posts them under `request:<id>:…` groups with no foreign-key refs (docs/api/ledger-request-board.md).
 *
 * Step 4b a6 «احجز وادفع كاش» (switch `requestCashReservation`): the rider asks a driver who offered,
 * the driver says yes, and the pick holds nothing. The deposit amount is still worked out and kept: a
 * rider no-show or late cancel posts the same `order.cancelled` fee, which with nothing held stays on
 * his wallet as debt (the platform's wallet-debt rule) while the driver is paid; a driver no-show
 * credits the rider that amount once (nothing of his was held to give back).
 *
 * Step 6 (item 56, s1–s4; switch `requestSharing`): the booker shares the picked car by a link; each
 * friend's places are held on his own wallet and paid straight to the driver when the trip completes
 * (`order.closed` ride `sharedBy`), so the booker's cash shrinks by that much. Joining closes before
 * the trip; places nobody took stay the booker's, in cash. Any other end releases every friend's hold.
 */
@Injectable()
export class RequestBoardService {
  constructor(
    @Inject(ROUTES_REPOSITORY) private readonly repo: RoutesRepository,
    @Inject(ROUTES_EVENTS) private readonly events: RoutesEventEmitter,
    @Inject(ROUTES_WALLET) private readonly wallet: WalletPort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly writer: RoutesWriter,
    @Inject(ROUTES_NETWORK) private readonly network: IntercityNetworkConfig,
    @Inject(ROUTES_RULES) private readonly rules: IntercityRules,
    @Inject(ROUTES_IDS) private readonly ids: IdSource,
    @Optional() @Inject(ROUTES_REQUEST_RIDERS) readonly riders: RequestRidersPort | null = null,
  ) {}

  /** The money rules this board reads (w4's and 4b's switches); a field so tests can switch them on. */
  moneyRules: Pick<MoneyRules, 'requestWaitExtra' | 'requestCashReservation' | 'requestSharing'> = AZIZIYAH_MONEY_RULES;

  private now(): Date {
    return this.clock.now();
  }

  /** One request by id (the safety module checks who is on a private ride); null when unknown. */
  get(id: string): Promise<RequestRecord | null> {
    return this.repo.getRequest(id);
  }

  // ───────────────────────── rider ─────────────────────────

  /**
   * A rider posts a request. k2 «جيب واحد»: the person fetched is resolved first (a typed number may
   * become a new pseudonymous person in identity's own write), then the request is written with only
   * their person id, then the name the poster gave them goes to the vault under the request.
   */
  async post(riderId: string, input: PostInput): Promise<RequestRecord> {
    const fetching = input.details.trip === 'fetch';
    if (fetching !== Boolean(input.rider)) throw new DriverError('invalid_input');
    if (input.rider && !this.riders) throw new DriverError('ride_rider_unknown');
    const fetched = input.rider && this.riders ? await this.riders.resolve(riderId, input.rider) : null;
    const r = await this.writer.run(async (tx) => {
      if (input.when.getTime() < this.now().getTime() - 15 * MIN_MS)
        throw new DriverError('invalid_input');
      const garage = input.from.garageId
        ? this.network.garages.find((g) => g.id === input.from.garageId)
        : undefined;
      if (input.from.garageId && !garage) throw new DriverError('garage_not_found');
      const r = this.record(riderId, {
        from: { ...input.from, ...(garage ? { lat: garage.lat, lng: garage.lng } : {}) },
        to: input.to,
        cityId: garage?.cityId ?? null,
        when: input.when,
        seats: input.seats,
        privateCar: input.privateCar,
        travellingAs: input.travellingAs,
        note: input.note ?? null,
        details: input.details,
        origin: 'rider',
        priceCapIqd: null,
      });
      r.fetchPersonId = fetched?.personId ?? null;
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.posted', riderId, r, {
        when: r.when,
        seats: r.seats,
        privateCar: r.privateCar,
        to: r.to.label,
      });
      return r;
    });
    if (fetched && this.riders) await this.riders.remember(r.id, fetched.personId, riderId, fetched.name);
    return r;
  }

  /**
   * k2: whom the picked driver's call rings: the person fetched on a «جيب واحد» trip, else the poster.
   * Only while the trip is live, and logged on the request (the call id, never a number).
   */
  async callee(driverId: string, postId: string, callId: string): Promise<{ request: RequestRecord; calleeId: string }> {
    return this.writer.run(async (tx) => {
      const r = await this.must(postId, tx);
      if (this.picked(r).driverId !== driverId) throw new DriverError('request_state_conflict');
      if (r.state !== 'matched' && r.state !== 'driver_arrived') throw new DriverError('request_state_conflict');
      const calleeId = r.fetchPersonId ?? r.riderId;
      await this.emit(tx, 'request.call_requested', driverId, r, { calleeId, callId });
      return { request: r, calleeId };
    });
  }

  /**
   * Review C-40/46: a forfeited or stranded rider with no departure within 2 h gets a private-car
   * post opened for her at the seat price (offers above it are refused). Runs inside the caller's write.
   */
  async openForStranded(
    tx: Tx,
    s: {
      riderId: string;
      garageId: string;
      toLabel: string;
      seats: number;
      travellingAs: TravellingAs;
      priceCapIqd: number;
      bookingId: string;
    },
  ): Promise<RequestRecord> {
    const garage = this.network.garages.find((g) => g.id === s.garageId);
    const r = this.record(s.riderId, {
      from: {
        label: garage?.nameAr ?? s.garageId,
        garageId: s.garageId,
        ...(garage ? { lat: garage.lat, lng: garage.lng } : {}),
      },
      to: { label: s.toLabel },
      cityId: garage?.cityId ?? null,
      when: this.now(),
      seats: s.seats,
      privateCar: true,
      travellingAs: s.travellingAs,
      note: null,
      details: { ...DEFAULT_REQUEST_DETAILS },
      origin: 'stranded',
      priceCapIqd: s.priceCapIqd,
    });
    await this.repo.saveRequest(r, tx);
    await this.emit(tx, 'request.posted', 'system', r, {
      stranded: true,
      bookingId: s.bookingId,
      priceCapIqd: s.priceCapIqd,
    });
    return r;
  }

  /**
   * p1–p3: what a private trip to a known place, of this kind, usually cost, from finished trips of
   * the last 90 days only (at least 5); null otherwise, so no number is ever made up.
   */
  async usualRange(placeId: RequestPlaceId, trip: RequestTripKind, tx?: Tx): Promise<UsualRange | null> {
    const since = new Date(this.now().getTime() - USUAL_RANGE_DAYS * 86_400_000);
    return usualRangeOf(await this.repo.completedPrivatePrices({ placeId, trip, since }, tx));
  }

  /** The usual range of each post that names a known place, one read per place and kind. */
  async usualRanges(records: readonly RequestRecord[]): Promise<Map<string, UsualRange | null>> {
    const byKey = new Map<string, Promise<UsualRange | null>>();
    const out = new Map<string, UsualRange | null>();
    for (const r of records) {
      const placeId = requestKnownPlace(r);
      if (!placeId || !r.privateCar || r.origin !== 'rider') continue;
      const key = `${placeId}|${r.details.trip}`;
      if (!byKey.has(key)) byKey.set(key, this.usualRange(placeId, r.details.trip));
      out.set(r.id, await byKey.get(key)!);
    }
    return out;
  }

  mine(riderId: string): Promise<RequestRecord[]> {
    return this.repo.listRequests({ riderId });
  }

  /**
   * The rider picks an offer: 20 % of it (min 5,000) is held on his wallet, or with `cash` (4b a6) on
   * the driver's «احجز وادفع كاش» yes nothing is held and the amount is only owed on a no-show.
   */
  pick(riderId: string, postId: string, offerId: string, cash = false): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustOwn(riderId, postId, tx);
      if (r.state !== 'open') throw new DriverError('request_state_conflict');
      const offer = r.offers.find((o) => o.id === offerId && o.state === 'open');
      if (!offer) throw new DriverError('request_state_conflict');
      const deposit = this.depositFor(offer.priceIqd);
      if (cash) {
        if (offer.cash !== 'accepted') throw new DriverError('request_state_conflict');
        await this.assertMayReserveCash(riderId, tx);
      } else {
        // SEC-07: under the rider's wallet lock (taken by the writer), net of every other hold on it.
        const available =
          (await this.wallet.balance(riderId)) -
          (await walletHolds(this.repo, riderId, tx)) -
          (await this.wallet.heldElsewhere(riderId, tx));
        if (available < deposit) throw new DriverError('wallet_insufficient');
      }
      for (const o of r.offers)
        o.state = o.id === offerId ? 'picked' : o.state === 'open' ? 'lost' : o.state;
      r.state = 'matched';
      r.pickedOfferId = offerId;
      r.depositIqd = deposit;
      r.cashReserved = cash;
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.matched', riderId, r, {
        driverId: offer.driverId,
        priceIqd: offer.priceIqd,
        depositIqd: deposit,
        cashReserved: cash,
        // k2: whom a «جيب واحد» trip fetches (lane D's `request_for_rider` SMS reads it); never a phone.
        fetchPersonId: r.fetchPersonId,
      });
      return r;
    }, { walletLocks: [riderId] });
  }

  /**
   * 4b a6: the rider asks the driver behind one open offer whether he may book and pay all of it in
   * cash. Once per offer: a no stands (a new price from the driver is a new offer).
   */
  askCash(riderId: string, postId: string, offerId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustOwn(riderId, postId, tx);
      if (r.state !== 'open') throw new DriverError('request_state_conflict');
      const offer = r.offers.find((o) => o.id === offerId && o.state === 'open');
      if (!offer) throw new DriverError('request_state_conflict');
      await this.assertMayReserveCash(riderId, tx);
      if (offer.cash === 'asked' || offer.cash === 'accepted') return r;
      if (offer.cash === 'declined') throw new DriverError('request_state_conflict');
      offer.cash = 'asked';
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.cash_asked', riderId, r, {
        offerId,
        driverId: offer.driverId,
        noShowIqd: this.depositFor(offer.priceIqd),
      });
      return r;
    });
  }

  /** Free while open, or more than an hour before the trip; later, the deposit goes to the driver. */
  cancel(riderId: string, postId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustOwn(riderId, postId, tx);
      if (r.state === 'open') {
        r.state = 'cancelled';
        r.closedAt = this.now();
        for (const o of r.offers) if (o.state === 'open') o.state = 'lost';
        await this.repo.saveRequest(r, tx);
        await this.emit(tx, 'request.cancelled', riderId, r, { free: true });
        return r;
      }
      if (r.state !== 'matched') throw new DriverError('request_state_conflict');
      const late = this.now().getTime() >= r.when.getTime() - 60 * MIN_MS;
      r.state = 'cancelled';
      r.closedAt = this.now();
      const released = this.releaseShares(r);
      await this.repo.saveRequest(r, tx);
      await this.emitReleased(tx, riderId, r, released, 'rider_cancelled');
      if (late) await this.forfeitDeposit(tx, r, 'request_board_late_cancel');
      await this.emit(tx, 'request.cancelled', riderId, r, {
        free: !late,
        depositForfeitedIqd: late ? r.depositIqd : 0,
      });
      return r;
    });
  }

  /**
   * The rider reports the driver did not come: 2× the deposit from the driver's balance (his held
   * deposit back and the same again). On a cash reservation nothing was held, so it is 1× (Ali, 50).
   */
  driverNoShow(riderId: string, postId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustOwn(riderId, postId, tx);
      if (r.state !== 'matched') throw new DriverError('request_state_conflict');
      if (
        this.now().getTime() <
        r.when.getTime() + this.rules.requestBoard.driverNoShowAfterMin * MIN_MS
      )
        throw new DriverError('no_show_not_allowed');
      const offer = this.picked(r);
      const creditIqd = (r.cashReserved ? 1 : 2) * (r.depositIqd ?? 0);
      r.state = 'driver_no_show';
      r.closedAt = this.now();
      const released = this.releaseShares(r);
      await this.repo.saveRequest(r, tx);
      await this.emitReleased(tx, riderId, r, released, 'driver_no_show');
      await this.emit(tx, 'departure.cancelled', riderId, r, {
        requestId: r.id,
        occurredAt: this.now(),
        driverId: offer.driverId,
        cancelledBy: 'driver',
        feeIqd: creditIqd,
        riderIds: [r.riderId],
      });
      await this.emit(tx, 'request.driver_no_show', riderId, r, {
        driverId: offer.driverId,
        creditIqd,
      });
      return r;
    });
  }

  // ───────────────────────── driver ─────────────────────────

  /** Open posts a driver may offer on (newest trips first excluded: past posts are not shown). */
  async listOpen(driverId: string, cityId?: string): Promise<RequestRecord[]> {
    const now = this.now().getTime();
    return (await this.repo.listRequests({ states: ['open'] })).filter(
      (r) =>
        r.riderId !== driverId &&
        r.when.getTime() + this.rules.requestBoard.expireAfterMin * MIN_MS > now &&
        (!cityId || r.cityId === cityId),
    );
  }

  /**
   * y4: a driver opened the request. Recorded once per driver while it is open, so the rider sees
   * «N سواق شافوا طلبك»; no event (nothing to settle or notify). It runs under the routes writer
   * (in-process mutex + the transaction's advisory lock, taken before the read) and writes only the
   * seen list, in one conditional update, so it can never put a picked request back to «open».
   */
  seen(driverId: string, postId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.must(postId, tx);
      if (r.riderId === driverId) throw new DriverError('forbidden');
      // Past «open» only a driver who offered on it may still read it (the pick and the deposit are
      // between the rider and the drivers who took part).
      if (r.state !== 'open') {
        if (!r.offers.some((o) => o.driverId === driverId)) throw new DriverError('request_not_found');
        return r;
      }
      if (await this.repo.markRequestSeen(postId, driverId, tx)) r.seenDriverIds.push(driverId);
      return r;
    });
  }

  offer(
    driverId: string,
    postId: string,
    priceIqd: number,
    wait?: OfferWaitTerms,
  ): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.must(postId, tx);
      if (r.state !== 'open') throw new DriverError('request_state_conflict');
      if (r.riderId === driverId) throw new DriverError('forbidden');
      const step = this.rules.requestBoard.offerStepIqd;
      if (priceIqd <= 0 || priceIqd % step !== 0) throw new DriverError('offer_price_invalid');
      if (r.priceCapIqd !== null && priceIqd > r.priceCapIqd)
        throw new DriverError('offer_price_invalid');
      // w1: a «يستناك وترجع» offer names its waiting terms; no other trip kind carries them.
      if (offerNeedsWaitTerms(r.details) !== (wait !== undefined))
        throw new DriverError('offer_wait_terms_invalid');
      // The contract already floors it at 0; checked here too because -5000 % 1000 is -0, which passes the step.
      if (wait && (wait.extraHourIqd < 0 || wait.extraHourIqd % step !== 0)) throw new DriverError('offer_wait_terms_invalid');
      // 4b: a new price replaces his offer; a cash ask on it, and his yes, carry over to the new one.
      const before = r.offers.find((o) => o.driverId === driverId && o.state === 'open');
      for (const o of r.offers)
        if (o.driverId === driverId && o.state === 'open') o.state = 'withdrawn';
      const offer: RequestOfferRecord = {
        id: this.ids.id('rqo'),
        driverId,
        priceIqd,
        wait: wait ? { includedHours: wait.includedHours, extraHourIqd: wait.extraHourIqd } : null,
        at: this.now(),
        state: 'open',
        cash: before?.cash ?? null,
      };
      r.offers.push(offer);
      // An offer means he read it, even from a list that never opened the detail.
      if (!r.seenDriverIds.includes(driverId)) r.seenDriverIds.push(driverId);
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.offer_made', driverId, r, {
        offerId: offer.id,
        priceIqd,
        riderId: r.riderId,
        ...(offer.wait ? { wait: offer.wait } : {}),
      });
      return r;
    });
  }

  /** 4b a6: the driver answers «احجز وادفع كاش» on his own open offer. */
  answerCash(driverId: string, postId: string, offerId: string, accept: boolean): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.must(postId, tx);
      if (!this.moneyRules.requestCashReservation.enabled) throw new DriverError('forbidden');
      const offer = r.offers.find((o) => o.id === offerId);
      if (!offer || offer.driverId !== driverId) throw new DriverError('request_not_found');
      if (r.state !== 'open' || offer.state !== 'open' || offer.cash !== 'asked')
        throw new DriverError('request_state_conflict');
      offer.cash = accept ? 'accepted' : 'declined';
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.cash_answered', driverId, r, {
        offerId,
        riderId: r.riderId,
        accepted: accept,
      });
      return r;
    });
  }

  arrived(
    driverId: string,
    postId: string,
    at: { lat: number; lng: number },
  ): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustDrive(driverId, postId, tx);
      if (r.state !== 'matched') throw new DriverError('request_state_conflict');
      r.state = 'driver_arrived';
      r.driverArrivedAt = this.now();
      r.driverArrivedPin = { lat: at.lat, lng: at.lng };
      await this.repo.saveRequest(r, tx);
      const from =
        r.from.lat !== undefined && r.from.lng !== undefined
          ? { lat: r.from.lat, lng: r.from.lng }
          : null;
      const distanceM = from ? Math.round(haversineMeters(at, from)) : null;
      await this.emit(tx, 'request.driver_arrived', driverId, r, {
        distanceM,
        outside: distanceM !== null && distanceM > this.rules.requestBoard.arrivalGeofenceM,
      });
      return r;
    });
  }

  /** w2: the driver dropped the rider and starts waiting («يستناك وترجع» only, once). */
  waitStart(driverId: string, postId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustDrive(driverId, postId, tx);
      if (r.state !== 'matched' && r.state !== 'driver_arrived')
        throw new DriverError('request_state_conflict');
      if (!offerNeedsWaitTerms(r.details) || r.waitStartedAt) throw new DriverError('request_state_conflict');
      r.waitStartedAt = this.now();
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.wait_started', driverId, r, {});
      return r;
    });
  }

  /** w2: the rider is back in the car; the clock stops and the extra hours (if any) are fixed. */
  waitEnd(driverId: string, postId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustDrive(driverId, postId, tx);
      if ((r.state !== 'matched' && r.state !== 'driver_arrived') || !r.waitStartedAt || r.waitEndedAt)
        throw new DriverError('request_state_conflict');
      r.waitEndedAt = this.now();
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.wait_ended', driverId, r, {
        waitedMin: waitedMinutes({ startedAt: r.waitStartedAt, endedAt: r.waitEndedAt }, r.waitEndedAt),
        extraIqd: this.waitExtra(r),
      });
      return r;
    });
  }

  /**
   * Completed: a private intercity ride (8 %); the deposit was paid from the wallet, the rest in cash.
   * A clock still running stops here; extra waiting (w4, when switched on) is added to the fare and the cash.
   */
  complete(driverId: string, postId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustDrive(driverId, postId, tx);
      if (r.state !== 'matched' && r.state !== 'driver_arrived')
        throw new DriverError('request_state_conflict');
      const offer = this.picked(r);
      // The held deposit was paid from the wallet; a cash reservation held nothing, so all of it is cash.
      const deposit = r.cashReserved ? 0 : (r.depositIqd ?? 0);
      if (r.waitStartedAt && !r.waitEndedAt) r.waitEndedAt = this.now();
      const fareIqd = offer.priceIqd + this.waitExtra(r);
      // Step 6: friends' held places are paid from their wallets; the booker owes the rest, his
      // deposit first (never more than his part), then cash.
      const sharedBy = (r.share?.members ?? [])
        .filter((m) => m.state === 'joined')
        .map((m) => ({ customerId: m.personId, amountIqd: m.amountIqd }));
      const friendsIqd = sharedBy.reduce((n, m) => n + m.amountIqd, 0);
      for (const m of r.share?.members ?? []) {
        if (m.state !== 'joined') continue;
        m.state = 'paid';
        m.closedAt = this.now();
      }
      r.state = 'completed';
      r.closedAt = this.now();
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'order.closed', driverId, r, {
        kind: 'ride',
        from: 'completed',
        to: 'closed',
        reason: 'request_board_completed',
        totalIqd: fareIqd,
        ride: {
          requestId: r.id,
          occurredAt: this.now(),
          customerId: r.riderId,
          payment: 'cash',
          cashCollectedIqd: Math.max(0, fareIqd - friendsIqd - deposit),
          driverId,
          takeClass: 'intercity_private',
          fareIqd,
          ...(sharedBy.length > 0 ? { sharedBy } : {}),
        },
      });
      return r;
    });
  }

  /** w4: what the waiting adds, from the picked offer's terms and the two clock times (0 while off). */
  waitExtra(r: RequestRecord, now: Date = this.now()): number {
    const clock = waitClockOf(r, this.moneyRules.requestWaitExtra);
    return clock ? waitExtraIqd(clock, now) : 0;
  }

  /**
   * The driver waited at the pickup: the deposit is his (review C-50). On a cash reservation the same
   * amount is posted with nothing held, so it stays on the rider's wallet as debt.
   */
  riderNoShow(driverId: string, postId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustDrive(driverId, postId, tx);
      if (r.state !== 'driver_arrived' || !r.driverArrivedAt)
        throw new DriverError('request_state_conflict');
      const from = Math.max(r.driverArrivedAt.getTime(), r.when.getTime());
      if (this.now().getTime() < from + this.rules.requestBoard.riderNoShowWaitMin * MIN_MS)
        throw new DriverError('no_show_not_allowed');
      r.state = 'rider_no_show';
      r.closedAt = this.now();
      const released = this.releaseShares(r);
      await this.repo.saveRequest(r, tx);
      await this.emitReleased(tx, driverId, r, released, 'rider_no_show');
      await this.forfeitDeposit(tx, r, 'request_board_rider_no_show');
      await this.emit(tx, 'request.rider_no_show', driverId, r, { depositIqd: r.depositIqd, cashReserved: r.cashReserved });
      return r;
    });
  }

  // ───────────────────────── step 6: sharing the car ─────────────────────────

  /** When joining a shared car closes (s3): the places nobody took stay the booker's from then. */
  shareClosesAt(r: RequestRecord): Date {
    return new Date(r.when.getTime() - this.moneyRules.requestSharing.closeBeforeMin * MIN_MS);
  }

  /** Whether friends can still join or leave. */
  shareOpen(r: RequestRecord): boolean {
    return (
      this.moneyRules.requestSharing.enabled &&
      r.share !== null &&
      r.state === 'matched' &&
      this.now().getTime() < this.shareClosesAt(r).getTime()
    );
  }

  /** Whether the booker can open the link (or change his own places) now. */
  shareable(r: RequestRecord): boolean {
    return (
      this.moneyRules.requestSharing.enabled &&
      r.privateCar &&
      r.state === 'matched' &&
      r.seats >= 2 &&
      this.now().getTime() < this.shareClosesAt(r).getTime()
    );
  }

  /**
   * s1/s2: the booker opens the link. Everyone in the car is the people he posted for; `bookerPlaces`
   * of them are his own, the rest are offered at one even place price (rounded down to 250, fixed
   * now). Calling it again changes his places, never below what friends already hold.
   */
  openShare(riderId: string, postId: string, bookerPlaces: number): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      if (!this.moneyRules.requestSharing.enabled) throw new DriverError('forbidden');
      const r = await this.mustOwn(riderId, postId, tx);
      if (!r.privateCar || r.state !== 'matched' || r.seats < 2) throw new DriverError('request_state_conflict');
      if (this.now().getTime() >= this.shareClosesAt(r).getTime()) throw new DriverError('share_closed');
      if (bookerPlaces >= r.seats) throw new DriverError('invalid_input');
      if (r.share) {
        if (r.seats - bookerPlaces < sharedPlaces(r.share)) throw new DriverError('share_full');
        if (r.share.bookerPlaces === bookerPlaces) return r;
        r.share.bookerPlaces = bookerPlaces;
      } else {
        const placeIqd = sharePlaceIqd(this.picked(r).priceIqd, r.seats);
        // A place must cost something: a 0 share would fail the ride's money at completion.
        if (placeIqd <= 0) throw new DriverError('request_state_conflict');
        r.share = {
          code: await this.newShareCode(tx),
          bookerPlaces,
          placeIqd,
          openedAt: this.now(),
          members: [],
        };
      }
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.share_opened', riderId, r, {
        people: r.seats,
        bookerPlaces,
        placeIqd: r.share.placeIqd,
        closesAt: this.shareClosesAt(r),
      });
      return r;
    });
  }

  /** The request a link opens; unknown codes and switched-off sharing read as not found. */
  async byShareCode(code: string, tx?: Tx): Promise<RequestRecord> {
    const r = this.moneyRules.requestSharing.enabled ? await this.repo.getRequestByShareCode(code, tx) : null;
    if (!r?.share) throw new DriverError('share_not_found');
    return r;
  }

  /**
   * s1: a friend takes places from the link. They are held on his own wallet (checked against what
   * his other bookings already hold) until the trip ends. One join per person: to change his places
   * he leaves and joins again.
   */
  joinShare(personId: string, code: string, places: number): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.byShareCode(code, tx);
      const share = r.share!;
      if (personId === r.riderId || personId === this.picked(r).driverId) throw new DriverError('forbidden');
      if (!this.shareOpen(r)) throw new DriverError('share_closed');
      const mine = share.members.find((m) => m.personId === personId && m.state === 'joined');
      if (mine) {
        if (mine.places === places) return r;
        throw new DriverError('request_state_conflict');
      }
      if (places > r.seats - share.bookerPlaces - sharedPlaces(share)) throw new DriverError('share_full');
      const amountIqd = places * share.placeIqd;
      // SEC-07, as `pick`: under the friend's wallet lock (taken by the writer), net of every other hold on it.
      const available =
        (await this.wallet.balance(personId)) -
        (await walletHolds(this.repo, personId, tx)) -
        (await this.wallet.heldElsewhere(personId, tx));
      if (available < amountIqd) throw new DriverError('wallet_insufficient');
      const member = {
        id: this.ids.id('rqs'),
        personId,
        places,
        amountIqd,
        state: 'joined' as const,
        joinedAt: this.now(),
        closedAt: null,
        boardedAt: null,
        boardedBy: null,
      };
      share.members.push(member);
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.share_joined', personId, r, {
        memberId: member.id,
        personId,
        places,
        amountIqd,
        riderId: r.riderId,
        driverId: this.picked(r).driverId,
      });
      return r;
    }, { walletLocks: [personId] });
  }

  /** A friend leaves before joining closes; his hold is released at once. */
  leaveShare(personId: string, code: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.byShareCode(code, tx);
      const mine = r.share!.members.find((m) => m.personId === personId && m.state === 'joined');
      if (!mine) throw new DriverError('request_state_conflict');
      if (!this.shareOpen(r)) throw new DriverError('share_closed');
      mine.state = 'left';
      mine.closedAt = this.now();
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.share_left', personId, r, {
        memberId: mine.id,
        personId,
        places: mine.places,
        riderId: r.riderId,
      });
      return r;
    });
  }

  // ── way C (Ali 2026-10-09: "c"): who got in. A record only: what each friend pays is unchanged. ──

  /**
   * A friend's «صعدت»: once the driver pressed «وصلت», and within `shareBoardNearM` of where he did
   * (the friend's position is checked, never stored). Saying it twice is a no-op.
   */
  boardShare(personId: string, code: string, at: { lat: number; lng: number }): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.byShareCode(code, tx);
      const m = this.heldMember(r, personId);
      if (m.boardedAt) return r;
      if (r.state !== 'driver_arrived') throw new DriverError('request_state_conflict');
      const car = r.driverArrivedPin;
      if (car && haversineMeters(at, car) > this.rules.requestBoard.shareBoardNearM) throw new DriverError('share_board_far');
      return this.markBoarded(tx, r, m, 'self', personId);
    });
  }

  /** The picked driver's «صعد» for a friend whose phone can't (logged; the friend is told and can answer «ما صعدت»). */
  boardShareFor(driverId: string, postId: string, memberId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustDrive(driverId, postId, tx);
      const m = r.share?.members.find((x) => x.id === memberId && x.state === 'joined');
      if (!m) throw new DriverError('share_not_found');
      if (m.boardedAt) return r;
      if (r.state !== 'driver_arrived') throw new DriverError('request_state_conflict');
      return this.markBoarded(tx, r, m, 'driver', driverId);
    });
  }

  /**
   * A friend's «ما صعدت» on the driver's tap for him: the mark is cleared and the event is the record
   * support reads. His own «صعدت» can't be taken back, and what he pays does not change here.
   */
  denyShareBoard(personId: string, code: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.byShareCode(code, tx);
      const m = this.heldMember(r, personId);
      if (m.boardedBy !== 'driver') throw new DriverError('request_state_conflict');
      const markedAt = m.boardedAt;
      m.boardedAt = null;
      m.boardedBy = null;
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.share_board_denied', personId, r, {
        memberId: m.id,
        personId,
        markedAt,
        riderId: r.riderId,
        driverId: this.picked(r).driverId,
      });
      return r;
    });
  }

  /** His places on this car, held (joined) or paid at the end; anyone else: `share_not_found`. */
  private heldMember(r: RequestRecord, personId: string): RequestShareMemberRecord {
    const m = r.share?.members.find((x) => x.personId === personId && (x.state === 'joined' || x.state === 'paid'));
    if (!m) throw new DriverError('share_not_found');
    return m;
  }

  private async markBoarded(tx: Tx, r: RequestRecord, m: RequestShareMemberRecord, by: RequestShareBoardedBy, actorId: string): Promise<RequestRecord> {
    m.boardedAt = this.now();
    m.boardedBy = by;
    await this.repo.saveRequest(r, tx);
    await this.emit(tx, 'request.share_boarded', actorId, r, {
      memberId: m.id,
      personId: m.personId,
      by,
      riderId: r.riderId,
      driverId: this.picked(r).driverId,
    });
    return r;
  }

  /** Shared cars this person joined that are still ahead or on the road. */
  async sharedWith(personId: string): Promise<RequestRecord[]> {
    if (!this.moneyRules.requestSharing.enabled) return [];
    return (await this.repo.listRequests({ memberId: personId, states: ['matched', 'driver_arrived'] })).filter((r) =>
      r.share?.members.some((m) => m.personId === personId && m.state === 'joined'),
    );
  }

  /**
   * The share as the booker (with friends' first names) or the picked driver (no names, no link)
   * sees it; null when the car is not shared.
   */
  shareView(r: RequestRecord, names: Readonly<Record<string, string | null>> | null, link = names !== null): RequestShareView | null {
    const s = r.share;
    if (!s) return null;
    const offer = r.offers.find((o) => o.id === r.pickedOfferId);
    const friendsIqd = sharedIqd(s);
    const deposit = r.cashReserved ? 0 : (r.depositIqd ?? 0);
    const fare = (offer?.priceIqd ?? 0) + this.waitExtra(r);
    return {
      path: link ? `/rajaa/join/${s.code}` : null,
      people: r.seats,
      bookerPlaces: s.bookerPlaces,
      placeIqd: s.placeIqd,
      closesAt: this.shareClosesAt(r),
      open: this.shareOpen(r),
      placesLeft: Math.max(0, r.seats - s.bookerPlaces - sharedPlaces(s)),
      members: s.members.map((m) => ({
        id: m.id,
        firstName: names ? (names[m.personId] ?? null) : null,
        places: m.places,
        amountIqd: m.amountIqd,
        state: m.state,
        boardedBy: m.boardedBy,
      })),
      friendsIqd,
      cashIqd: Math.max(0, fare - friendsIqd - deposit),
    };
  }

  /** s4: every friend still holding places gets them back (the trip will not run for them). */
  private releaseShares(r: RequestRecord): string[] {
    const out: string[] = [];
    for (const m of r.share?.members ?? []) {
      if (m.state !== 'joined') continue;
      m.state = 'released';
      m.closedAt = this.now();
      out.push(m.personId);
    }
    return out;
  }

  private async emitReleased(tx: Tx, actorId: string, r: RequestRecord, personIds: string[], reason: string): Promise<void> {
    if (personIds.length === 0) return;
    await this.emit(tx, 'request.shares_released', actorId, r, { personIds, reason, riderId: r.riderId });
  }

  /** 8 letters and digits people can read out (no I, O, 0, 1); retried on the rare clash. */
  private async newShareCode(tx: Tx): Promise<string> {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
      const code = Array.from({ length: 8 }, () => abc[randomInt(abc.length)]).join('');
      if (!(await this.repo.getRequestByShareCode(code, tx))) return code;
    }
  }

  // ───────────────────────── scheduler ─────────────────────────

  /** Open posts expire an hour after their time. */
  async tick(tx: Tx): Promise<number> {
    const now = this.now().getTime();
    let n = 0;
    for (const r of await this.repo.listRequests({ states: ['open'] }, tx)) {
      if (r.when.getTime() + this.rules.requestBoard.expireAfterMin * MIN_MS > now) continue;
      r.state = 'expired';
      r.closedAt = this.now();
      for (const o of r.offers) if (o.state === 'open') o.state = 'lost';
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.expired', 'system', r, {});
      n += 1;
    }
    return n;
  }

  // ───────────────────────── internals ─────────────────────────

  /** 20 % of the price rounded up to 500, at least 5,000, never more than the price. */
  depositFor(priceIqd: number): number {
    const rb = this.rules.requestBoard;
    return Math.min(
      priceIqd,
      Math.max(rb.depositMinIqd, roundUpTo(priceIqd * rb.depositRate, 500)),
    );
  }

  private async forfeitDeposit(tx: Tx, r: RequestRecord, reason: string): Promise<void> {
    const deposit = r.depositIqd ?? 0;
    if (deposit <= 0) return;
    const offer = this.picked(r);
    await this.emit(tx, 'order.cancelled', r.riderId, r, {
      from: 'placed',
      to: 'customer_cancelled',
      cancelledState: 'customer_cancelled',
      requestId: r.id,
      occurredAt: this.now(),
      customerId: r.riderId,
      by: 'customer',
      reason,
      free: false,
      feeIqd: deposit,
      beneficiaries: [{ kind: 'driver', id: offer.driverId, amountIqd: deposit }],
    });
  }

  private record(
    riderId: string,
    r: Omit<
      RequestRecord,
      | 'id'
      | 'riderId'
      | 'state'
      | 'seenDriverIds'
      | 'offers'
      | 'pickedOfferId'
      | 'depositIqd'
      | 'cashReserved'
      | 'driverArrivedAt'
      | 'driverArrivedPin'
      | 'waitStartedAt'
      | 'waitEndedAt'
      | 'fetchPersonId'
      | 'share'
      | 'closedAt'
      | 'createdAt'
    >,
  ): RequestRecord {
    return {
      id: this.ids.id('rq'),
      riderId,
      ...r,
      state: 'open',
      seenDriverIds: [],
      offers: [],
      pickedOfferId: null,
      depositIqd: null,
      cashReserved: false,
      driverArrivedAt: null,
      driverArrivedPin: null,
      waitStartedAt: null,
      waitEndedAt: null,
      fetchPersonId: null,
      share: null,
      closedAt: null,
      createdAt: this.now(),
    };
  }

  /**
   * 4b: «احجز وادفع كاش» needs the switch on, nothing owed on his wallet (a past no-show is paid
   * first), and his seat cash bookings not revoked for no-shows.
   */
  private async assertMayReserveCash(riderId: string, tx: Tx): Promise<void> {
    if (!this.moneyRules.requestCashReservation.enabled) throw new DriverError('forbidden');
    if ((await this.wallet.balance(riderId)) < 0) throw new DriverError('cash_reservation_owed');
    const stats = await this.repo.riderStats(riderId, tx);
    if (stats.cashStrikes >= this.rules.cashNoShowsToRevoke) throw new DriverError('cash_reservation_revoked');
  }

  private picked(r: RequestRecord) {
    const o = r.offers.find((x) => x.id === r.pickedOfferId);
    if (!o) throw new DriverError('request_state_conflict');
    return o;
  }

  private async must(postId: string, tx?: Tx): Promise<RequestRecord> {
    const r = await this.repo.getRequest(postId, tx);
    if (!r) throw new DriverError('request_not_found');
    return r;
  }

  private async mustOwn(riderId: string, postId: string, tx?: Tx): Promise<RequestRecord> {
    const r = await this.must(postId, tx);
    if (r.riderId !== riderId) throw new DriverError('request_not_found');
    return r;
  }

  private async mustDrive(driverId: string, postId: string, tx?: Tx): Promise<RequestRecord> {
    const r = await this.must(postId, tx);
    if (this.picked(r).driverId !== driverId) throw new DriverError('forbidden');
    return r;
  }

  private async emit(
    tx: Tx,
    type: string,
    actorId: string,
    r: RequestRecord,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const wire = isDomainEventType(type)
      ? encodeDomainEvent(type, payload as never)
      : { requestId: r.id, ...payload };
    await this.events.emit(
      tx,
      { type, actorId, occurredAt: this.now(), payload: wire },
      { name: 'ride_request', id: r.id },
    );
  }
}

/** w2: a request's waiting clock as both apps show it; null before the driver starts it. */
export function waitClockOf(r: RequestRecord, rule: MoneyRules['requestWaitExtra']): RequestWaitClock | null {
  if (!r.waitStartedAt) return null;
  const terms = r.offers.find((o) => o.id === r.pickedOfferId)?.wait;
  if (!terms) return null;
  return {
    startedAt: r.waitStartedAt,
    endedAt: r.waitEndedAt,
    includedHours: terms.includedHours,
    extraHourIqd: terms.extraHourIqd,
    freeMin: rule.freeMin,
    charged: rule.enabled,
  };
}
