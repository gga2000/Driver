import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_REQUEST_DETAILS,
  DriverError,
  encodeDomainEvent,
  isDomainEventType,
  PostRequestInput,
  type TravellingAs,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { haversineMeters } from '../trips/index.js';
import { ROUTES_EVENTS, type RoutesEventEmitter } from './events.adapter.js';
import type { IntercityNetworkConfig, IntercityRules } from './intercity.config.js';
import type { RequestRecord } from './model.js';
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
 * driver → rider). The request id (`rq_…`) stands in for the order / departure id in those payloads.
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
  ) {}

  private now(): Date {
    return this.clock.now();
  }

  /** One request by id (the safety module checks who is on a private ride); null when unknown. */
  get(id: string): Promise<RequestRecord | null> {
    return this.repo.getRequest(id);
  }

  // ───────────────────────── rider ─────────────────────────

  post(riderId: string, input: PostInput): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
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
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.posted', riderId, r, {
        when: r.when,
        seats: r.seats,
        privateCar: r.privateCar,
        to: r.to.label,
      });
      return r;
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

  mine(riderId: string): Promise<RequestRecord[]> {
    return this.repo.listRequests({ riderId });
  }

  pick(riderId: string, postId: string, offerId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustOwn(riderId, postId, tx);
      if (r.state !== 'open') throw new DriverError('request_state_conflict');
      const offer = r.offers.find((o) => o.id === offerId && o.state === 'open');
      if (!offer) throw new DriverError('request_state_conflict');
      const deposit = this.depositFor(offer.priceIqd);
      const available =
        (await this.wallet.balance(riderId)) - (await walletHolds(this.repo, riderId, tx));
      if (available < deposit) throw new DriverError('wallet_insufficient');
      for (const o of r.offers)
        o.state = o.id === offerId ? 'picked' : o.state === 'open' ? 'lost' : o.state;
      r.state = 'matched';
      r.pickedOfferId = offerId;
      r.depositIqd = deposit;
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.matched', riderId, r, {
        driverId: offer.driverId,
        priceIqd: offer.priceIqd,
        depositIqd: deposit,
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
      await this.repo.saveRequest(r, tx);
      if (late) await this.forfeitDeposit(tx, r, 'request_board_late_cancel');
      await this.emit(tx, 'request.cancelled', riderId, r, {
        free: !late,
        depositForfeitedIqd: late ? r.depositIqd : 0,
      });
      return r;
    });
  }

  /** The rider reports the driver did not come: 2× the deposit from the driver's balance. */
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
      r.state = 'driver_no_show';
      r.closedAt = this.now();
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'departure.cancelled', riderId, r, {
        departureId: r.id,
        occurredAt: this.now(),
        driverId: offer.driverId,
        cancelledBy: 'driver',
        feeIqd: 2 * (r.depositIqd ?? 0),
        riderIds: [r.riderId],
      });
      await this.emit(tx, 'request.driver_no_show', riderId, r, {
        driverId: offer.driverId,
        creditIqd: 2 * (r.depositIqd ?? 0),
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
   * «N سواق شافوا طلبك»; no event (nothing to settle or notify). Like every request write it runs
   * under the routes writer (in-process mutex + the transaction's advisory lock, taken before the
   * read), so it can never read «open», lose to a pick, and write «open» back over it.
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
      if (r.seenDriverIds.includes(driverId)) return r;
      r.seenDriverIds.push(driverId);
      await this.repo.saveRequest(r, tx);
      return r;
    });
  }

  offer(driverId: string, postId: string, priceIqd: number): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.must(postId, tx);
      if (r.state !== 'open') throw new DriverError('request_state_conflict');
      if (r.riderId === driverId) throw new DriverError('forbidden');
      if (priceIqd <= 0 || priceIqd % this.rules.requestBoard.offerStepIqd !== 0)
        throw new DriverError('offer_price_invalid');
      if (r.priceCapIqd !== null && priceIqd > r.priceCapIqd)
        throw new DriverError('offer_price_invalid');
      for (const o of r.offers)
        if (o.driverId === driverId && o.state === 'open') o.state = 'withdrawn';
      const offer = {
        id: this.ids.id('rqo'),
        driverId,
        priceIqd,
        at: this.now(),
        state: 'open' as const,
      };
      r.offers.push(offer);
      // An offer means he read it, even from a list that never opened the detail.
      if (!r.seenDriverIds.includes(driverId)) r.seenDriverIds.push(driverId);
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'request.offer_made', driverId, r, {
        offerId: offer.id,
        priceIqd,
        riderId: r.riderId,
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

  /** Completed: a private intercity ride (8 %); the deposit was paid from the wallet, the rest in cash. */
  complete(driverId: string, postId: string): Promise<RequestRecord> {
    return this.writer.run(async (tx) => {
      const r = await this.mustDrive(driverId, postId, tx);
      if (r.state !== 'matched' && r.state !== 'driver_arrived')
        throw new DriverError('request_state_conflict');
      const offer = this.picked(r);
      const deposit = r.depositIqd ?? 0;
      r.state = 'completed';
      r.closedAt = this.now();
      await this.repo.saveRequest(r, tx);
      await this.emit(tx, 'order.closed', driverId, r, {
        kind: 'ride',
        from: 'completed',
        to: 'closed',
        reason: 'request_board_completed',
        totalIqd: offer.priceIqd,
        ride: {
          tripId: r.id,
          occurredAt: this.now(),
          customerId: r.riderId,
          payment: 'cash',
          cashCollectedIqd: offer.priceIqd - deposit,
          driverId,
          takeClass: 'intercity_private',
          fareIqd: offer.priceIqd,
        },
      });
      return r;
    });
  }

  /** The driver waited at the pickup: the deposit is his (review C-50). */
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
      await this.repo.saveRequest(r, tx);
      await this.forfeitDeposit(tx, r, 'request_board_rider_no_show');
      await this.emit(tx, 'request.rider_no_show', driverId, r, { depositIqd: r.depositIqd });
      return r;
    });
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
      orderId: r.id,
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
      | 'driverArrivedAt'
      | 'driverArrivedPin'
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
      driverArrivedAt: null,
      driverArrivedPin: null,
      closedAt: null,
      createdAt: this.now(),
    };
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
