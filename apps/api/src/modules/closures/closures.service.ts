import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CLOSURE_LIMITS, CloseStreetInput, DriverError, haversineM, type Actor, type ClosuresInput, type ClosuresPort, type ClosureView, type LatLng, type OpenStreetInput, type SnapClosureInput, type SnappedClosure } from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { nextLocalMidnight, startOfLocalDay } from '../../shared/local-time.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { EventsService } from '../events/index.js';
import { decodePolyline, EtaService, RouteClosures } from '../routing/index.js';
import { CLOSURES_REPOSITORY, type ClosureRecord, type ClosuresRepository } from './closures.repository.js';

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
      const saved = await this.repo.create({ cityId: input.cityId, path: input.path, reason: input.reason, nameAr, lengthM, startsAt: now, endsAt, closedById: actor.personId }, tx);
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

  private async views(rows: readonly ClosureRecord[], now: Date): Promise<ClosureView[]> {
    const names = await this.names.of([...new Set(rows.flatMap((r) => [r.closedById, ...(r.openedById ? [r.openedById] : [])]))]);
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
      }));
  }
}

