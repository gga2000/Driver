import { Inject, Injectable } from '@nestjs/common';
import {
  AGREEMENT_ASKS_PER_DEPARTURE,
  AGREEMENT_PROPOSAL_TTL_MIN,
  DriverError,
  type AskAgreementInput,
  type ProposeAgreementInput,
  type RespondAgreementInput,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { agreementAmountProblem, agreementLive, agreementPlaceProblem } from './agreements.js';
import { DeparturesService } from './departures.service.js';
import { ROUTES_EVENTS, type RoutesEventEmitter } from './events.adapter.js';
import type { IntercityNetworkConfig, IntercityRules } from './intercity.config.js';
import { OPEN_DEPARTURE, type AgreementRecord, type DepartureRecord } from './model.js';
import { ROUTES_REPOSITORY, type RoutesRepository } from './routes.repository.js';
import { MIN_MS, ROUTES_IDS, type IdSource } from './support.js';
import { ROUTES_NETWORK, ROUTES_RULES } from './tokens.js';
import { RoutesWriter } from './writer.js';

type AgreementEvent = 'agreement.asked' | 'agreement.proposed' | 'agreement.accepted' | 'agreement.declined' | 'agreement.expired' | 'agreement.withdrawn';

/**
 * Step 4 agreed trip prices (docs/specs/2026-10-08-agreed-trip-prices.md): a rider asks for a pin
 * pickup on the way or a door drop at the far end, the departure's driver names the price (whole
 * 1,000s, 0 = «ببلاش»), the rider accepts or declines. An accepted price is locked on the booking
 * that uses it (`DeparturesService.place`); accepted after booking, it replaces the booking's old
 * one until the car leaves (`DeparturesService.applyAgreement`). One live agreement per rider, kind
 * and departure. The scheduler expires unanswered prices after 30 minutes, and asks the driver never
 * priced when the departure's latest time passes.
 */
@Injectable()
export class AgreementsService {
  constructor(
    @Inject(ROUTES_REPOSITORY) private readonly repo: RoutesRepository,
    @Inject(ROUTES_EVENTS) private readonly events: RoutesEventEmitter,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly writer: RoutesWriter,
    private readonly departures: DeparturesService,
    @Inject(ROUTES_NETWORK) private readonly network: IntercityNetworkConfig,
    @Inject(ROUTES_RULES) private readonly rules: IntercityRules,
    @Inject(ROUTES_IDS) private readonly ids: IdSource,
  ) {}

  private now(): Date {
    return this.clock.now();
  }

  // ───────────────────────── rider ─────────────────────────

  /** a1: the rider asks for a price on a place; a new ask of the same kind replaces his older one. */
  ask(riderId: string, input: AskAgreementInput): Promise<AgreementRecord> {
    return this.writer.run(async (tx) => {
      const dep = await this.openDeparture(input.departureId, tx);
      if (dep.driverId === riderId) throw new DriverError('forbidden');
      const place = { lat: input.lat, lng: input.lng };
      const problem = agreementPlaceProblem(input.kind, dep, place, this.network, this.rules);
      if (problem) throw new DriverError(problem);
      const mine = await this.repo.agreementsFor(dep.id, riderId, tx);
      if (mine.length >= AGREEMENT_ASKS_PER_DEPARTURE) throw new DriverError('agreement_limit');
      for (const old of mine) {
        if (old.kind !== input.kind || !agreementLive(old)) continue;
        await this.close(tx, old, 'withdrawn', riderId);
      }
      const a: AgreementRecord = {
        id: this.ids.id('ag'),
        departureId: dep.id,
        riderId,
        driverId: dep.driverId,
        kind: input.kind,
        lat: input.lat,
        lng: input.lng,
        note: input.note?.trim() || null,
        state: 'asked',
        amountIqd: null,
        askedAt: this.now(),
        proposedAt: null,
        // An ask the driver never prices lapses when the car must have left.
        expiresAt: dep.latestDepartureAt,
        decidedAt: null,
        bookingId: null,
      };
      await this.repo.saveAgreement(a, tx);
      await this.emit(tx, 'agreement.asked', riderId, a);
      return a;
    });
  }

  /** The rider takes back an ask, or a price not yet on a booking. */
  withdraw(riderId: string, agreementId: string): Promise<AgreementRecord> {
    return this.writer.run(async (tx) => {
      const a = await this.mustOwn(riderId, agreementId, tx);
      if (!agreementLive(a)) throw new DriverError('agreement_state_conflict');
      await this.close(tx, a, 'withdrawn', riderId);
      return a;
    });
  }

  /**
   * The rider's answer to the driver's price. Accepting withdraws his other open agreement of the
   * same kind, then puts the price on his booked seat if he has one (a5), else it waits for the
   * booking that names it.
   */
  respond(riderId: string, input: RespondAgreementInput): Promise<AgreementRecord> {
    return this.writer.run(async (tx) => {
      const a = await this.mustOwn(riderId, input.agreementId, tx);
      if (a.state !== 'proposed' || this.lapsed(a)) throw new DriverError('agreement_state_conflict');
      await this.openDeparture(a.departureId, tx);
      if (!input.accept) {
        await this.close(tx, a, 'declined', riderId);
        return a;
      }
      // Everything is checked before anything is written (the in-memory repository cannot roll back).
      const plan = await this.departures.planAgreement(tx, a);
      for (const other of await this.repo.agreementsFor(a.departureId, riderId, tx)) {
        if (other.id === a.id || other.kind !== a.kind || !agreementLive(other)) continue;
        await this.close(tx, other, 'withdrawn', riderId);
      }
      a.state = 'accepted';
      a.decidedAt = this.now();
      a.expiresAt = null;
      await this.repo.saveAgreement(a, tx);
      await this.emit(tx, 'agreement.accepted', riderId, a);
      if (plan) await this.departures.applyAgreement(tx, a, plan);
      return a;
    });
  }

  /** The rider's agreements on one departure, newest ask first. */
  mine(riderId: string, departureId: string): Promise<AgreementRecord[]> {
    return this.repo.agreementsFor(departureId, riderId);
  }

  // ───────────────────────── driver ─────────────────────────

  /** a1–a3: only the departure's driver names the price; a new price replaces his earlier one. */
  propose(driverId: string, input: ProposeAgreementInput): Promise<AgreementRecord> {
    return this.writer.run(async (tx) => {
      const a = await this.must(input.agreementId, tx);
      const dep = await this.openDeparture(a.departureId, tx);
      if (dep.driverId !== driverId || a.driverId !== driverId) throw new DriverError('not_departure_driver');
      if (a.state !== 'asked' && a.state !== 'proposed' && a.state !== 'expired')
        throw new DriverError('agreement_state_conflict');
      const problem = agreementAmountProblem(input.amountIqd);
      if (problem) throw new DriverError(problem);
      a.state = 'proposed';
      a.amountIqd = input.amountIqd;
      a.proposedAt = this.now();
      a.expiresAt = new Date(this.now().getTime() + AGREEMENT_PROPOSAL_TTL_MIN * MIN_MS);
      a.decidedAt = null;
      await this.repo.saveAgreement(a, tx);
      await this.emit(tx, 'agreement.proposed', driverId, a);
      return a;
    });
  }

  /** Every agreement on the driver's own departure, newest ask first. */
  async onDeparture(driverId: string, departureId: string): Promise<AgreementRecord[]> {
    const dep = await this.departures.departure(departureId);
    if (dep.driverId !== driverId) throw new DriverError('not_departure_driver');
    return this.repo.agreementsFor(dep.id);
  }

  // ───────────────────────── scheduler ─────────────────────────

  /** a7: unanswered prices (30 min) and never-priced asks (the departure's latest time) expire. */
  async tick(tx: Tx): Promise<number> {
    let n = 0;
    for (const a of await this.repo.openAgreements(tx)) {
      if (!this.lapsed(a)) continue;
      await this.close(tx, a, 'expired', 'system');
      n += 1;
    }
    return n;
  }

  // ───────────────────────── internals ─────────────────────────

  private lapsed(a: AgreementRecord): boolean {
    return a.expiresAt !== null && a.expiresAt.getTime() <= this.now().getTime();
  }

  private async close(
    tx: Tx,
    a: AgreementRecord,
    state: 'withdrawn' | 'declined' | 'expired',
    actorId: string,
  ): Promise<void> {
    a.state = state;
    a.decidedAt = this.now();
    await this.repo.saveAgreement(a, tx);
    await this.emit(tx, `agreement.${state}`, actorId, a);
  }

  private async openDeparture(id: string, tx: Tx): Promise<DepartureRecord> {
    const dep = await this.departures.departure(id, tx);
    if (!OPEN_DEPARTURE.includes(dep.state)) throw new DriverError('departure_state_conflict');
    return dep;
  }

  private async must(id: string, tx?: Tx): Promise<AgreementRecord> {
    const a = await this.repo.getAgreement(id, tx);
    if (!a) throw new DriverError('agreement_not_found');
    return a;
  }

  private async mustOwn(riderId: string, id: string, tx?: Tx): Promise<AgreementRecord> {
    const a = await this.must(id, tx);
    if (a.riderId !== riderId) throw new DriverError('agreement_not_found');
    return a;
  }

  private async emit(tx: Tx, type: AgreementEvent, actorId: string, a: AgreementRecord): Promise<void> {
    await this.events.emit(
      tx,
      {
        type,
        actorId,
        occurredAt: this.now(),
        payload: { agreementId: a.id, departureId: a.departureId, riderId: a.riderId, kind: a.kind, amountIqd: a.amountIqd },
      },
      { name: 'departure', id: a.departureId },
    );
  }
}
