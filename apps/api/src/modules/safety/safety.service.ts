import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  DriverError,
  liveChannel,
  SAFETY_PAGED_ROLES,
  SAFETY_RULES,
  type Actor,
  type DeliveryLogRow,
  type SafetyCallInput,
  type SafetyCallSession,
  type SafetyEntry,
  type SafetyFix,
  type SafetyIncidentCase,
  type SafetyIncidentIdInput,
  type SafetyIncidentSummary,
  type SafetyListInput,
  type SafetyNoteInput,
  type SafetyPerson,
  type SafetyPort,
  type SafetyResolveInput,
  type SosCategoryInput,
  type SosContactStatus,
  type SosIncidentIdInput,
  type SosPosition,
  type SosPositionInput,
  type SosRaiseInput,
  type SosShared,
  type SosSharedInput,
  type SosStatusInput,
  type SosView,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { EventsService, type PublishedEvent } from '../events/index.js';
import { IdentityService, maskPhone, shortDisplayName } from '../identity/index.js';
import { LIVE_BUS, type LiveBus } from '../live/index.js';
import { emergencyContactRecipient, NotifyService } from '../notify/index.js';
import { LIVE_STATES, SAFETY_REPOSITORY, type EntryRecord, type FixRecord, type IncidentRecord, type SafetyRepository } from './safety.repository.js';
import { resolveSubject, type SafetySources } from './safety.subjects.js';

export const SAFETY_SOURCES = Symbol('SAFETY_SOURCES');
export const SAFETY_CALLS = Symbol('SAFETY_CALLS');
export const SAFETY_CONFIG = Symbol('SAFETY_CONFIG');

/** A masked call (the chat module's bridge, with the emergency contact as a possible callee). */
export interface SafetyCallPort {
  open(req: { callId: string; orderId: string; callerId: string; calleeId: string }, now: Date): Promise<{ mode: 'proxy' | 'dev_direct'; dial: string; expiresAt: Date }>;
}

export interface SafetyConfig {
  /** HMAC key of the emergency contact's live-location link. */
  secret: string;
  /** The public page the link opens (`<base><token>`). */
  linkBase: string;
  /** The Console origin, for the dispatcher's WhatsApp ("افتح الكونسول"). */
  consoleBase: string;
  /** In-process timers for the contact message (after the cancel window) and the 60-s escalation. */
  timers: boolean;
  /** The sweep that catches anything a timer missed (restarts, other instances); 0 = off. */
  sweepMs: number;
}

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const NAME_TTL_MS = 5 * MIN_MS;
const ROLE_AR = { driver: 'سايق', customer: 'زبون' } as const;
const OUTCOME_AR = { safe: 'الشخص بخير', false_alarm: 'تنبيه بالغلط', emergency: 'وصلنا الشرطة أو الإسعاف', escalated: 'صعّدناه لعلي' } as const;

const isUnique = (err: unknown) => /unique|P2002|client_id_key/i.test(String((err as { code?: string; message?: string })?.code ?? '') + String((err as Error)?.message ?? ''));

/**
 * SOS (scoring & safety §3). A person on an active trip holds "طوارئ" for 3 s: `sos` opens a safety
 * incident (Postgres), emits `sos.raised` through the outbox and returns at once. The outbox
 * subscriber `safety:alerts` pages every live dispatcher and admin (push + WhatsApp, SMS twin after
 * 30 s); the Console hears it on the `safety` live channel (red banner with sound on every page).
 * After the 10-s cancel window the person's emergency contact gets a WhatsApp (SMS twin) with a
 * live-location link; the phone keeps sending its position every 5 s while the incident is open.
 * Nobody took it within 60 s → `sos.escalated` pages the admins again. A dispatcher acknowledges,
 * calls through the masked-call port and resolves with a note. Names and numbers are read from the
 * vault only, and every read is logged with the reader and the purpose.
 */
@Injectable()
export class SafetyService implements SafetyPort, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SafetyService.name);
  private readonly offs: Array<() => void> = [];
  private readonly timers = new Set<NodeJS.Timeout>();
  private sweeper: NodeJS.Timeout | undefined;
  private sweeping = false;
  /** Display names per reader and person (each fresh read is a logged vault read). */
  private readonly names = new Map<string, { name: string | null; at: number }>();
  /** The emergency contact's first name per incident, for the pressing phone's status polls. */
  private readonly contactNames = new Map<string, string | null>();

  constructor(
    @Inject(SAFETY_REPOSITORY) private readonly repo: SafetyRepository,
    @Inject(SAFETY_SOURCES) private readonly sources: SafetySources,
    @Inject(SAFETY_CALLS) private readonly calls: SafetyCallPort,
    @Inject(SAFETY_CONFIG) private readonly config: SafetyConfig,
    @Inject(LIVE_BUS) private readonly bus: LiveBus,
    private readonly identity: IdentityService,
    private readonly notify: NotifyService,
    private readonly events: EventsService,
    private readonly audits: AuditLogService,
    private readonly staff: StaffNames,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.offs.push(this.events.subscribe('safety:alerts', ['sos.raised', 'sos.escalated'], (e, ctx) => this.page(e, ctx.tx)));
    if (this.config.sweepMs > 0) {
      this.sweeper = setInterval(() => void this.sweep().catch((err: unknown) => this.logger.error(`sweep: ${(err as Error).message}`)), this.config.sweepMs);
      this.sweeper.unref();
    }
  }

  onModuleDestroy(): void {
    for (const off of this.offs.splice(0)) off();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.sweeper) clearInterval(this.sweeper);
  }

  // ───────────────────────── the person on the trip ─────────────────────────

  async sos(actor: Actor, input: SosRaiseInput): Promise<SosView> {
    const now = this.clock.now();
    // A retry of the same press (flaky network) is the same incident.
    const again = await this.repo.byClient(actor.personId, input.clientId);
    if (again) return this.joinPress(again, input.position, now);
    const recent = await this.repo.ofRaiser(actor.personId, new Date(now.getTime() - HOUR_MS));
    // A second press while one is still open joins it: one person, one red banner.
    const open = recent.find((r) => LIVE_STATES.includes(r.state));
    if (open) return this.joinPress(open, input.position, now);
    if (recent.length >= SAFETY_RULES.maxPerHour) {
      const oldest = recent[recent.length - 1]!;
      throw new DriverError('sos_rate_limited', { retryAfterSec: Math.max(1, Math.ceil((oldest.raisedAt.getTime() + HOUR_MS - now.getTime()) / 1000)) });
    }
    const subject = await resolveSubject(this.sources, actor.personId, input.subject, now);
    // No GPS on the phone: start from where the car last was (when the person is in it).
    const position: SosPosition | null = input.position ?? (subject.carFix ? { lat: subject.carFix.lat, lng: subject.carFix.lng, accuracyM: null, at: subject.carFix.at } : null);
    const contact = await this.identity.emergencyContactOf(actor.personId, 'system:safety', 'sos_raised');
    let rec: IncidentRecord;
    try {
      rec = await this.uow.run(async (tx) => {
        const created = await this.repo.create(
          {
            cityId: subject.cityId,
            raiserId: actor.personId,
            raiserRole: subject.role,
            subjectKind: input.subject.kind,
            subjectId: input.subject.id,
            tripId: subject.tripId,
            orderId: subject.orderId,
            departureId: subject.departureId,
            counterpartId: subject.counterpartId,
            state: 'open',
            category: input.category ?? null,
            clientId: input.clientId,
            raiseEventId: null,
            contactSet: Boolean(contact),
            contactAt: null,
            subjectLabel: subject.label,
            vehicleLabel: subject.vehicle,
            pressedAt: input.pressedAt ?? null,
            raisedAt: now,
            cancelUntil: new Date(now.getTime() + SAFETY_RULES.cancelWindowSec * 1000),
            last: position ? { lat: position.lat, lng: position.lng, accuracyM: position.accuracyM, deviceAt: position.at, at: now } : null,
            acknowledgedAt: null,
            acknowledgedById: null,
            escalatedAt: null,
            cancelledAt: null,
            resolvedAt: null,
            resolvedById: null,
            outcome: null,
            resolution: null,
          },
          tx,
        );
        if (position) await this.repo.addFix({ incidentId: created.id, lat: position.lat, lng: position.lng, accuracyM: position.accuracyM, deviceAt: position.at, at: now }, tx);
        await this.repo.addEntry({ incidentId: created.id, kind: 'raised', at: now, byId: null, note: null, data: { role: subject.role, ...(input.category ? { category: input.category } : {}) } }, tx);
        if (!contact) await this.repo.addEntry({ incidentId: created.id, kind: 'contact', at: now, byId: null, note: null, data: { status: 'none' } }, tx);
        // Server time on purpose: the device's clock is in the payload, never a reason to quarantine an SOS.
        const ev = await this.events.emit(
          tx,
          {
            type: 'sos.raised',
            actorId: actor.personId,
            occurredAt: now,
            ...(subject.tripId ? { tripId: subject.tripId } : {}),
            ...(position ? { location: { lat: position.lat, lng: position.lng } } : {}),
            idempotencyKey: `sos:${actor.personId}:${input.clientId}`,
            payload: {
              incidentId: created.id,
              cityId: subject.cityId,
              role: subject.role,
              subjectKind: input.subject.kind,
              subjectId: input.subject.id,
              orderId: subject.orderId,
              departureId: subject.departureId,
              contactSet: Boolean(contact),
              pressedAt: input.pressedAt?.toISOString() ?? null,
            },
          },
          { name: 'safety_incident', id: created.id },
        );
        return this.repo.update(created.id, { raiseEventId: ev.id }, tx);
      });
    } catch (err) {
      // Two retries of one press raced past `byClient`: the loser returns the winner's incident.
      const winner = isUnique(err) ? await this.repo.byClient(actor.personId, input.clientId) : null;
      if (winner) return this.personView(winner);
      throw err;
    }
    this.contactNames.set(rec.id, contact ? contactLabel(contact.name) : null);
    this.schedule(rec);
    await this.publish('sos.raised');
    return this.personView(rec);
  }

  async cancel(actor: Actor, input: SosIncidentIdInput): Promise<SosView> {
    const inc = await this.own(actor, input.incidentId);
    if (inc.state === 'cancelled') return this.personView(inc);
    if (inc.state === 'resolved') throw new DriverError('safety_incident_closed');
    const now = this.clock.now();
    if (now.getTime() > inc.cancelUntil.getTime()) throw new DriverError('sos_cancel_window_passed');
    const rec = await this.uow.run(async (tx) => {
      const updated = await this.repo.update(inc.id, { state: 'cancelled', cancelledAt: now, outcome: 'false_alarm' }, tx);
      await this.repo.addEntry({ incidentId: inc.id, kind: 'cancelled', at: now, byId: null, note: null, data: {} }, tx);
      await this.events.emit(tx, { type: 'sos.cancelled', actorId: actor.personId, occurredAt: now, idempotencyKey: `sos:${inc.id}:cancelled`, payload: { incidentId: inc.id, cityId: inc.cityId } }, { name: 'safety_incident', id: inc.id });
      return updated;
    });
    await this.publish('sos.cancelled');
    return this.personView(rec);
  }

  async status(actor: Actor, input: SosStatusInput): Promise<SosView | null> {
    if (input.incidentId) return this.personView(await this.own(actor, input.incidentId));
    const now = this.clock.now();
    const recent = await this.repo.ofRaiser(actor.personId, new Date(now.getTime() - 24 * HOUR_MS));
    const live = recent.find((r) => LIVE_STATES.includes(r.state));
    return live ? this.personView(live) : null;
  }

  async position(actor: Actor, input: SosPositionInput): Promise<SosView> {
    const inc = await this.own(actor, input.incidentId);
    if (!LIVE_STATES.includes(inc.state)) return this.personView(inc);
    const now = this.clock.now();
    // A phone sending faster than the rule is throttled quietly (never an error mid-emergency).
    if ((await this.repo.countFixesSince(inc.id, new Date(now.getTime() - MIN_MS))) >= SAFETY_RULES.maxPositionsPerMin) return this.personView(inc);
    const rec = await this.uow.run(async (tx) => {
      await this.repo.addFix({ incidentId: inc.id, lat: input.position.lat, lng: input.position.lng, accuracyM: input.position.accuracyM, deviceAt: input.position.at, at: now }, tx);
      return this.repo.update(inc.id, { last: { lat: input.position.lat, lng: input.position.lng, accuracyM: input.position.accuracyM, deviceAt: input.position.at, at: now } }, tx);
    });
    await this.publish('sos.position');
    return this.personView(rec);
  }

  async setCategory(actor: Actor, input: SosCategoryInput): Promise<SosView> {
    const inc = await this.own(actor, input.incidentId);
    if (inc.category === input.category) return this.personView(inc);
    const now = this.clock.now();
    const rec = await this.uow.run(async (tx) => {
      await this.repo.addEntry({ incidentId: inc.id, kind: 'category', at: now, byId: null, note: null, data: { category: input.category } }, tx);
      return this.repo.update(inc.id, { category: input.category }, tx);
    });
    await this.publish('sos.category');
    return this.personView(rec);
  }

  /** The emergency contact's page: the person's first name and last fix while open; closed 30 min later. */
  async shared(input: SosSharedInput): Promise<SosShared> {
    const now = this.clock.now();
    const id = this.verify(input.token);
    const inc = id ? await this.repo.get(id) : null;
    if (!inc) throw new DriverError('share_link_invalid');
    const closedAt = inc.resolvedAt ?? inc.cancelledAt;
    const expired = closedAt !== null && now.getTime() - closedAt.getTime() > SAFETY_RULES.linkAfterCloseMin * MIN_MS;
    if (expired || inc.state === 'cancelled') return { status: 'expired', firstName: null, position: null, raisedAt: null, serverNow: now };
    const firstName = await this.cachedName(`link:${inc.id}`, inc.raiserId, () => this.identity.firstNamesFor([inc.raiserId], `sos_link:${inc.id}`, 'sos_link'));
    return {
      status: LIVE_STATES.includes(inc.state) ? 'live' : 'closed',
      firstName,
      position: inc.last ? { lat: inc.last.lat, lng: inc.last.lng, accuracyM: inc.last.accuracyM, at: inc.last.at, ageSec: Math.max(0, Math.round((now.getTime() - inc.last.at.getTime()) / 1000)) } : null,
      raisedAt: inc.raisedAt,
      serverNow: now,
    };
  }

  // ───────────────────────── the Console ─────────────────────────

  async list(actor: Actor, input: z.infer<typeof SafetyListInput>): Promise<SafetyIncidentSummary[]> {
    const rows = await this.repo.list({ states: input.scope === 'open' ? LIVE_STATES : undefined, limit: input.limit });
    const names = await this.displayNames(actor.personId, rows.map((r) => r.raiserId));
    const staff = await this.staff.of(rows.flatMap((r) => (r.acknowledgedById ? [r.acknowledgedById] : [])));
    const now = this.clock.now();
    return rows.map((r) => this.summary(r, { personId: r.raiserId, role: r.raiserRole, displayName: names[r.raiserId] ?? null, phoneMasked: null }, staff, now));
  }

  async get(actor: Actor, input: SafetyIncidentIdInput): Promise<SafetyIncidentCase> {
    const inc = await this.repo.get(input.id);
    if (!inc) throw new DriverError('sos_not_found');
    const now = this.clock.now();
    const people = [inc.raiserId, ...(inc.counterpartId ? [inc.counterpartId] : [])];
    // Name and masked number of both sides: one logged vault read each (reader: this staff member).
    const cards = await this.identity.memberCards(people, actor.personId, 'safety_incident');
    const card = (personId: string, role: SafetyPerson['role']): SafetyPerson => ({
      personId,
      role,
      displayName: cards[personId]?.name ? shortDisplayName(cards[personId]!.name!) || null : null,
      phoneMasked: cards[personId]?.phoneMasked ?? null,
    });
    const contact = inc.contactSet ? await this.identity.emergencyContactOf(inc.raiserId, actor.personId, 'safety_incident') : null;
    const entries = await this.repo.entries(inc.id);
    const fixes = await this.repo.fixes(inc.id);
    const staff = await this.staff.of([...entries.flatMap((e) => (e.byId ? [e.byId] : [])), ...(inc.acknowledgedById ? [inc.acknowledgedById] : [])]);
    const contactStatus = await this.contactStatus(actor, inc);
    const summary = this.summary(inc, card(inc.raiserId, inc.raiserRole), staff, now, contactStatus);
    return {
      ...summary,
      counterpart: inc.counterpartId ? card(inc.counterpartId, inc.raiserRole === 'driver' ? 'customer' : 'driver') : null,
      contact: { set: inc.contactSet, name: contact ? contactLabel(contact.name) : null, phoneMasked: contact ? maskPhone(contact.phoneE164) : null, status: contactStatus },
      trail: fixes.map(fixView),
      timeline: entries.map((e) => entryView(e, staff, inc)),
      outcome: inc.outcome,
      resolution: inc.resolution,
      shareUrl: inc.contactSet ? this.linkOf(inc.id) : null,
      serverNow: now,
    };
  }

  async acknowledge(actor: Actor, input: SafetyIncidentIdInput): Promise<SafetyIncidentCase> {
    const inc = await this.repo.get(input.id);
    if (!inc) throw new DriverError('sos_not_found');
    if (inc.state === 'resolved' || inc.state === 'cancelled') throw new DriverError('safety_incident_closed');
    if (inc.state === 'open') {
      const now = this.clock.now();
      await this.uow.run(async (tx) => {
        await this.repo.update(inc.id, { state: 'acknowledged', acknowledgedAt: now, acknowledgedById: actor.personId }, tx);
        await this.repo.addEntry({ incidentId: inc.id, kind: 'acknowledged', at: now, byId: actor.personId, note: null, data: { afterSec: String(Math.round((now.getTime() - inc.raisedAt.getTime()) / 1000)) } }, tx);
        await this.events.emit(tx, { type: 'sos.acknowledged', actorId: actor.personId, occurredAt: now, idempotencyKey: `sos:${inc.id}:acknowledged`, payload: { incidentId: inc.id, cityId: inc.cityId } }, { name: 'safety_incident', id: inc.id });
        await this.audits.record({ cityId: inc.cityId, actorId: actor.personId, action: 'safety.acknowledge', subjectKind: 'safety_incident', subjectId: inc.id, summaryAr: `استلم تنبيه طوارئ (${inc.subjectLabel})` }, tx);
      });
      await this.publish('sos.acknowledged');
    }
    return this.get(actor, input);
  }

  async note(actor: Actor, input: SafetyNoteInput): Promise<SafetyIncidentCase> {
    const inc = await this.repo.get(input.id);
    if (!inc) throw new DriverError('sos_not_found');
    await this.repo.addEntry({ incidentId: inc.id, kind: 'note', at: this.clock.now(), byId: actor.personId, note: input.note.trim(), data: {} });
    await this.publish('sos.note');
    return this.get(actor, input);
  }

  async resolve(actor: Actor, input: SafetyResolveInput): Promise<SafetyIncidentCase> {
    const inc = await this.repo.get(input.id);
    if (!inc) throw new DriverError('sos_not_found');
    if (inc.state === 'resolved' || inc.state === 'cancelled') throw new DriverError('safety_incident_closed');
    const now = this.clock.now();
    const note = input.note.trim();
    await this.uow.run(async (tx) => {
      await this.repo.update(inc.id, { state: 'resolved', resolvedAt: now, resolvedById: actor.personId, outcome: input.outcome, resolution: note, ...(inc.acknowledgedAt ? {} : { acknowledgedAt: now, acknowledgedById: actor.personId }) }, tx);
      await this.repo.addEntry({ incidentId: inc.id, kind: 'resolved', at: now, byId: actor.personId, note, data: { outcome: input.outcome } }, tx);
      await this.events.emit(tx, { type: 'sos.resolved', actorId: actor.personId, occurredAt: now, idempotencyKey: `sos:${inc.id}:resolved`, payload: { incidentId: inc.id, cityId: inc.cityId, outcome: input.outcome } }, { name: 'safety_incident', id: inc.id });
      await this.audits.record({ cityId: inc.cityId, actorId: actor.personId, action: 'safety.resolve', subjectKind: 'safety_incident', subjectId: inc.id, summaryAr: `سكّر تنبيه طوارئ: ${OUTCOME_AR[input.outcome]}`, detail: { outcome: input.outcome } }, tx);
    });
    await this.publish('sos.resolved');
    return this.get(actor, input);
  }

  async call(actor: Actor, input: SafetyCallInput): Promise<SafetyCallSession> {
    const inc = await this.repo.get(input.id);
    if (!inc) throw new DriverError('sos_not_found');
    const callee = input.who === 'raiser' ? inc.raiserId : input.who === 'counterpart' ? inc.counterpartId : inc.contactSet ? emergencyContactRecipient(inc.raiserId) : null;
    if (!callee) throw new DriverError(input.who === 'contact' ? 'safety_no_contact' : 'not_found');
    const now = this.clock.now();
    const session = await this.calls.open({ callId: `sc_${randomUUID().slice(0, 12)}`, orderId: inc.id, callerId: actor.personId, calleeId: callee }, now);
    await this.uow.run(async (tx) => {
      await this.repo.addEntry({ incidentId: inc.id, kind: 'call', at: now, byId: actor.personId, note: null, data: { who: input.who, mode: session.mode } }, tx);
      await this.audits.record({ cityId: inc.cityId, actorId: actor.personId, action: 'safety.call', subjectKind: 'safety_incident', subjectId: inc.id, summaryAr: 'اتصل من تنبيه طوارئ', detail: { who: input.who } }, tx);
    });
    await this.publish('sos.call');
    return { mode: session.mode, dial: session.dial, expiresAt: session.expiresAt };
  }

  // ───────────────────────── alerts: paging, the contact, escalation ─────────────────────────

  /** `safety:alerts`: every live dispatcher and admin (`sos.raised`), the admins again (`sos.escalated`). */
  private async page(e: PublishedEvent, tx: Tx): Promise<void> {
    const incidentId = typeof e.payload['incidentId'] === 'string' ? e.payload['incidentId'] : null;
    const inc = incidentId ? await this.repo.get(incidentId, tx) : null;
    if (!inc) return;
    const roles = e.type === 'sos.escalated' ? (['admin'] as const) : SAFETY_PAGED_ROLES;
    const roster = await this.identity.roster({ kinds: roles, limit: 200 });
    const to = roster.rows.filter((r) => !r.frozen && r.personId !== inc.raiserId).map((r) => r.personId);
    const name = (await this.identity.displayNamesFor([inc.raiserId], 'system:safety', 'sos_page'))[inc.raiserId]?.displayName ?? 'شخص';
    const params = { name, role: ROLE_AR[inc.raiserRole], what: inc.subjectLabel, link: `${this.config.consoleBase.replace(/\/$/, '')}/safety/${inc.id}`, incidentId: inc.id };
    for (const personId of to) {
      await this.notify.dispatch({ eventId: e.id, template: 'sos_dispatch_alert', to: personId, params, data: { incidentId: inc.id }, ...(inc.orderId ? { orderId: inc.orderId } : {}) }, tx);
    }
    if (e.type === 'sos.raised') await this.repo.addEntry({ incidentId: inc.id, kind: 'paged', at: this.clock.now(), byId: null, note: null, data: { count: String(to.length) } }, tx);
  }

  /** The emergency contact's WhatsApp, once, after the cancel window, while the incident is still live. */
  async notifyContact(incidentId: string): Promise<boolean> {
    const now = this.clock.now();
    const inc = await this.repo.get(incidentId);
    if (!inc || !inc.contactSet || inc.contactAt || !LIVE_STATES.includes(inc.state)) return false;
    if (now.getTime() < inc.cancelUntil.getTime()) return false;
    if (!(await this.repo.claim(inc.id, 'contactAt', now, LIVE_STATES))) return false;
    const name = (await this.identity.firstNamesFor([inc.raiserId], 'system:safety', 'sos_contact_message'))[inc.raiserId] ?? 'شخص من عائلتك';
    await this.uow.run(async (tx) => {
      await this.notify.dispatch({ eventId: inc.raiseEventId ?? `sos:${inc.id}`, template: 'sos_emergency_contact', to: emergencyContactRecipient(inc.raiserId), params: { name, link: this.linkOf(inc.id) }, data: { incidentId: inc.id } }, tx);
      await this.repo.addEntry({ incidentId: inc.id, kind: 'contact', at: now, byId: null, note: null, data: { status: 'queued' } }, tx);
    });
    await this.publish('sos.contact');
    return true;
  }

  /** Nobody took it within `ackWithinSec`: escalated once (Ali and the admins are paged again). */
  async escalate(incidentId: string): Promise<boolean> {
    const now = this.clock.now();
    const inc = await this.repo.get(incidentId);
    if (!inc || inc.state !== 'open' || inc.escalatedAt) return false;
    if (now.getTime() - inc.raisedAt.getTime() < SAFETY_RULES.ackWithinSec * 1000) return false;
    if (!(await this.repo.claim(inc.id, 'escalatedAt', now, ['open']))) return false;
    await this.uow.run(async (tx) => {
      await this.repo.addEntry({ incidentId: inc.id, kind: 'escalated', at: now, byId: null, note: null, data: {} }, tx);
      await this.events.emit(tx, { type: 'sos.escalated', actorId: 'system:safety', occurredAt: now, idempotencyKey: `sos:${inc.id}:escalated`, payload: { incidentId: inc.id, cityId: inc.cityId } }, { name: 'safety_incident', id: inc.id });
    });
    await this.publish('sos.escalated');
    return true;
  }

  /** Catches what a timer missed (a restart, another instance took the press): contact messages and escalations. */
  async sweep(): Promise<{ contacts: number; escalated: number }> {
    if (this.sweeping) return { contacts: 0, escalated: 0 };
    this.sweeping = true;
    try {
      let contacts = 0;
      let escalated = 0;
      for (const inc of await this.repo.list({ states: LIVE_STATES, limit: 200 })) {
        if (await this.notifyContact(inc.id)) contacts += 1;
        if (await this.escalate(inc.id)) escalated += 1;
      }
      return { contacts, escalated };
    } finally {
      this.sweeping = false;
    }
  }

  private schedule(inc: IncidentRecord): void {
    if (!this.config.timers) return;
    const now = this.clock.now().getTime();
    const later = (at: number, fn: () => Promise<unknown>) => {
      const t = setTimeout(
        () => {
          this.timers.delete(t);
          void fn().catch((err: unknown) => this.logger.error(`timer: ${(err as Error).message}`));
        },
        Math.max(0, at - now) + 250,
      );
      t.unref();
      this.timers.add(t);
    };
    if (inc.contactSet) later(inc.cancelUntil.getTime(), () => this.notifyContact(inc.id));
    later(inc.raisedAt.getTime() + SAFETY_RULES.ackWithinSec * 1000, () => this.escalate(inc.id));
  }

  // ───────────────────────── views ─────────────────────────

  private async own(actor: Actor, incidentId: string): Promise<IncidentRecord> {
    const inc = await this.repo.get(incidentId);
    if (!inc || inc.raiserId !== actor.personId) throw new DriverError('sos_not_found');
    return inc;
  }

  /** A repeated press (retry, or a second hold while one is open): record the fix, return the incident. */
  private async joinPress(inc: IncidentRecord, position: SosPosition | null, now: Date): Promise<SosView> {
    if (position && LIVE_STATES.includes(inc.state)) {
      const rec = await this.uow.run(async (tx) => {
        await this.repo.addFix({ incidentId: inc.id, lat: position.lat, lng: position.lng, accuracyM: position.accuracyM, deviceAt: position.at, at: now }, tx);
        return this.repo.update(inc.id, { last: { lat: position.lat, lng: position.lng, accuracyM: position.accuracyM, deviceAt: position.at, at: now } }, tx);
      });
      await this.publish('sos.position');
      return this.personView(rec);
    }
    return this.personView(inc);
  }

  private async personView(inc: IncidentRecord): Promise<SosView> {
    let contactName = this.contactNames.get(inc.id);
    if (contactName === undefined) {
      const c = inc.contactSet ? await this.identity.emergencyContactOf(inc.raiserId, inc.raiserId, 'sos_status') : null;
      contactName = c ? contactLabel(c.name) : null;
      this.contactNames.set(inc.id, contactName);
    }
    const ackBy = inc.acknowledgedById ? ((await this.staff.of([inc.acknowledgedById]))[inc.acknowledgedById] ?? null) : null;
    return {
      incidentId: inc.id,
      state: inc.state,
      raisedAt: inc.raisedAt,
      cancelUntil: inc.cancelUntil,
      acknowledgedAt: inc.acknowledgedAt,
      acknowledgedBy: ackBy,
      resolvedAt: inc.resolvedAt,
      contactName,
      contactStatus: !inc.contactSet ? 'none' : inc.contactAt ? 'sent' : 'queued',
      sharing: LIVE_STATES.includes(inc.state),
      category: inc.category,
      serverNow: this.clock.now(),
    };
  }

  private summary(inc: IncidentRecord, raiser: SafetyPerson, staff: Record<string, string | null>, now: Date, contactStatus?: SosContactStatus): SafetyIncidentSummary {
    return {
      id: inc.id,
      cityId: inc.cityId,
      state: inc.state,
      category: inc.category,
      raiser,
      subject: { kind: inc.subjectKind, id: inc.subjectId, label: inc.subjectLabel, orderId: inc.orderId, tripId: inc.tripId, vehicle: inc.vehicleLabel },
      raisedAt: inc.raisedAt,
      pressedAt: inc.pressedAt,
      lastPosition: inc.last ? fixView({ ...inc.last, id: '', incidentId: inc.id }) : null,
      acknowledgedAt: inc.acknowledgedAt,
      acknowledgedByName: inc.acknowledgedById ? (staff[inc.acknowledgedById] ?? null) : null,
      resolvedAt: inc.resolvedAt,
      overdue: inc.state === 'open' && now.getTime() - inc.raisedAt.getTime() >= SAFETY_RULES.ackWithinSec * 1000,
      escalatedAt: inc.escalatedAt,
      contactStatus: contactStatus ?? (!inc.contactSet ? 'none' : inc.contactAt ? 'sent' : 'queued'),
    };
  }

  /** What the providers told us about the emergency contact's message (the notify delivery log). */
  private async contactStatus(actor: Actor, inc: IncidentRecord): Promise<SosContactStatus> {
    if (!inc.contactSet) return 'none';
    if (!inc.contactAt) return 'queued';
    let rows: DeliveryLogRow[] = [];
    try {
      rows = (await this.notify.log(actor, { personId: emergencyContactRecipient(inc.raiserId), limit: 20 })).filter((r) => r.eventId === (inc.raiseEventId ?? `sos:${inc.id}`));
    } catch {
      return 'sent';
    }
    const wa = rows.find((r) => r.channel === 'whatsapp');
    const sms = rows.find((r) => r.channel === 'sms');
    if (wa && (wa.status === 'delivered' || wa.status === 'read')) return 'delivered';
    if (sms && (sms.status === 'sent' || sms.status === 'delivered')) return 'sms';
    if (rows.length > 0 && rows.every((r) => r.status === 'failed' || r.status === 'skipped')) return 'failed';
    if (wa && wa.status === 'sent') return 'sent';
    return 'queued';
  }

  private async displayNames(readerId: string, personIds: readonly string[]): Promise<Record<string, string | null>> {
    const now = this.clock.now().getTime();
    const out: Record<string, string | null> = {};
    const missing: string[] = [];
    for (const id of new Set(personIds)) {
      const hit = this.names.get(`${readerId}:${id}`);
      if (hit && now - hit.at < NAME_TTL_MS) out[id] = hit.name;
      else missing.push(id);
    }
    if (missing.length > 0) {
      const read = await this.identity.displayNamesFor(missing, readerId, 'safety_desk');
      for (const id of missing) {
        const name = read[id]?.displayName ?? null;
        this.names.set(`${readerId}:${id}`, { name, at: now });
        out[id] = name;
      }
    }
    return out;
  }

  private async cachedName(reader: string, personId: string, read: () => Promise<Record<string, string | null>>): Promise<string | null> {
    const key = `${reader}:${personId}`;
    const hit = this.names.get(key);
    const now = this.clock.now().getTime();
    if (hit && now - hit.at < NAME_TTL_MS) return hit.name;
    const name = (await read())[personId] ?? null;
    this.names.set(key, { name, at: now });
    return name;
  }

  /** Best-effort: the Console re-reads on its own slow poll anyway. */
  private async publish(cause: string): Promise<void> {
    try {
      await this.bus.publish(liveChannel.safety(), { type: 'invalidate', keys: ['safety.open'], cause });
    } catch (err) {
      this.logger.warn(`live publish ${cause}: ${(err as Error).message}`);
    }
  }

  // ───────────────────────── the contact's link ─────────────────────────

  linkOf(incidentId: string): string {
    return `${this.config.linkBase}${incidentId}.${this.sign(incidentId)}`;
  }

  private sign(id: string): string {
    return createHmac('sha256', this.config.secret).update(`sos:${id}`).digest('base64url').slice(0, 32);
  }

  private verify(token: string): string | null {
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const id = token.slice(0, dot);
    const want = Buffer.from(this.sign(id));
    const got = Buffer.from(token.slice(dot + 1));
    return want.length === got.length && timingSafeEqual(want, got) ? id : null;
  }
}

/** The emergency contact as the person saved them ("أم حيدر", "أبو علي"): a kunya is the whole name. */
function contactLabel(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function fixView(f: FixRecord): SafetyFix {
  return { lat: f.lat, lng: f.lng, accuracyM: f.accuracyM, deviceAt: f.deviceAt, at: f.at };
}

function entryView(e: EntryRecord, staff: Record<string, string | null>, inc: IncidentRecord): SafetyEntry {
  return { id: e.id, kind: e.kind, at: e.at, byName: e.byId && e.byId !== inc.raiserId ? (staff[e.byId] ?? null) : null, note: e.note, data: e.data };
}
