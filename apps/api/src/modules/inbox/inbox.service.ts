import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  DriverError,
  INBOX_CLOSE_AT_SOURCE,
  INBOX_KINDS,
  INBOX_PRIORITY,
  INBOX_RULES,
  INBOX_WORK_ROLES,
  type Actor,
  type InboxAssignInput,
  type InboxCounts,
  type InboxCountsInput,
  type InboxDoneInput,
  type InboxFacts,
  type InboxItem,
  type InboxKind,
  type InboxListInput,
  type InboxNoteInput,
  type InboxRow,
  type InboxServicePort,
  type InboxSnoozeInput,
  type InboxState,
  type InboxTakeInput,
} from '@driver/contracts';
import { CITY_UTC_OFFSET_MIN } from '@driver/i18n';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { EventsService, type PublishedEvent } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import {
  INBOX_REPOSITORY,
  type InboxPatch,
  type InboxRepository,
  type InboxSighting,
} from './inbox.repository.js';

export interface InboxConfig {
  /** The city a row lands in when its event carries none (one city at launch). */
  defaultCityId: string;
}
export const INBOX_CONFIG = Symbol('INBOX_CONFIG');

/** The events that open (or bring back) a row. */
export const INBOX_START_EVENTS = [
  'sos.raised',
  'dispatch.needs_dispatcher',
  'order.merchant_unresponsive',
  'order.late_apology',
  'trip.unreachable_started',
  'trip.unreachable_escalated',
  'khat.sweep_missed',
  'seat.pin_alert',
  'order.stuck',
  'courier.cash_over_cap',
  'support.ticket_opened',
  'driver.document_submitted',
  'merchant.onboarding_drafted',
  'order.rated',
  'departure.overdue',
] as const;

/** The events that end a problem (the row closes by itself, outcome `auto`), or take it. */
export const INBOX_END_EVENTS = [
  'support.resolved',
  'sos.acknowledged',
  'sos.resolved',
  'sos.cancelled',
  'dispatch.assigned',
  'dispatch.cancelled',
  'trip.accepted',
  'trip.completed',
  'trip.cancelled',
  'order.ready',
  'order.picked_up',
  'order.delivered',
  'order.cancelled',
  'order.closed',
  'order.rejected',
  'khat.sweep_alert_cleared',
  'khat.sweep_alert_closed',
  'order.unstuck',
  'courier.cash_under_cap',
  'driver.document_reviewed',
  'merchant.activated',
  'merchant.onboarding_rejected',
  'departure.overdue_cleared',
] as const;

const KIND_AR: Record<InboxKind, string> = {
  sos: 'طوارئ',
  safety_report: 'بلاغ سلامة',
  no_driver: 'محد أخذ المشوار',
  store_silent: 'مطعم ما يرد',
  late: 'طلب متأخر',
  unreachable: 'الدليفري ما يوصل للزبون',
  stuck: 'طلب معلّق',
  cash_cap: 'دليفري عبر حد الكاش',
  low_rating: 'تقييم سيئ',
  sweep: 'فحص السيارة الفارغة بالخطوط',
  pin_alert: 'رمز مقعد غلط',
  approval: 'موافقة',
  late_departure: 'سيارة رجعة متأخرة',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const fact = (v: unknown): string | number | boolean | null =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : null;

/**
 * The Today list (Console E1, CON-12). Hears the outbox: a problem's first event opens its row (one
 * per kind and subject), its end closes the row by itself; the desk takes, hands over, snoozes and
 * closes rows (always with an outcome), each change audited. Rows hold ids and short facts; staff
 * names come through `StaffNames` (logged vault reads, cached). Every bad rating (`order.rated`, food
 * or courier at `INBOX_RULES.lowRatingMaxStars` or under) opens a case, not only repeats (Ali,
 * 2026-10-08): staff hear the customer, the restaurant and the courier or driver, then close it with
 * a note saying what they found.
 */
@Injectable()
export class InboxService implements InboxServicePort, OnModuleInit, OnModuleDestroy {
  private readonly offs: Array<() => void> = [];

  constructor(
    @Inject(INBOX_REPOSITORY) private readonly repo: InboxRepository,
    @Inject(INBOX_CONFIG) private readonly config: InboxConfig,
    private readonly events: EventsService,
    private readonly audits: AuditLogService,
    private readonly names: StaffNames,
    private readonly identity: IdentityService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.offs.push(
      this.events.subscribe('inbox:start', [...INBOX_START_EVENTS], (e, ctx) =>
        this.onStart(e, ctx.tx),
      ),
      this.events.subscribe('inbox:end', [...INBOX_END_EVENTS], (e, ctx) => this.onEnd(e, ctx.tx)),
    );
  }

  onModuleDestroy(): void {
    for (const off of this.offs.splice(0)) off();
  }

  // ───────────────────────── from events ─────────────────────────

  /** What a start event says about its problem; null when it carries too little to point at. */
  sightingOf(e: PublishedEvent): InboxSighting | null {
    const p = e.payload;
    const cityId = str(p['cityId']) ?? this.config.defaultCityId;
    const base = {
      cityId,
      orderId: e.orderId ?? str(p['orderId']),
      tripId: e.tripId ?? str(p['tripId']),
      at: e.occurredAt,
    };
    const facts = (pairs: Record<string, unknown>): InboxFacts =>
      Object.fromEntries(
        Object.entries(pairs)
          .map(([k, v]) => [k, fact(v)])
          .filter(([, v]) => v !== null),
      );
    switch (e.type) {
      case 'sos.raised': {
        const id = str(p['incidentId']);
        return id
          ? {
              ...base,
              kind: 'sos',
              subjectKind: 'incident',
              subjectId: id,
              facts: facts({ role: p['role'], subject: p['subjectKind'] }),
            }
          : null;
      }
      case 'support.ticket_opened': {
        // Only safety cases (incident tickets: unsafe driving, a phoned-in near miss) reach Today; the
        // rest of support keeps its own queue. Handled and closed in support, as today (y1 off).
        const id = str(p['ticketId']);
        return id && p['kind'] === 'incident'
          ? {
              ...base,
              kind: 'safety_report',
              subjectKind: 'ticket',
              subjectId: id,
              facts: facts({ channel: p['channel'] }),
            }
          : null;
      }
      case 'dispatch.needs_dispatcher': {
        const id = e.tripId ?? null;
        return id
          ? {
              ...base,
              kind: 'no_driver',
              subjectKind: 'trip',
              subjectId: id,
              facts: facts({ reason: p['reason'], vertical: p['vertical'] }),
            }
          : null;
      }
      case 'order.merchant_unresponsive': {
        const id = e.orderId ?? null;
        return id
          ? {
              ...base,
              kind: 'store_silent',
              subjectKind: 'order',
              subjectId: id,
              facts: facts({ merchantOrgId: p['merchantOrgId'] }),
            }
          : null;
      }
      case 'order.late_apology': {
        const id = e.orderId ?? null;
        return id
          ? { ...base, kind: 'late', subjectKind: 'order', subjectId: id, facts: {} }
          : null;
      }
      case 'trip.unreachable_started':
      case 'trip.unreachable_escalated': {
        const id = e.tripId ?? null;
        return id
          ? {
              ...base,
              kind: 'unreachable',
              subjectKind: 'trip',
              subjectId: id,
              facts: e.type === 'trip.unreachable_escalated' ? { escalated: true } : {},
            }
          : null;
      }
      case 'khat.sweep_missed': {
        const id = str(p['alertId']);
        return id
          ? {
              ...base,
              kind: 'sweep',
              subjectKind: 'sweep_alert',
              subjectId: id,
              facts: facts({ driverId: p['driverId'] }),
            }
          : null;
      }
      case 'seat.pin_alert': {
        const id = str(p['attemptId']);
        return id
          ? {
              ...base,
              kind: 'pin_alert',
              subjectKind: 'pin_attempt',
              subjectId: id,
              facts: facts({ alert: p['alert'], departureId: e.aggregateId, driverId: e.actorId }),
            }
          : null;
      }
      case 'order.stuck': {
        const id = e.orderId ?? str(p['orderId']);
        return id
          ? {
              ...base,
              orderId: id,
              kind: 'stuck',
              subjectKind: 'order',
              subjectId: id,
              facts: facts({ reason: p['reason'] }),
            }
          : null;
      }
      case 'courier.cash_over_cap': {
        const id = str(p['courierId']);
        return id
          ? {
              ...base,
              kind: 'cash_cap',
              subjectKind: 'courier',
              subjectId: id,
              facts: facts({ cashIqd: p['cashIqd'], capIqd: p['capIqd'] }),
            }
          : null;
      }
      case 'driver.document_submitted': {
        const id = str(p['documentId']);
        return id
          ? {
              ...base,
              kind: 'approval',
              subjectKind: 'document',
              subjectId: id,
              facts: facts({ docKind: p['kind'], personId: e.actorId }),
            }
          : null;
      }
      case 'merchant.onboarding_drafted': {
        const id = str(p['onboardingId']);
        return id
          ? {
              ...base,
              kind: 'approval',
              subjectKind: 'onboarding',
              subjectId: id,
              facts: facts({ merchantOrgId: p['merchantOrgId'], type: p['type'] }),
            }
          : null;
      }
      case 'order.rated': {
        const id = e.orderId ?? str(p['orderId']);
        const score = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        // `stars` alone until lane A adds both scores to the event; with them, a bad food score under a
        // good courier one still counts.
        const food = score(p['food']);
        const delivery = score(p['delivery']);
        const stars = food === null && delivery === null ? score(p['stars']) : null;
        const worst = Math.min(food ?? 99, delivery ?? 99, stars ?? 99);
        return id && worst <= INBOX_RULES.lowRatingMaxStars
          ? {
              ...base,
              kind: 'low_rating',
              subjectKind: 'order',
              subjectId: id,
              facts: facts({ food, delivery, stars, orderType: p['orderType'] }),
            }
          : null;
      }
      case 'departure.overdue': {
        // The garage watch (routes module): a الرجعة car whose driver never came, or one out on the
        // road past its arrival with no «وصلت». One row per departure; it closes when the car leaves the
        // late list, whatever moved it (staff «ألغِ»/«وصلت», the driver, the automatic cancel).
        const id = str(p['departureId']);
        return id
          ? {
              ...base,
              kind: 'late_departure',
              subjectKind: 'departure',
              subjectId: id,
              facts: facts({ reason: p['reason'], riders: p['riders'], garageId: p['garageId'], corridorId: p['corridorId'] }),
            }
          : null;
      }
      default:
        return null;
    }
  }

  private async onStart(e: PublishedEvent, tx: Tx): Promise<void> {
    const s = this.sightingOf(e);
    if (s) await this.repo.sight(s, tx);
  }

  private async onEnd(e: PublishedEvent, tx: Tx): Promise<void> {
    const p = e.payload;
    const at = e.occurredAt;
    const closeSubject = async (kind: InboxKind, subjectId: string | null) => {
      if (!subjectId) return;
      const item = await this.repo.bySubject(kind, subjectId, tx);
      if (item) await this.autoClose(item, at, tx);
    };
    const closeFor = async (
      match: { orderId?: string | null; tripId?: string | null },
      kinds: readonly InboxKind[],
    ) => {
      for (const item of await this.repo.openFor({ ...match, kinds }, tx))
        await this.autoClose(item, at, tx);
    };
    switch (e.type) {
      case 'sos.acknowledged': {
        // Taken on the SOS desk: the row is that person's (unless someone already holds it).
        const item = await this.repo.bySubject('sos', str(p['incidentId']) ?? '', tx);
        if (item && !item.doneAt && !item.assigneeId && e.actorId)
          await this.repo.updateOpen(
            item.id,
            { assigneeId: e.actorId, assignedAt: at, snoozedUntil: null },
            tx,
          );
        return;
      }
      case 'sos.resolved':
      case 'sos.cancelled':
        return closeSubject('sos', str(p['incidentId']));
      case 'support.resolved':
        return closeSubject('safety_report', str(p['ticketId']));
      case 'dispatch.assigned':
      case 'dispatch.cancelled':
      case 'trip.accepted':
        return closeFor({ tripId: e.tripId ?? null }, ['no_driver']);
      case 'trip.completed':
      case 'trip.cancelled':
        return closeFor({ tripId: e.tripId ?? null }, ['no_driver', 'unreachable']);
      case 'order.ready':
      case 'order.picked_up':
        return closeFor({ orderId: e.orderId ?? null }, ['store_silent']);
      case 'order.delivered':
      case 'order.cancelled':
      case 'order.closed':
      case 'order.rejected':
        return closeFor({ orderId: e.orderId ?? null }, [
          'store_silent',
          'late',
          'no_driver',
          'unreachable',
        ]);
      case 'khat.sweep_alert_cleared':
      case 'khat.sweep_alert_closed':
        return closeSubject('sweep', str(p['alertId']));
      case 'order.unstuck':
        return closeSubject('stuck', e.orderId ?? str(p['orderId']));
      case 'courier.cash_under_cap':
        return closeSubject('cash_cap', str(p['courierId']));
      case 'driver.document_reviewed':
        return closeSubject('approval', str(p['documentId']));
      case 'merchant.activated':
      case 'merchant.onboarding_rejected':
        return closeSubject('approval', str(p['onboardingId']));
      case 'departure.overdue_cleared':
        return closeSubject('late_departure', str(p['departureId']));
      default:
        return;
    }
  }

  /** Closes a row the problem itself ended; an end older than the row's last sighting changes nothing. */
  private async autoClose(item: InboxItem, at: Date, tx: Tx): Promise<void> {
    if (item.doneAt || at.getTime() < item.lastSeenAt.getTime()) return;
    await this.repo.updateOpen(
      item.id,
      { doneAt: at, doneById: null, outcome: 'auto', snoozedUntil: null },
      tx,
    );
  }

  // ───────────────────────── reads ─────────────────────────

  private dayStart(now: Date): Date {
    const shift = CITY_UTC_OFFSET_MIN * 60_000;
    const local = new Date(now.getTime() + shift);
    return new Date(
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - shift,
    );
  }

  private doneSince(now: Date): Date {
    const keep = new Date(now.getTime() - INBOX_RULES.doneKeepHours * 3_600_000);
    const day = this.dayStart(now);
    return keep < day ? keep : day;
  }

  static stateOf(item: InboxItem, now: Date): InboxState {
    if (item.doneAt) return 'done';
    if (item.snoozedUntil && item.snoozedUntil.getTime() > now.getTime()) return 'snoozed';
    return 'open';
  }

  async list(actor: Actor, input: z.output<typeof InboxListInput>): Promise<InboxRow[]> {
    const now = this.clock.now();
    const keepDone = new Date(now.getTime() - INBOX_RULES.doneKeepHours * 3_600_000);
    const items = (await this.repo.forCity(input.cityId, this.doneSince(now), 2_000)).filter(
      (i) => {
        if (input.kind && i.kind !== input.kind) return false;
        const state = InboxService.stateOf(i, now);
        switch (input.view) {
          case 'open':
            return state === 'open';
          case 'mine':
            return state !== 'done' && i.assigneeId === actor.personId;
          case 'snoozed':
            return state === 'snoozed';
          case 'done':
            return state === 'done' && i.doneAt!.getTime() >= keepDone.getTime();
        }
      },
    );
    if (input.view === 'done') items.sort((a, b) => b.doneAt!.getTime() - a.doneAt!.getTime());
    else
      items.sort(
        (a, b) =>
          INBOX_PRIORITY[a.kind] - INBOX_PRIORITY[b.kind] ||
          a.openedAt.getTime() - b.openedAt.getTime(),
      );
    return this.rows(actor, items.slice(0, INBOX_RULES.listLimit), now);
  }

  async counts(actor: Actor, input: z.output<typeof InboxCountsInput>): Promise<InboxCounts> {
    const now = this.clock.now();
    const day = this.dayStart(now);
    const items = await this.repo.forCity(input.cityId, day, 2_000);
    const byKind = Object.fromEntries(INBOX_KINDS.map((k) => [k, 0])) as Record<InboxKind, number>;
    const out: InboxCounts = {
      cityId: input.cityId,
      open: 0,
      unassigned: 0,
      mine: 0,
      snoozed: 0,
      doneToday: 0,
      byKind,
      oldestOpenAt: null,
    };
    for (const i of items) {
      const state = InboxService.stateOf(i, now);
      if (state === 'done') {
        out.doneToday += 1;
        continue;
      }
      if (i.assigneeId === actor.personId) out.mine += 1;
      if (state === 'snoozed') {
        out.snoozed += 1;
        continue;
      }
      out.open += 1;
      byKind[i.kind] += 1;
      if (!i.assigneeId) out.unassigned += 1;
      if (!out.oldestOpenAt || i.openedAt < out.oldestOpenAt) out.oldestOpenAt = i.openedAt;
    }
    return out;
  }

  private async rows(actor: Actor, items: readonly InboxItem[], now: Date): Promise<InboxRow[]> {
    const ids = items.flatMap((i) => [i.assigneeId, i.doneById]).filter((x): x is string => !!x);
    const names = ids.length > 0 ? await this.names.of(ids, actor.personId) : {};
    return items.map((i) => ({
      ...i,
      state: InboxService.stateOf(i, now),
      assigneeName: i.assigneeId ? (names[i.assigneeId] ?? null) : null,
      doneByName: i.doneById ? (names[i.doneById] ?? null) : null,
      mine: i.assigneeId === actor.personId,
    }));
  }

  // ───────────────────────── the desk ─────────────────────────

  private async change(
    actor: Actor,
    id: string,
    action: string,
    summary: (item: InboxItem) => string,
    patch: (item: InboxItem, now: Date) => InboxPatch,
    detail: Record<string, unknown> = {},
  ): Promise<InboxRow> {
    const now = this.clock.now();
    const updated = await this.uow.run(async (tx) => {
      const item = await this.repo.get(id, tx);
      if (!item) throw new DriverError('inbox_not_found');
      if (item.doneAt) throw new DriverError('inbox_done');
      if (action === 'inbox.done' && INBOX_CLOSE_AT_SOURCE.includes(item.kind))
        throw new DriverError('inbox_close_at_source');
      const after = await this.repo.updateOpen(id, patch(item, now), tx);
      if (!after) throw new DriverError('inbox_done');
      await this.audits.record(
        {
          cityId: item.cityId,
          actorId: actor.personId,
          action,
          subjectKind: 'inbox_item',
          subjectId: item.id,
          summaryAr: summary(item),
          detail: {
            kind: item.kind,
            subjectKind: item.subjectKind,
            subjectId: item.subjectId,
            ...detail,
          },
        },
        tx,
      );
      return after;
    });
    return (await this.rows(actor, [updated], now))[0]!;
  }

  take(actor: Actor, input: InboxTakeInput): Promise<InboxRow> {
    return this.change(
      actor,
      input.id,
      'inbox.take',
      (i) => `استلم ${KIND_AR[i.kind]}`,
      (_i, now) => ({
        assigneeId: actor.personId,
        assignedAt: now,
        snoozedUntil: null,
      }),
    );
  }

  async assign(actor: Actor, input: InboxAssignInput): Promise<InboxRow> {
    if (input.personId !== actor.personId) {
      const staff = await this.identity.rosterEntry(input.personId, INBOX_WORK_ROLES);
      if (!staff || staff.frozen) throw new DriverError('inbox_not_staff');
    }
    return this.change(
      actor,
      input.id,
      'inbox.assign',
      (i) => `سلّم ${KIND_AR[i.kind]} لموظف ثاني`,
      (_i, now) => ({ assigneeId: input.personId, assignedAt: now }),
      { personId: input.personId },
    );
  }

  snooze(actor: Actor, input: InboxSnoozeInput): Promise<InboxRow> {
    return this.change(
      actor,
      input.id,
      'inbox.snooze',
      (i) => `أجّل ${KIND_AR[i.kind]} ${input.minutes} دقيقة`,
      (_i, now) => ({ snoozedUntil: new Date(now.getTime() + input.minutes * 60_000) }),
      { minutes: input.minutes },
    );
  }

  async done(actor: Actor, input: z.output<typeof InboxDoneInput>): Promise<InboxRow> {
    // A bad-rating case closes with what staff found (Ali, 2026-10-08): a note here or one already on it.
    if (!input.note) {
      const item = await this.repo.get(input.id);
      if (item?.kind === 'low_rating' && !item.note) throw new DriverError('invalid_input');
    }
    return this.change(
      actor,
      input.id,
      'inbox.done',
      (i) => `سكّر ${KIND_AR[i.kind]}`,
      (i, now) => ({
        doneAt: now,
        doneById: actor.personId,
        outcome: input.outcome,
        snoozedUntil: null,
        ...(input.note ? { note: input.note } : {}),
        ...(i.assigneeId ? {} : { assigneeId: actor.personId, assignedAt: now }),
      }),
      { outcome: input.outcome, hasNote: !!input.note },
    );
  }

  note(actor: Actor, input: z.output<typeof InboxNoteInput>): Promise<InboxRow> {
    return this.change(
      actor,
      input.id,
      'inbox.note',
      (i) => `كتب ملاحظة على ${KIND_AR[i.kind]}`,
      () => ({ note: input.note }),
      { hasNote: true },
    );
  }
}
