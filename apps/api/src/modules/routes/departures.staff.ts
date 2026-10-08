import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Actor, OverdueDeparture, OverdueDeparturesInput, StaffDepartureInput, StaffDepartureResult } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
import { DeparturesService, type StaffWrite } from './departures.service.js';
import type { DepartureRecord } from './model.js';

/**
 * W3 / NTF-14 (M-11): the garage watchdog's rules. The overdue list is always on (it only reads);
 * cancelling a no-show departure on its own is Ali's decision, so it is off by default
 * (`GARAGE_NO_SHOW_AUTO_CANCEL=on`). Neither charges the driver nor credits riders: those amounts are
 * still open in M-11.
 */
export interface GarageWatchRules {
  /** A scheduled/boarding departure this long past its latest departure time: the driver never came. */
  noShowAfterMin: number;
  /** A departed one this long past the corridor's travel time with no «وصلت». */
  overdueAfterMin: number;
  /** Off by default: cancel a no-show departure by itself (riders moved, no fee). */
  autoCancelNoShow: boolean;
}

export const DEFAULT_GARAGE_WATCH_RULES: GarageWatchRules = { noShowAfterMin: 20, overdueAfterMin: 30, autoCancelNoShow: false };
export const GARAGE_WATCH_RULES = Symbol('GARAGE_WATCH_RULES');

export function garageWatchRulesFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): GarageWatchRules {
  const on = (v: string | undefined) => v !== undefined && ['on', 'true', '1', 'yes'].includes(v.trim().toLowerCase());
  return { ...DEFAULT_GARAGE_WATCH_RULES, autoCancelNoShow: on(env['GARAGE_NO_SHOW_AUTO_CANCEL']) };
}

/** The audit trail (`modules/controls` AuditLogService), written in the same transaction. */
export interface DepartureAuditPort {
  record(input: { cityId: string | null; actorId: string; action: string; subjectKind: string; subjectId: string; summaryAr: string; detail?: Record<string, unknown> }, tx?: Tx): Promise<{ id: string }>;
}
export const DEPARTURES_AUDIT = Symbol('DEPARTURES_AUDIT');

const HOME_CITY = 'aziziyah';
const SYSTEM = 'system';
export const GARAGE_WATCH_SWEEP_MS = 60_000;

/**
 * The Console's way out of a الرجعة departure (NTF-10 routes part, NTF-14): cancel for a driver who
 * never came, «وصلت» for one who forgot, close an arrived one now, and the overdue list. Every
 * mutation takes a reason and writes one `console_audit_log` row in the same write; a replay writes
 * nothing.
 */
@Injectable()
export class DeparturesStaffService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeparturesStaffService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly departures: DeparturesService,
    @Inject(DEPARTURES_AUDIT) private readonly audit: DepartureAuditPort,
    @Optional() @Inject(GARAGE_WATCH_RULES) private readonly rules: GarageWatchRules = DEFAULT_GARAGE_WATCH_RULES,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Job machines only; the switch is off until Ali decides M-11.
    if (!this.rules.autoCancelNoShow || !runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.safeSweep(), GARAGE_WATCH_SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async cancel(actor: Actor, input: StaffDepartureInput): Promise<StaffDepartureResult> {
    const w = await this.departures.staffCancel(actor.personId, input.departureId, this.after(actor.personId, 'departure.ops_cancel', `ألغى الرحلة لأن السايق ما إجه: ${input.reason}`, { reason: input.reason }));
    return result(w);
  }

  async arrive(actor: Actor, input: StaffDepartureInput): Promise<StaffDepartureResult> {
    const w = await this.departures.staffArrive(actor.personId, input.departureId, this.after(actor.personId, 'departure.ops_arrive', `سجّل وصول الرحلة بدل السايق: ${input.reason}`, { reason: input.reason }));
    return result(w);
  }

  async close(actor: Actor, input: StaffDepartureInput): Promise<StaffDepartureResult> {
    const w = await this.departures.staffClose(actor.personId, input.departureId, this.after(actor.personId, 'departure.ops_close', `سكّر الرحلة: ${input.reason}`, { reason: input.reason }));
    return result(w);
  }

  async overdue(input: OverdueDeparturesInput): Promise<OverdueDeparture[]> {
    const rows = await this.departures.overdue(this.rules, input.limit ?? 100);
    return rows.map((r) => ({
      departureId: r.dep.id,
      corridorId: r.dep.corridorId,
      garageId: r.dep.garageId,
      driverId: r.dep.driverId,
      state: r.dep.state,
      reason: r.reason,
      since: r.since,
      minutes: r.minutes,
      riders: r.riders,
      actions: r.reason === 'driver_no_show' ? ['cancel'] : ['arrive'],
    }));
  }

  /**
   * With `autoCancelNoShow` on: every departure whose driver never came is cancelled as a staff cancel
   * by `system` (audit row included). Departed-but-not-arrived ones only show on the overdue list.
   */
  async sweep(): Promise<number> {
    if (!this.rules.autoCancelNoShow) return 0;
    let n = 0;
    for (const r of await this.departures.overdue(this.rules, 200)) {
      if (r.reason !== 'driver_no_show') continue;
      const reason = `السايق ما إجه خلال ${this.rules.noShowAfterMin} دقيقة بعد آخر وقت للطلعة`;
      const w = await this.departures.staffCancel(SYSTEM, r.dep.id, this.after(SYSTEM, 'departure.ops_cancel', `تلقائياً: ${reason}`, { auto: true }), { auto: true });
      if (w.changed) n += 1;
    }
    return n;
  }

  private after(actorId: string, action: string, summaryAr: string, detail: Record<string, unknown>) {
    return async (tx: Tx, dep: DepartureRecord): Promise<string> =>
      (await this.audit.record({ cityId: HOME_CITY, actorId, action, subjectKind: 'departure', subjectId: dep.id, summaryAr, detail: { ...detail, driverId: dep.driverId, corridorId: dep.corridorId, state: dep.state } }, tx)).id;
  }

  private async safeSweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(`garage watch failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}

function result(w: StaffWrite): StaffDepartureResult {
  return { departureId: w.dep.id, state: w.dep.state, changed: w.changed, auditId: w.auditId };
}
