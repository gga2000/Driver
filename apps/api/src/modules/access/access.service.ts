import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DriverError,
  WAVE_RULES,
  type AccessView,
  type Actor,
  type SetWaveSlotsInput,
  type WavesInput,
  type WavesView,
  type ZoneWaveView,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { DistributedKeyedLock } from '../../shared/db/advisory-lock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import {
  ACCESS_REPOSITORY,
  type AccessReason,
  type AccessRecord,
  type AccessRepository,
} from './access.repository.js';

/** Customers are in Aziziyah until a second city opens; a person with no saved place is counted there. */
export const DEFAULT_ACCESS_CITY = 'aziziyah';
export const ACCESS_OPENED_EVENT = 'access.opened';

/** What waves need from other modules (bound in `access.module.ts`; no module imports this one). */
export interface AccessSources {
  /** The person's own saved place that decides their zone (home, then work, then the oldest), if any. */
  ownZone(personId: string): Promise<{ cityId: string; zoneKey: string } | null>;
  /** Holds any role besides customer (staff, partners, merchants): never waits. */
  isStaff(personId: string): Promise<boolean>;
  /** Placed an order before waves (or before their row was decided): never waits. */
  hasOrdered(personId: string): Promise<boolean>;
  /** Zone names of a city (`config`), for the waiting screen and the Console. */
  zoneNames(cityId: string): ReadonlyMap<string, string>;
  /** The outbox: `access.opened` (once per person) and `ops.zone_wave_set`. */
  emit(
    tx: Tx | undefined,
    event: {
      type: string;
      actorId: string;
      occurredAt: Date;
      payload: Record<string, unknown>;
      idempotencyKey?: string;
    },
    aggregate: { name: string; id: string },
  ): Promise<unknown>;
  /** The Console audit log, in the same transaction. */
  audit(
    input: {
      cityId: string;
      actorId: string;
      action: string;
      subjectKind: string;
      subjectId: string;
      summaryAr: string;
      detail: Record<string, unknown>;
    },
    tx: Tx | undefined,
  ): Promise<unknown>;
}
export const ACCESS_SOURCES = Symbol('ACCESS_SOURCES');

/**
 * Customer waves (plan W5, D-24). A customer's place in line is decided the first time they ask
 * (`access.status`, or placing a food order): staff and people who already ordered are let in; so is
 * anyone in a zone with no wave. Otherwise they are let in while the zone's let-in count (plus the
 * people already waiting before them) is under its open places, and wait if not. Let in is for good.
 * The sweep lets waiting people in, oldest first, as places open, and each gets one «صار دورك».
 *
 * Locks: a person's decision holds `access.person:<id>` then `access.zone:<city>:<zone>`; the sweep
 * holds only the zone's, so two decisions can't both take the last place and none deadlocks.
 */
@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);
  private readonly personLock: DistributedKeyedLock;
  private readonly zoneLock: DistributedKeyedLock;

  constructor(
    @Inject(ACCESS_REPOSITORY) private readonly repo: AccessRepository,
    @Inject(ACCESS_SOURCES) private readonly src: AccessSources,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() uow?: UnitOfWork,
  ) {
    this.personLock = new DistributedKeyedLock(uow, 'access.person');
    this.zoneLock = new DistributedKeyedLock(uow, 'access.zone');
  }

  async status(actor: Actor): Promise<AccessView> {
    return this.viewOf(await this.decide(actor.personId));
  }

  /** orders.place for food and shop orders: refuses a person still waiting (`waitlisted`). */
  async assertMayOrder(personId: string): Promise<void> {
    const rec = await this.decide(personId);
    if (rec.state !== 'admitted') throw new DriverError('waitlisted');
  }

  /** Decides (or re-reads) the person's place in line. */
  async decide(personId: string): Promise<AccessRecord> {
    const known = await this.repo.get(personId);
    if (known?.state === 'admitted') return known;
    return this.personLock.run(personId, async (tx) => {
      const prior = await this.repo.get(personId, tx);
      if (prior?.state === 'admitted') return prior;
      const now = this.clock.now();
      const place = await this.src.ownZone(personId);
      const cityId = place?.cityId ?? prior?.cityId ?? DEFAULT_ACCESS_CITY;
      const zoneKey = place?.zoneKey ?? null;
      const joinedAt = prior?.joinedAt ?? now;
      const admit = (reason: AccessReason): Promise<AccessRecord> =>
        this.write(
          { personId, cityId, zoneKey, state: 'admitted', reason, joinedAt, admittedAt: now },
          tx,
        );
      if (await this.src.isStaff(personId)) return admit('staff');
      if (await this.src.hasOrdered(personId)) return admit('existing');
      const waves = await this.repo.waves(cityId, tx);
      if (!waves.some((w) => w.openSlots !== null)) return admit('open');
      if (zoneKey === null)
        return this.write(
          {
            personId,
            cityId,
            zoneKey,
            state: 'waiting',
            reason: 'wave',
            joinedAt,
            admittedAt: null,
          },
          tx,
        );
      const slots = waves.find((w) => w.zoneKey === zoneKey)?.openSlots ?? null;
      if (slots === null) return admit('open');
      return this.zoneLock.run(`${cityId}:${zoneKey}`, async (ztx) => {
        // The sweep may have let them in while this waited for the zone.
        const again = await this.repo.get(personId, ztx);
        if (again?.state === 'admitted') return again;
        const admitted = (await this.repo.admittedByZone(cityId, ztx)).get(zoneKey) ?? 0;
        const ahead = await this.repo.waitingAhead(cityId, zoneKey, joinedAt, personId, ztx);
        if (admitted + ahead < slots)
          return this.write(
            {
              personId,
              cityId,
              zoneKey,
              state: 'admitted',
              reason: 'wave',
              joinedAt,
              admittedAt: now,
            },
            ztx,
          );
        return this.write(
          {
            personId,
            cityId,
            zoneKey,
            state: 'waiting',
            reason: 'wave',
            joinedAt,
            admittedAt: null,
          },
          ztx,
        );
      });
    });
  }

  async waves(input: z.output<typeof WavesInput>): Promise<WavesView> {
    const { cityId } = input;
    const [rows, admitted, waiting] = await Promise.all([
      this.repo.waves(cityId),
      this.repo.admittedByZone(cityId),
      this.repo.waitingByZone(cityId),
    ]);
    const names = this.src.zoneNames(cityId);
    const zones = [...names].map(([zoneKey, name]) =>
      this.zoneView(
        zoneKey,
        name,
        rows.find((w) => w.zoneKey === zoneKey) ?? null,
        admitted,
        waiting,
      ),
    );
    return { cityId, at: this.clock.now(), zones, waitingWithoutZone: waiting.get(null) ?? 0 };
  }

  async setSlots(actor: Actor, input: z.output<typeof SetWaveSlotsInput>): Promise<ZoneWaveView> {
    const names = this.src.zoneNames(input.cityId);
    const name = names.get(input.zoneKey);
    if (name === undefined) throw new DriverError('control_invalid');
    const now = this.clock.now();
    const row = await this.zoneLock.run(`${input.cityId}:${input.zoneKey}`, async (tx) => {
      const saved = await this.repo.upsertWave(
        {
          cityId: input.cityId,
          zoneKey: input.zoneKey,
          openSlots: input.openSlots,
          setById: actor.personId,
          setAt: now,
        },
        tx,
      );
      await this.src.emit(
        tx,
        {
          type: 'ops.zone_wave_set',
          actorId: actor.personId,
          occurredAt: now,
          payload: { cityId: input.cityId, zoneKey: input.zoneKey, openSlots: input.openSlots },
        },
        { name: 'ops_control', id: `${input.cityId}:wave:${input.zoneKey}` },
      );
      await this.src.audit(
        {
          cityId: input.cityId,
          actorId: actor.personId,
          action: 'wave.set',
          subjectKind: 'wave',
          subjectId: input.zoneKey,
          summaryAr:
            input.openSlots === null
              ? `فتح ${name} للكل (بلا دور)`
              : `دور ${name}: ${input.openSlots} زبون`,
          detail: { openSlots: input.openSlots },
        },
        tx,
      );
      return saved;
    });
    // Let in whoever the new number has room for now, not on the next sweep.
    await this.sweepZone(input.cityId, input.zoneKey);
    if (
      input.openSlots === null ||
      !(await this.repo.waves(input.cityId)).some((w) => w.openSlots !== null)
    )
      await this.sweepZone(input.cityId, null);
    const [admitted, waiting] = await Promise.all([
      this.repo.admittedByZone(input.cityId),
      this.repo.waitingByZone(input.cityId),
    ]);
    return this.zoneView(input.zoneKey, name, row, admitted, waiting);
  }

  /** One pass over every zone with someone waiting; returns how many were let in. */
  async sweep(): Promise<number> {
    let n = 0;
    for (const { cityId, zoneKey } of await this.repo.waitingZones()) {
      try {
        n += await this.sweepZone(cityId, zoneKey);
      } catch (err) {
        this.logger.error(
          `waves sweep ${cityId}:${zoneKey ?? '-'}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }
    return n;
  }

  /**
   * Lets the zone's longest-waiting in while it has room, at most `admitPerSweep` at a time. People
   * with no zone are let in only once no zone of the city has a wave (then everyone is open).
   */
  async sweepZone(cityId: string, zoneKey: string | null): Promise<number> {
    return this.zoneLock.run(`${cityId}:${zoneKey ?? '-'}`, async (tx) => {
      const waves = await this.repo.waves(cityId, tx);
      const anyOn = waves.some((w) => w.openSlots !== null);
      const slots =
        zoneKey === null ? null : (waves.find((w) => w.zoneKey === zoneKey)?.openSlots ?? null);
      if (zoneKey === null && anyOn) return 0;
      const open = !anyOn || slots === null;
      const room = open
        ? WAVE_RULES.admitPerSweep
        : Math.min(
            WAVE_RULES.admitPerSweep,
            slots - ((await this.repo.admittedByZone(cityId, tx)).get(zoneKey) ?? 0),
          );
      if (room <= 0) return 0;
      const now = this.clock.now();
      const next = await this.repo.oldestWaiting(cityId, zoneKey, room, tx);
      for (const rec of next) {
        await this.repo.put(
          { ...rec, state: 'admitted', reason: open ? 'open' : 'wave', admittedAt: now },
          tx,
        );
        await this.src.emit(
          tx,
          {
            type: ACCESS_OPENED_EVENT,
            actorId: 'system',
            occurredAt: now,
            payload: { personId: rec.personId, cityId, zoneKey },
            idempotencyKey: `${ACCESS_OPENED_EVENT}:${rec.personId}`,
          },
          { name: 'person', id: rec.personId },
        );
      }
      return next.length;
    });
  }

  private async write(rec: AccessRecord, tx: Tx | undefined): Promise<AccessRecord> {
    await this.repo.put(rec, tx);
    return rec;
  }

  private async viewOf(rec: AccessRecord): Promise<AccessView> {
    const zoneNameAr = rec.zoneKey
      ? (this.src.zoneNames(rec.cityId).get(rec.zoneKey) ?? null)
      : null;
    if (rec.state === 'admitted')
      return { state: 'open', zoneKey: rec.zoneKey, zoneNameAr, ahead: null, waitingSince: null };
    if (rec.zoneKey === null)
      return {
        state: 'needs_place',
        zoneKey: null,
        zoneNameAr: null,
        ahead: null,
        waitingSince: rec.joinedAt,
      };
    return {
      state: 'waiting',
      zoneKey: rec.zoneKey,
      zoneNameAr,
      ahead: await this.repo.waitingAhead(rec.cityId, rec.zoneKey, rec.joinedAt, rec.personId),
      waitingSince: rec.joinedAt,
    };
  }

  private zoneView(
    zoneKey: string,
    name: string,
    row: { openSlots: number | null; setAt: Date } | null,
    admitted: Map<string | null, number>,
    waiting: Map<string | null, number>,
  ): ZoneWaveView {
    return {
      zoneKey,
      name_ar: name,
      openSlots: row?.openSlots ?? null,
      admitted: admitted.get(zoneKey) ?? 0,
      waiting: waiting.get(zoneKey) ?? 0,
      setAt: row?.setAt ?? null,
    };
  }
}
