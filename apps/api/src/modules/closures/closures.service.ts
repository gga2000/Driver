import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOSURE_LIMITS, CLOSURE_REPORT_RULES, CloseStreetInput, DriverError, haversineM, type Actor, type ConfirmClosureInput, type ReportClosureInput, type ReportClosureResult, type ClosuresInput, type ClosuresPort, type ClosureView, type LatLng, type OpenStreetInput, type SnapClosureInput, type SnappedClosure } from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { nextLocalMidnight, startOfLocalDay } from '../../shared/local-time.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { EventsService } from '../events/index.js';
import { decodePolyline, EtaService, RouteClosures, samplePath } from '../routing/index.js';
import { CLOSURES_REPOSITORY, type ClosureRecord, type ClosuresRepository } from './closures.repository.js';

/** Where a courier is on his job and the stops ahead (bound to the partner module); null off a job. */
export interface CourierWayPort {
  jobWay(personId: string): Promise<{ from: LatLng; ahead: LatLng[] } | null>;
}

export const CLOSURES_COURIER_WAY = Symbol('CLOSURES_COURIER_WAY');

export const CLOSURES_RULES = {
  /** Every API machine reloads today's closures this often, so a closure made on one is routed around on all. */
  reloadEveryMs: 15_000,
  /** A closure that would open again within this is not worth making. */
  minOpenMs: 5 * 60_000,
} as const;

const REASON_AR: Record<ClosureRecord['reason'], string> = { works: 'أشغال', funeral: 'عزا', water: 'مي', other: 'غيره' };

/** Path length in metres. */
function lengthOf(path: readonly LatLng[]): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += haversineM(path[i - 1]!, path[i]!);
  return Math.round(m);
}

/** The part of `line` between `fromM` and `toM` along it (shorter when the line is). */
function stretchOf(line: readonly LatLng[], fromM: number, toM: number): LatLng[] {
  return samplePath(line, 10)
    .filter((q) => q.atM >= fromM && q.atM <= toM)
    .map((q) => q.p);
}

/** Two stretches come within `m` of each other somewhere (the same street, reported twice). */
function near(a: readonly LatLng[], b: readonly LatLng[], m: number): boolean {
  const sa = samplePath(a, 10).map((q) => q.p);
  const sb = samplePath(b, 10).map((q) => q.p);
  return sa.some((p) => sb.some((q) => haversineM(p, q) <= m));
}

/** Keep at most `max` points, always the first and last (a long street from OSRM can have hundreds). */
function thin(path: readonly LatLng[], max: number): LatLng[] {
  if (path.length <= max) return [...path];
  const step = (path.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => path[Math.round(i * step)]!);
}

/**
 * N20 «شارع مسدود» (Ali, 2026-10-11): streets field ops close for today. Owns `street_closures`; keeps
 * routing's `RouteClosures` book current (on every change here, and by reloading from the database every
 * 15 s so all API machines agree). Every close and open is in the Console audit log. No money moves.
 */
@Injectable()
export class ClosuresService implements ClosuresPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClosuresService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(CLOSURES_REPOSITORY) private readonly repo: ClosuresRepository,
    private readonly book: RouteClosures,
    private readonly eta: EtaService,
    private readonly audits: AuditLogService,
    private readonly names: StaffNames,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(CLOSURES_COURIER_WAY) private readonly way: CourierWayPort | null = null,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
    this.timer = setInterval(() => void this.reload(), CLOSURES_RULES.reloadEveryMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Today's closures into routing's book. A failed read keeps the last good list. */
  async reload(): Promise<void> {
    try {
      const live = await this.repo.live(this.clock.now());
      this.book.set(live.map((c) => ({ id: c.id, path: c.path, endsAt: c.endsAt, reason: c.reason, nameAr: c.nameAr })));
    } catch (err) {
      this.logger.warn(`closures reload failed: ${(err as Error).message}`);
    }
  }

  async list(input: ClosuresInput): Promise<ClosureView[]> {
    const now = this.clock.now();
    const rows = await this.repo.endingAfter(input.cityId, startOfLocalDay(now));
    return this.views(rows, now);
  }

  async snap(input: SnapClosureInput): Promise<SnappedClosure> {
    const r = await this.eta.path([input.from, input.to]);
    let path: LatLng[] = [input.from, input.to];
    if (r.polyline6 && r.basis === 'road') {
      try {
        path = decodePolyline(r.polyline6);
      } catch {
        path = [input.from, input.to];
      }
    }
    path = thin(path, CLOSURE_LIMITS.maxPoints);
    return { path, lengthM: lengthOf(path), basis: r.basis === 'road' && r.polyline6 ? 'road' : 'estimated' };
  }

  async close(actor: Actor, input: z.infer<typeof CloseStreetInput>): Promise<ClosureView> {
    const now = this.clock.now();
    const midnight = nextLocalMidnight(now);
    const endsAt = input.until ?? midnight;
    const lengthM = lengthOf(input.path);
    if (lengthM < CLOSURE_LIMITS.minLengthM || lengthM > CLOSURE_LIMITS.maxLengthM) throw new DriverError('invalid_input');
    if (endsAt.getTime() > midnight.getTime() || endsAt.getTime() - now.getTime() < CLOSURES_RULES.minOpenMs) throw new DriverError('invalid_input');
    const nameAr = input.nameAr?.trim() ? input.nameAr.trim() : null;
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.create({ cityId: input.cityId, path: input.path, reason: input.reason, nameAr, lengthM, startsAt: now, endsAt, closedById: actor.personId, source: 'ops' }, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'ops.street_closed', occurredAt: now, payload: { cityId: saved.cityId, closureId: saved.id, reason: saved.reason, lengthM, endsAt: endsAt.toISOString() } },
        { name: 'street_closure', id: saved.id },
      );
      await this.audits.record(
        { cityId: saved.cityId, actorId: actor.personId, action: 'closure.close', subjectKind: 'closure', subjectId: saved.id, summaryAr: `سدّ ${nameAr ?? 'شارع'} (${REASON_AR[saved.reason]}، ${lengthM} م)`, detail: { reason: saved.reason, lengthM, endsAt: endsAt.toISOString() } },
        tx,
      );
      return saved;
    });
    await this.reload();
    return (await this.views([row], now))[0]!;
  }

  async open(actor: Actor, input: OpenStreetInput): Promise<ClosureView> {
    const now = this.clock.now();
    const found = await this.repo.get(input.id);
    if (!found) throw new DriverError('not_found');
    const row = await this.uow.run(async (tx) => {
      const opened = await this.repo.open(found.id, actor.personId, now, tx);
      if (found.openedAt === null) {
        await this.events.emit(tx, { actorId: actor.personId, type: 'ops.street_opened', occurredAt: now, payload: { cityId: found.cityId, closureId: found.id } }, { name: 'street_closure', id: found.id });
        await this.audits.record(
          { cityId: found.cityId, actorId: actor.personId, action: 'closure.open', subjectKind: 'closure', subjectId: found.id, summaryAr: `فتح ${found.nameAr ?? 'شارع'} قبل وقته`, detail: {} },
          tx,
        );
      }
      return opened;
    });
    await this.reload();
    return (await this.views([row], now))[0]!;
  }

  /** Ops confirm a courier's report: every route goes around it until midnight. */
  async confirm(actor: Actor, input: ConfirmClosureInput): Promise<ClosureView> {
    const now = this.clock.now();
    const found = await this.repo.get(input.id);
    if (!found) throw new DriverError('not_found');
    if (found.source !== 'courier' || found.openedAt !== null || found.endsAt.getTime() <= now.getTime()) throw new DriverError('invalid_input');
    const row = await this.confirmed(found, actor.personId, now, 'ops');
    return (await this.views([row], now))[0]!;
  }

  /**
   * «الشارع مسدود قدامي» from a courier on a job: the stretch just ahead of him on his own road (his last fix
   * toward his next stop; never a point from the app). It routes nothing until ops confirm it, or until a
   * second courier reports the same street, which confirms it. Unconfirmed, it drops after 2 hours.
   */
  async report(actor: Actor, input: ReportClosureInput): Promise<ReportClosureResult> {
    const now = this.clock.now();
    const way = this.way ? await this.way.jobWay(actor.personId) : null;
    if (!way) throw new DriverError('trip_not_found');
    const mine = await this.repo.reportsBy(actor.personId, startOfLocalDay(now));
    const r = await this.eta.path([way.from, ...way.ahead]);
    let line: LatLng[] = [way.from, ...way.ahead];
    if (r.polyline6) {
      try {
        line = decodePolyline(r.polyline6);
      } catch {
        line = [way.from, ...way.ahead];
      }
    }
    const path = thin(stretchOf(line, CLOSURE_REPORT_RULES.aheadFromM, CLOSURE_REPORT_RULES.aheadToM), CLOSURE_LIMITS.maxPoints);
    const lengthM = lengthOf(path);
    // At the door already: nothing ahead of him to be closed.
    if (path.length < 2 || lengthM < CLOSURE_LIMITS.minLengthM) throw new DriverError('invalid_input');
    // The same street again within the hour: his first report stands.
    const again = mine.find((c) => now.getTime() - c.startsAt.getTime() < CLOSURE_REPORT_RULES.againMs && near(c.path, path, CLOSURE_REPORT_RULES.sameStreetM));
    if (again) return { id: again.id, confirmed: again.confirmedAt !== null };
    if (mine.length >= CLOSURE_REPORT_RULES.perDay) throw new DriverError('rate_limited');
    const cityId = input.cityId;
    // Someone else reported this street and it is still waiting: his report confirms it.
    const other = (await this.repo.waiting(cityId, now)).find((c) => c.closedById !== actor.personId && near(c.path, path, CLOSURE_REPORT_RULES.sameStreetM));
    if (other) {
      const row = await this.confirmed(other, actor.personId, now, 'second_report');
      return { id: row.id, confirmed: true };
    }
    const midnight = nextLocalMidnight(now);
    const endsAt = new Date(Math.min(now.getTime() + CLOSURE_REPORT_RULES.reportLiveMs, midnight.getTime()));
    const saved = await this.uow.run(async (tx) => {
      const row = await this.repo.create({ cityId, path, reason: input.reason, nameAr: null, lengthM, startsAt: now, endsAt, closedById: actor.personId, source: 'courier' }, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'ops.street_reported', occurredAt: now, payload: { cityId, closureId: row.id, reason: row.reason, lengthM, endsAt: endsAt.toISOString() } },
        { name: 'street_closure', id: row.id },
      );
      return row;
    });
    return { id: saved.id, confirmed: false };
  }

  private async confirmed(found: ClosureRecord, by: string, now: Date, how: 'ops' | 'second_report'): Promise<ClosureRecord> {
    const midnight = nextLocalMidnight(now);
    const row = await this.uow.run(async (tx) => {
      const done = await this.repo.confirm(found.id, by, now, midnight, tx);
      if (found.confirmedAt === null) {
        await this.events.emit(tx, { actorId: by, type: 'ops.street_closed', occurredAt: now, payload: { cityId: found.cityId, closureId: found.id, reason: found.reason, lengthM: found.lengthM, endsAt: midnight.toISOString(), source: 'courier', how } }, { name: 'street_closure', id: found.id });
        await this.audits.record(
          { cityId: found.cityId, actorId: by, action: 'closure.confirm', subjectKind: 'closure', subjectId: found.id, summaryAr: how === 'ops' ? `ثبّت بلاغ دليفري عن شارع مسدود (${REASON_AR[found.reason]}، ${found.lengthM} م)` : `دليفري ثاني بلّغ عن نفس الشارع، فانسدّ (${REASON_AR[found.reason]}، ${found.lengthM} م)`, detail: { how } },
          tx,
        );
      }
      return done;
    });
    await this.reload();
    return row;
  }

  private async views(rows: readonly ClosureRecord[], now: Date): Promise<ClosureView[]> {
    const names = await this.names.of([...new Set(rows.flatMap((r) => [r.closedById, ...(r.openedById ? [r.openedById] : []), ...(r.confirmedById ? [r.confirmedById] : [])]))]);
    const live = (r: ClosureRecord) => r.openedAt === null && r.endsAt.getTime() > now.getTime();
    return [...rows]
      .sort((a, b) => Number(live(b)) - Number(live(a)) || b.startsAt.getTime() - a.startsAt.getTime())
      .map((r) => ({
        id: r.id,
        cityId: r.cityId,
        path: r.path,
        reason: r.reason,
        nameAr: r.nameAr,
        endsAt: r.endsAt,
        lengthM: r.lengthM,
        startsAt: r.startsAt,
        closedByName: names[r.closedById] ?? null,
        openedAt: r.openedAt,
        openedByName: r.openedById ? (names[r.openedById] ?? null) : null,
        active: live(r),
        source: r.source,
        confirmed: r.source === 'ops' || r.confirmedAt !== null,
        confirmedByName: r.confirmedById ? (names[r.confirmedById] ?? null) : null,
      }));
  }
}

