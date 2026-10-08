import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  DriverError,
  ON_CALL_READ_ROLES,
  ON_CALL_RING_ROLES,
  ON_CALL_RULES,
  orderTicketNumber,
  type Actor,
  type AlertLadder,
  type AlertLadderInput,
  type ConsolePresentInput,
  type ConsoleWatch,
  type IncidentForPaging,
  type LadderStep,
  type OnCallAddInput,
  type OnCallDesk,
  type OnCallEndInput,
  type OnCallListInput,
  type OnCallNow,
  type OnCallNowInput,
  type OnCallPort,
  type OnCallServicePort,
  type OnCallShift,
  type OnCallShiftRow,
  type OnCallStaff,
  type PagePlan,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { AuditLogService } from '../controls/index.js';
import { EventsService, type PublishedEvent } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { NotifyService } from '../notify/index.js';
import { ConsoleWatchService } from './console-watch.service.js';
import {
  ON_CALL_REPOSITORY,
  type AlertBrief,
  type LadderRecord,
  type OnCallRepository,
} from './on-call.repository.js';

/** Words the WhatsApp/push template takes (`sos_dispatch_alert`: name, role, what, link). */
const ROLE_AR: Record<string, string> = { driver: 'سايق', customer: 'زبون' };
const SUBJECT_AR: Record<string, string> = {
  trip: 'مشوار',
  order: 'طلب',
  departure: 'رحلة الرجعة',
  booking: 'مقعد بالرجعة',
  request: 'مشوار خاص',
};
const DESK_AR: Record<OnCallDesk, string> = { sos: 'الطوارئ', cash: 'الكاش' };
const DESKS: readonly OnCallDesk[] = ['sos', 'cash'];

export interface OnCallConfig {
  /** The Console origin, for the link in the WhatsApp ("افتح الكونسول"). */
  consoleBase: string;
  /** How often the ladder sweep runs (0: off; tests drive `tick()` themselves). */
  tickMs: number;
}
export const ON_CALL_CONFIG = Symbol('ON_CALL_CONFIG');
/** The port the safety module injects (agreed with lane A): who to page first. */
export const ON_CALL_PORT = Symbol('ON_CALL_PORT');

const plus = (d: Date, sec: number) => new Date(d.getTime() + sec * 1000);

/**
 * On call (Console E1, CON-02 and G0-9). Owns `on_call_shifts` (the roster: who is reached when an
 * alert reaches nobody, per city, desk and rank) and `alert_ladders` (each alert's rings and steps).
 *
 * An SOS opens a ladder (`sos.raised`). The safety module has already rung the desk; from then on the
 * sweep rings it again (push) every 30 s, then every 2 min after 10 min, until someone takes it
 * (`sos.acknowledged`) or it is closed (`sos.resolved`, `sos.cancelled`). At 60 s the first people on
 * call are reached on every channel and the alert is marked unanswered; at 120 s the people after
 * them. With nobody on the roster, the admins are reached instead. Every step is claimed in the
 * database before anyone is paged, so a restart or a second machine never pages twice or skips a step.
 */
@Injectable()
export class OnCallService implements OnCallServicePort, OnCallPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OnCallService.name);
  private readonly offs: Array<() => void> = [];
  private ticker: NodeJS.Timeout | undefined;
  private ticking = false;
  /** The raiser's display name per alert (one logged vault read per alert, not per ring). */
  private readonly names = new Map<string, string>();

  constructor(
    @Inject(ON_CALL_REPOSITORY) private readonly repo: OnCallRepository,
    @Inject(ON_CALL_CONFIG) private readonly config: OnCallConfig,
    private readonly identity: IdentityService,
    private readonly notify: NotifyService,
    private readonly events: EventsService,
    private readonly audits: AuditLogService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly watch: ConsoleWatchService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    this.offs.push(
      this.events.subscribe(
        'on-call:ladder',
        ['sos.raised', 'sos.acknowledged', 'sos.resolved', 'sos.cancelled'],
        (e, ctx) => this.onEvent(e, ctx.tx),
      ),
    );
    // The ladder sweep runs on job machines only (web machines serve reads); its claims are in the
    // database, so any number of job machines may run it.
    if (this.config.tickMs > 0 && runsJobs(this.role)) {
      this.ticker = setInterval(
        () =>
          void this.tick().catch((err: unknown) =>
            this.logger.error(`tick: ${(err as Error).message}`),
          ),
        this.config.tickMs,
      );
      this.ticker.unref();
    }
  }

  onModuleDestroy(): void {
    for (const off of this.offs.splice(0)) off();
    if (this.ticker) clearInterval(this.ticker);
  }

  // ───────────────────────── the roster ─────────────────────────

  async list(actor: Actor, input: z.output<typeof OnCallListInput>): Promise<OnCallShiftRow[]> {
    const now = this.clock.now();
    const from = input.from ?? now;
    const to = input.to ?? plus(now, 7 * 86_400);
    return this.rows(actor, await this.repo.shifts(input.cityId, from, to), now);
  }

  async now(actor: Actor, input: z.output<typeof OnCallNowInput>): Promise<OnCallNow[]> {
    const now = this.clock.now();
    const out: OnCallNow[] = [];
    for (const desk of DESKS) {
      const shifts = await this.repo.onCallAt(input.cityId, desk, now);
      const rows = await this.rows(actor, shifts, now);
      out.push({
        cityId: input.cityId,
        desk,
        people: rows.map((r) => ({
          personId: r.personId,
          rank: r.rank,
          displayName: r.displayName,
          until: r.endsAt,
        })),
        fallbackToAdmins: rows.length === 0,
      });
    }
    return out;
  }

  async add(actor: Actor, input: z.output<typeof OnCallAddInput>): Promise<OnCallShiftRow> {
    const staff = await this.identity.rosterEntry(input.personId, ON_CALL_READ_ROLES);
    if (!staff || staff.frozen) throw new DriverError('on_call_not_staff');
    const now = this.clock.now();
    const shift = await this.uow.run(async (tx) => {
      const added = await this.repo.addShift(
        {
          cityId: input.cityId,
          desk: input.desk,
          personId: input.personId,
          rank: input.rank,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          createdById: actor.personId,
        },
        now,
        tx,
      );
      await this.audits.record(
        {
          cityId: input.cityId,
          actorId: actor.personId,
          action: 'on_call.shift_added',
          subjectKind: 'on_call_shift',
          subjectId: added.id,
          summaryAr: `مناوبة ${DESK_AR[input.desk]} (${input.rank === 1 ? 'أول من يُبلَّغ' : 'بعدهم'}) أضيفت`,
          detail: {
            personId: input.personId,
            desk: input.desk,
            rank: input.rank,
            startsAt: input.startsAt.toISOString(),
            endsAt: input.endsAt.toISOString(),
          },
        },
        tx,
      );
      return added;
    });
    return (await this.rows(actor, [shift], now))[0]!;
  }

  async end(actor: Actor, input: z.output<typeof OnCallEndInput>): Promise<OnCallShiftRow> {
    const now = this.clock.now();
    const shift = await this.uow.run(async (tx) => {
      const found = await this.repo.shift(input.id, tx);
      if (!found) throw new DriverError('on_call_not_found');
      if (found.endedAt) return found;
      const ended = await this.repo.endShift(found.id, now, tx);
      await this.audits.record(
        {
          cityId: found.cityId,
          actorId: actor.personId,
          action: 'on_call.shift_ended',
          subjectKind: 'on_call_shift',
          subjectId: found.id,
          summaryAr: `مناوبة ${DESK_AR[found.desk]} انشالت من الجدول`,
          detail: { personId: found.personId, desk: found.desk, rank: found.rank },
        },
        tx,
      );
      return ended;
    });
    return (await this.rows(actor, [shift], now))[0]!;
  }

  async ladder(
    _actor: Actor,
    input: z.output<typeof AlertLadderInput>,
  ): Promise<AlertLadder | null> {
    const l = await this.repo.ladder(input.alertId);
    return l
      ? {
          alertId: l.alertId,
          kind: l.kind,
          cityId: l.cityId,
          openedAt: l.openedAt,
          unanswered: l.unanswered,
          takenAt: l.takenAt,
          closedAt: l.closedAt,
          rings: l.rings,
          steps: l.steps,
        }
      : null;
  }

  /** Everyone who may be put on call (staff, not frozen), with names: the roster form's list. */
  async staff(actor: Actor): Promise<OnCallStaff[]> {
    const roster = await this.identity.roster({ kinds: ON_CALL_READ_ROLES, limit: 200 });
    const rows = roster.rows.filter((r) => !r.frozen);
    const names =
      rows.length > 0
        ? await this.identity.displayNamesFor(
            rows.map((r) => r.personId),
            actor.personId,
            'console_staff',
          )
        : {};
    return rows.map((r) => ({
      personId: r.personId,
      displayName: names[r.personId]?.displayName ?? null,
      roles: [...r.roles],
    }));
  }

  /** A staff screen's heartbeat (the Console watching itself, E1 step 3). */
  present(actor: Actor, input: ConsolePresentInput): Promise<ConsoleWatch> {
    return this.watch.present(actor, input);
  }

  private async rows(
    actor: Actor,
    shifts: readonly OnCallShift[],
    now: Date,
  ): Promise<OnCallShiftRow[]> {
    const names =
      shifts.length > 0
        ? await this.identity.displayNamesFor(
            shifts.map((s) => s.personId),
            actor.personId,
            'console_staff',
          )
        : {};
    return shifts.map((s) => ({
      ...s,
      displayName: names[s.personId]?.displayName ?? null,
      now:
        s.endedAt === null &&
        s.startsAt.getTime() <= now.getTime() &&
        s.endsAt.getTime() > now.getTime(),
    }));
  }

  // ───────────────────────── the first page (the safety module's port) ─────────────────────────

  /** Every dispatcher, support agent and admin who is not frozen: the desk, rung first. */
  async firstPage(_incident: IncidentForPaging): Promise<PagePlan> {
    return {
      step: 'ring',
      staffPersonIds: await this.desk(null),
      ackWithinSec: ON_CALL_RULES.onCallAfterSec,
      source: 'roster',
    };
  }

  private async desk(exceptId: string | null): Promise<string[]> {
    const roster = await this.identity.roster({ kinds: ON_CALL_RING_ROLES, limit: 200 });
    return roster.rows.filter((r) => !r.frozen && r.personId !== exceptId).map((r) => r.personId);
  }

  private async admins(): Promise<string[]> {
    const roster = await this.identity.roster({ kinds: ['admin'], limit: 50 });
    return roster.rows.filter((r) => !r.frozen).map((r) => r.personId);
  }

  // ───────────────────────── the ladder ─────────────────────────

  private async onEvent(e: PublishedEvent, tx: Tx): Promise<void> {
    const alertId = typeof e.payload['incidentId'] === 'string' ? e.payload['incidentId'] : null;
    if (!alertId) return;
    const str = (k: string) => (typeof e.payload[k] === 'string' ? (e.payload[k] as string) : null);
    if (e.type === 'sos.raised') {
      const cityId = str('cityId');
      if (!cityId) return;
      const brief: AlertBrief = {
        raiserId: e.actorId ?? null,
        role: str('role'),
        subjectKind: str('subjectKind'),
        orderId: str('orderId'),
        subjectLabel: str('subjectLabel')?.slice(0, 60) ?? null,
      };
      await this.repo.openLadder(
        {
          alertId,
          kind: 'sos',
          cityId,
          brief,
          openedAt: e.occurredAt,
          nextRingAt: plus(e.occurredAt, ON_CALL_RULES.ringEverySec),
        },
        tx,
      );
    } else if (e.type === 'sos.acknowledged') {
      await this.repo.take(alertId, e.occurredAt, tx);
      this.names.delete(alertId);
    } else {
      await this.repo.close(alertId, e.occurredAt, tx);
      this.names.delete(alertId);
    }
  }

  /**
   * One pass of the sweep: every ringing ladder that is due moves on by one step, then the Console's
   * watch on itself (nobody watching, live updates down).
   */
  async tick(): Promise<{ rings: number; onCall: number }> {
    if (this.ticking) return { rings: 0, onCall: 0 };
    this.ticking = true;
    try {
      let rings = 0;
      let onCall = 0;
      for (const l of await this.repo.ringing(200)) {
        const did = await this.step(l);
        if (did === 'ring') rings += 1;
        else if (did) onCall += 1;
      }
      await this.watch
        .sweep()
        .catch((err: unknown) => this.logger.error(`watch: ${(err as Error).message}`));
      return { rings, onCall };
    } finally {
      this.ticking = false;
    }
  }

  /** What is due for one ladder now: an on-call step first, else a ring. */
  private async step(l: LadderRecord): Promise<LadderStep['step'] | null> {
    const now = this.clock.now();
    const ageSec = (now.getTime() - l.openedAt.getTime()) / 1000;
    const seen = { rings: l.rings, onCallStep: l.onCallStep };
    const nextRingAt = plus(
      now,
      ageSec >= ON_CALL_RULES.ringSlowAfterSec
        ? ON_CALL_RULES.ringSlowEverySec
        : ON_CALL_RULES.ringEverySec,
    );

    const rank =
      l.onCallStep < 1 && ageSec >= ON_CALL_RULES.onCallAfterSec
        ? 1
        : l.onCallStep < 2 && ageSec >= ON_CALL_RULES.nextRankAfterSec
          ? 2
          : 0;
    if (rank > 0) {
      const onCall = (await this.repo.onCallAt(l.cityId, 'sos', now))
        .filter((s) => s.rank === rank)
        .map((s) => s.personId);
      const to = onCall.length > 0 ? onCall : await this.admins();
      const step: LadderStep = {
        at: now,
        step: onCall.length > 0 ? (rank === 1 ? 'on_call_1' : 'on_call_2') : 'admins',
        count: to.length,
      };
      const done = await this.uow.run(async (tx) => {
        if (
          !(await this.repo.advance(
            l.alertId,
            seen,
            { rings: l.rings, onCallStep: rank, nextRingAt: l.nextRingAt, unanswered: true, step },
            tx,
          ))
        )
          return false;
        await this.page(l, to, `${l.alertId}:on_call:${rank}`, 'sos_dispatch_alert', tx);
        return true;
      });
      return done ? step.step : null;
    }

    if (now.getTime() < l.nextRingAt.getTime()) return null;
    const desk = await this.desk(l.brief.raiserId);
    const step: LadderStep = { at: now, step: 'ring', count: desk.length };
    const done = await this.uow.run(async (tx) => {
      if (
        !(await this.repo.advance(
          l.alertId,
          seen,
          {
            rings: l.rings + 1,
            onCallStep: l.onCallStep,
            nextRingAt,
            unanswered: l.unanswered,
            step,
          },
          tx,
        ))
      )
        return false;
      await this.page(l, desk, `${l.alertId}:ring:${l.rings + 1}`, 'sos_desk_ring', tx);
      return true;
    });
    return done ? 'ring' : null;
  }

  /** `sos_desk_ring`: push only, no SMS twin. `sos_dispatch_alert`: push and WhatsApp, SMS twin after 30 s. */
  private async page(
    l: LadderRecord,
    to: readonly string[],
    eventId: string,
    template: 'sos_desk_ring' | 'sos_dispatch_alert',
    tx: Tx,
  ): Promise<void> {
    const params = {
      name: await this.raiserName(l),
      role: ROLE_AR[l.brief.role ?? ''] ?? 'شخص',
      what: this.what(l.brief),
      link: `${this.config.consoleBase.replace(/\/$/, '')}/safety/${l.alertId}`,
      incidentId: l.alertId,
    };
    for (const personId of to) {
      await this.notify.dispatch(
        {
          eventId,
          template,
          to: personId,
          params,
          data: { incidentId: l.alertId },
          ...(l.brief.orderId ? { orderId: l.brief.orderId } : {}),
        },
        tx,
      );
    }
  }

  private what(b: AlertBrief): string {
    if (b.subjectLabel) return b.subjectLabel;
    if (b.orderId) return `${SUBJECT_AR['order']} #${orderTicketNumber(b.orderId)}`;
    return SUBJECT_AR[b.subjectKind ?? ''] ?? 'طوارئ';
  }

  private async raiserName(l: LadderRecord): Promise<string> {
    const cached = this.names.get(l.alertId);
    if (cached) return cached;
    const id = l.brief.raiserId;
    const name = id
      ? ((await this.identity.displayNamesFor([id], 'system:on-call', 'sos_page'))[id]
          ?.displayName ?? 'شخص')
      : 'شخص';
    this.names.set(l.alertId, name);
    return name;
  }
}
