import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { DriverError, Vertical, ZONE_CHECK_RULES, ZONE_CHECK_VERTICALS, type Actor, type AnswerZoneCheckInput, type ZoneCheckPrompt, type ZoneChecksPort } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { startOfLocalDay } from '../../shared/local-time.js';
import { EventsService, type PublishedEvent } from '../events/index.js';
import { checkExpiresAt, checkIsOpen, confirmsZone, tallyChecks, zoneToAsk } from './zone-checks.logic.js';
import { ZONE_CHECKS_REPOSITORY, type ZoneChecksRepository } from './zone-checks.repository.js';
import { ZONES_REPOSITORY, type ZonesRepository } from './zones.repository.js';
import { ZonesService } from './zones.service.js';

/** Subscriber name for asking drivers about zones (maps program SP3 §5.3). */
export const ZONE_CHECKS_SUBSCRIBER = 'zones:driver-checks';

const MINUTE_MS = 60_000;

/** The parts of a `stop.completed` payload the question needs (trips adds `finalDrop` on the last drop-off). */
const FinalDropPayload = z.object({
  stopId: z.string().min(1),
  stopType: z.literal('dropoff'),
  vertical: Vertical,
  finalDrop: z.object({ cityId: z.string().min(1), lat: z.number(), lng: z.number(), accuracyM: z.number().min(0) }),
});

/** The question's id: one per drop-off, so a redelivered event can't ask twice. */
const checkIdFor = (stopId: string): string => `zc_${stopId}`;

/**
 * Drivers confirm zones (maps program SP3 §5.3, decision D4 "Ali places them, drivers confirm"). At
 * the drop-off that ends a trip, a driver whose precise arrival fix lies inside a placed outline may
 * be asked «انت بمنطقة X؟» on the done screen, at most once a Baghdad day. Three "إي" from two or
 * more drivers confirm the outline; a "لا" flags it in the Console zone tool. Questions not answered
 * within `ZONE_CHECK_RULES.answerWithinMin` are dropped.
 */
@Injectable()
export class ZoneChecksService implements ZoneChecksPort, OnModuleInit {
  constructor(
    @Inject(ZONE_CHECKS_REPOSITORY) private readonly repo: ZoneChecksRepository,
    @Inject(ZONES_REPOSITORY) private readonly zonesRepo: ZonesRepository,
    private readonly zones: ZonesService,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Finished drop-offs reach the question through the outbox, so a slow zone read never slows "سلّمت". */
  onModuleInit(): void {
    this.events.subscribe(ZONE_CHECKS_SUBSCRIBER, ['stop.completed'], (e, ctx) => this.onStopCompleted(e, ctx.tx));
  }

  /**
   * Maybe ask. Not for: replays quarantined as late (the moment is gone), pickups and mid-trip drops,
   * الرجعة / خطوط runs, an imprecise fix, a point outside every placed outline, a driver already asked
   * today, or an event delivered so late that the question would already have expired.
   */
  async onStopCompleted(e: PublishedEvent, tx: Tx): Promise<void> {
    if (e.quarantined || !e.tripId) return;
    const parsed = FinalDropPayload.safeParse(e.payload);
    if (!parsed.success) return;
    const { stopId, vertical, finalDrop } = parsed.data;
    if (!ZONE_CHECK_VERTICALS.includes(vertical) || finalDrop.accuracyM > ZONE_CHECK_RULES.maxAccuracyM) return;
    const now = this.clock.now();
    if (!checkIsOpen(e.recordedAt, now)) return;
    const zone = zoneToAsk(await this.zonesRepo.list(finalDrop.cityId, tx), { lat: finalDrop.lat, lng: finalDrop.lng });
    if (!zone?.placedAt) return;
    const driverId = e.actorId;
    if ((await this.repo.askedSince(driverId, startOfLocalDay(now), tx)) >= ZONE_CHECK_RULES.perDriverPerDay) return;
    await this.repo.create({ id: checkIdFor(stopId), cityId: finalDrop.cityId, zoneKey: zone.key, outlineAt: zone.placedAt, driverId, tripId: e.tripId, stopId, askedAt: now }, tx);
  }

  /**
   * His open question, or null. Also null when the zone moved on since he was asked (confirmed by
   * others, or the outline redrawn): the answer would be about an outline that no longer exists.
   */
  async open(actor: Actor): Promise<ZoneCheckPrompt | null> {
    const now = this.clock.now();
    const check = await this.repo.openFor(actor.personId, new Date(now.getTime() - ZONE_CHECK_RULES.answerWithinMin * MINUTE_MS));
    if (!check) return null;
    const zone = (await this.zonesRepo.list(check.cityId)).find((z) => z.key === check.zoneKey);
    if (!zone || zone.placement !== 'placed' || zone.placedAt?.getTime() !== check.outlineAt.getTime()) return null;
    const names = await this.zones.namesOf(check.cityId, check.zoneKey);
    if (!names) return null;
    return { checkId: check.id, zoneKey: check.zoneKey, ...names, expiresAt: checkExpiresAt(check.askedAt) };
  }

  /**
   * Records his answer (first answer wins; a retry of the same tap is fine). Only his own question,
   * and only while it is open. A "yes" that completes the count confirms the zone; a "no" flags it.
   */
  async answer(actor: Actor, input: AnswerZoneCheckInput): Promise<void> {
    await this.uow.run(async (tx) => {
      const check = await this.repo.get(input.checkId, tx);
      // Someone else's question reads as "not found": ids don't reveal other drivers' questions.
      if (!check || check.driverId !== actor.personId) throw new DriverError('zone_check_not_found');
      if (check.answer !== null) return;
      const now = this.clock.now();
      if (!checkIsOpen(check.askedAt, now)) throw new DriverError('zone_check_expired');
      if (!(await this.repo.answer(check.id, input.answer, now, tx))) return;
      if (input.answer === 'no') {
        await this.zones.flagByDriver(actor.personId, check.cityId, check.zoneKey, tx);
        return;
      }
      if (input.answer !== 'yes') return;
      const tally = tallyChecks(await this.repo.answers(check.cityId, [{ zoneKey: check.zoneKey, outlineAt: check.outlineAt }], tx));
      if (confirmsZone(tally)) await this.zones.confirmByDrivers(check.cityId, check.zoneKey, check.outlineAt, tally, tx);
    });
  }
}
