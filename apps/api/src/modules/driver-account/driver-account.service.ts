import { randomInt } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { formatClock, formatWhen } from '@driver/i18n';
import {
  AZIZIYAH_MONEY_RULES,
  DriverError,
  type Actor,
  type CheckInChallenge,
  type CheckInResult,
  type CheckInStatus,
  type DocumentsView,
  type DriverAccountPort,
  type DriverDocumentKind,
  type DriverDocumentStatus,
  type DriverDocumentView,
  type EarningsPeriod,
  type EarningsView,
  type GuaranteeView,
  type HandoverCode,
  type JobReceipt,
  type LivenessGesture,
  type MainPhotoState,
  type MainPhotoView,
  type OnlineGate,
  type PayQueryResult,
  type ReviewDocumentInput,
  type RoleKind,
  type ScorecardView,
  type SetMainPhotoInput,
  type ShiftSummary,
  type SubmitCheckInInput,
  type UploadDocumentInput,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { KeyedLock } from '../../shared/keyed-lock.js';
import { localDateKey, localPeriod, nextLocalSunday } from '../../shared/local-time.js';
import { ConfigService } from '../config/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { LedgerFacade } from '../ledger/index.js';
import { OrdersService } from '../orders/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { nudgesFor, OBSERVATION_DAYS, reliabilityCard } from '../scoring/index.js';
import { SupportService } from '../support/index.js';
import { TripsService } from '../trips/index.js';
import { DRIVER_ACCOUNT_REPOSITORY, type CheckInRecord, type DocumentRecord, type DriverAccountRepository } from './driver-account.repository.js';
import { composeEarnings } from './earnings.js';
import { HANDOVER_SECRET, HandoverCodes } from './handover-code.js';
import { composeReceipt, receiptNote, type ReceiptContext } from './receipt.js';
import { bestHour, busiestWindow, clampShift, perHour, tomorrowAndLastWeek } from './shift.js';

const DAY_MS = 86_400_000;
/** Single-city launch: the city the shift summary and receipts read their rules and orders from. */
const SHIFT_CITY = 'aziziyah';
/** A job's ledger lines sit within hours of its first line; the receipt reads this far either side. */
const RECEIPT_WINDOW_MS = 12 * 3_600_000;
/** Scoring §2: expiry reminders at 30 days. */
export const EXPIRY_WARNING_DAYS = 30;
const CHALLENGE_TTL_MS = 2 * 60_000;
/** Scoring §2: two failures → offline + ops alert. */
export const MAX_CHECKIN_FAILURES = 2;
const MIN_LIVENESS = 0.5;

export const DRIVING_ROLES: readonly RoleKind[] = ['courier', 'shopper', 'driver', 'intercity_driver', 'khat_driver'];
/** Roles whose vehicle needs a licence and registration on file (cars, vans; not bikes / tuktuks). */
const CAR_ROLES: readonly RoleKind[] = ['driver', 'intercity_driver', 'khat_driver'];
const BACK_OFFICE: readonly RoleKind[] = ['finance', 'admin', 'dispatcher', 'support', 'field_ops'];

export const DOCUMENT_KIND_AR: Record<DriverDocumentKind, string> = {
  national_id_front: 'البطاقة الوطنية (الوجه)',
  national_id_back: 'البطاقة الوطنية (الظهر)',
  licence: 'إجازة السوق',
  vehicle_registration: 'سنوية المركبة',
  insurance: 'التأمين',
  photo: 'صورة شخصية',
};

const STATUS_AR: Record<DriverDocumentStatus, string> = {
  pending: 'دا نراجعه',
  approved: 'مقبول',
  rejected: 'مرفوض',
  expiring: 'ينتهي قريباً',
  expired: 'منتهي',
};

const GESTURE_AR: Record<LivenessGesture, string> = {
  blink: 'غمّض عيونك مرتين',
  turn_left: 'لف راسك لليسار',
  turn_right: 'لف راسك لليمين',
  smile: 'ابتسم',
  nod: 'هز راسك لفوگ وجوه',
};
const GESTURES = Object.keys(GESTURE_AR) as LivenessGesture[];

/** Derived status: approved documents expiring within 30 days read `expiring`; past expiry `expired`. */
export function documentStatus(d: Pick<DocumentRecord, 'status' | 'expiresAt'>, now: Date): DriverDocumentStatus {
  if (d.status !== 'approved' || !d.expiresAt) return d.status;
  if (d.expiresAt.getTime() <= now.getTime()) return 'expired';
  if (d.expiresAt.getTime() - now.getTime() <= EXPIRY_WARNING_DAYS * DAY_MS) return 'expiring';
  return 'approved';
}

export function documentView(d: DocumentRecord, now: Date): DriverDocumentView {
  const status = documentStatus(d, now);
  return {
    id: d.id,
    kind: d.kind,
    kind_ar: DOCUMENT_KIND_AR[d.kind],
    status,
    status_ar: STATUS_AR[status],
    expiresAt: d.expiresAt,
    daysToExpiry: d.expiresAt ? Math.ceil((d.expiresAt.getTime() - now.getTime()) / DAY_MS) : null,
    submittedAt: d.submittedAt,
    reviewedAt: d.reviewedAt,
    rejectReason: d.rejectReason,
  };
}

/**
 * The main photo's state machine (Ali, 2026-10-06), from his latest `photo` document: none → pending
 * (sent) → approved | rejected; a new photo starts pending again while the previous approved one
 * stays what customers see.
 */
export function mainPhotoState(latest: Pick<DocumentRecord, 'status'> | null | undefined): MainPhotoState {
  if (!latest) return 'none';
  return latest.status;
}

/** Worst first: what a fleet owner or the gate should look at. */
const SEVERITY: Record<DriverDocumentStatus, number> = { expired: 4, rejected: 3, expiring: 2, pending: 1, approved: 0 };
export function worstStatus(statuses: readonly DriverDocumentStatus[]): DriverDocumentStatus | null {
  return statuses.reduce<DriverDocumentStatus | null>((w, s) => (w === null || SEVERITY[s] > SEVERITY[w] ? s : w), null);
}

/**
 * `driverAccount.*` (Partner wave 2). Money from the ledger's public facade, scorecard from events +
 * trips + order ratings (scoring's pure card), documents and check-ins in this module's tables with
 * the photo refs in the identity vault. Writes run in one unit of work with their outbox events.
 */
@Injectable()
export class DriverAccountService implements DriverAccountPort {
  private readonly codes: HandoverCodes;
  private readonly checkInLock = new KeyedLock();

  constructor(
    @Inject(DRIVER_ACCOUNT_REPOSITORY) private readonly repo: DriverAccountRepository,
    private readonly ledger: LedgerFacade,
    private readonly events: EventsService,
    private readonly trips: TripsService,
    private readonly orders: OrdersService,
    private readonly identity: IdentityService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(HANDOVER_SECRET) secret: string,
    /** "عندي اعتراض" opens its ticket here (Partner S-7); absent in unit tests that don't need it. */
    @Optional() private readonly support?: SupportService,
    /** The city's pricing rules, for the night / wait reasons on a receipt. */
    @Optional() private readonly config?: ConfigService,
  ) {
    this.codes = new HandoverCodes(secret);
  }

  // ───────────────────────── access ─────────────────────────

  private async any(personId: string, kinds: readonly RoleKind[]): Promise<boolean> {
    for (const k of kinds) if (await this.identity.hasRole(personId, k)) return true;
    return false;
  }

  /** Self, or back office (fleet owners read their drivers through `fleet.*`). */
  private async subject(actor: Actor, driverId: string | undefined): Promise<string> {
    const id = driverId ?? actor.personId;
    if (id !== actor.personId && !(await this.any(actor.personId, BACK_OFFICE))) throw new DriverError('forbidden');
    return id;
  }

  // ───────────────────────── earnings ─────────────────────────

  async earnings(actor: Actor, input: { period: EarningsPeriod; anchor?: Date | undefined; driverId?: string | undefined }): Promise<EarningsView> {
    return this.earningsFor(await this.subject(actor, input.driverId), input.period, input.anchor);
  }

  /**
   * Public read for fleet owners' dashboards (the fleet module checks membership). `notBefore` clips
   * the period to when he joined the reader's fleet: what he earned before is not the owner's.
   */
  async earningsFor(driverId: string, period: EarningsPeriod, anchor?: Date, opts: { notBefore?: Date | undefined } = {}): Promise<EarningsView> {
    const range = localPeriod(period, anchor ?? this.clock.now());
    const from = opts.notBefore && opts.notBefore > range.from ? (opts.notBefore < range.to ? opts.notBefore : range.to) : range.from;
    const view = await this.ledger.driverLedger({ driverId, from, to: range.to });
    return composeEarnings(view, period, { from, to: range.to }, AZIZIYAH_MONEY_RULES);
  }

  // ───────────────────────── G-91 shift guarantee ─────────────────────────

  /**
   * The shift now and this week's, counted on the server from his events and ledger (the
   * Partner app's progress line and pending/paid lines show exactly these numbers). Top-ups that
   * ended last week and wait for the Sunday run count in `pendingIqd` too.
   */
  async guarantee(actor: Actor): Promise<GuaranteeView> {
    return this.guaranteeFor(actor.personId);
  }

  async guaranteeFor(driverId: string): Promise<GuaranteeView> {
    const g = AZIZIYAH_MONEY_RULES.guarantee;
    const rule = { amountIqd: g.amountIqd, minAcceptance: g.minAcceptance, maxCancelsAfterAccept: g.maxCancelsAfterAccept, minCompletedJobs: g.minCompletedJobs };
    if (!(await this.ledger.guaranteeCovers(driverId))) return { enabled: false, ...rule, current: null, week: [], pendingIqd: 0 };
    const now = this.clock.now();
    const week = localPeriod('week', now);
    const lastWeek = new Date(week.from.getTime() - 7 * DAY_MS);
    const windows = await this.ledger.guaranteeWindows({ driverId, from: lastWeek, to: week.to });
    return {
      enabled: true,
      ...rule,
      // At 00:30 the live shift is yesterday's 15:00–02:00 (a Saturday's runs into the new week).
      current: windows.find((w) => w.status === 'live') ?? null,
      week: windows.filter((w) => w.from.getTime() >= week.from.getTime()).reverse(),
      // What the next Sunday run pays: shifts that started since last week's Sunday (not the one still running into it).
      pendingIqd: windows.filter((w) => w.status === 'ended' && w.qualified && w.from.getTime() >= lastWeek.getTime()).reduce((sum, w) => sum + w.topUpIqd, 0),
    };
  }

  // ───────────────────────── scorecard ─────────────────────────

  async scorecard(actor: Actor, input: { driverId?: string | undefined }): Promise<ScorecardView> {
    const driverId = await this.subject(actor, input.driverId);
    const backOffice = driverId !== actor.personId || (await this.any(actor.personId, BACK_OFFICE));
    return this.scorecardFor(driverId, backOffice);
  }

  async scorecardFor(driverId: string, backOffice = false): Promise<ScorecardView> {
    const now = this.clock.now();
    const [events, trips, cash] = await Promise.all([
      this.events.forActor(driverId),
      this.trips.forDriver(driverId),
      this.ledger.driverLedger({ driverId, from: new Date(now.getTime() - 15 * DAY_MS) }).then((v) => v.cash.lines),
    ]);
    const firstActiveAt = events.length > 0 ? new Date(Math.min(...events.map((e) => e.occurredAt.getTime()))) : now;
    const dayNumber = Math.floor((now.getTime() - firstActiveAt.getTime()) / DAY_MS) + 1;
    const visibleFrom = new Date(firstActiveAt.getTime() + OBSERVATION_DAYS * DAY_MS);
    const observation = dayNumber <= OBSERVATION_DAYS;
    const ratings = await this.deliveryRatings(trips);
    const card = reliabilityCard(
      {
        events,
        trips: trips.map((t) => ({ state: t.state, acceptedAt: t.acceptedAt, stops: t.stops.map((s) => ({ windowEnd: s.windowEnd, arrivedAt: s.arrivedAt })) })),
        ratings,
        cash: cash.map((l) => ({ amountIqd: l.amountIqd, at: l.occurredAt })),
      },
      now,
    );
    const show = !observation || backOffice;
    const nudges = observation ? [] : nudgesFor(card.metrics);
    return {
      driverId,
      dayNumber,
      visibleFrom,
      visible: !observation,
      observation,
      learningMessage_ar: observation ? `فترة تعلّم: نتابع أداءك أول ${OBSERVATION_DAYS} يوم بدون أي إجراء. البطاقة تبين من يوم ${OBSERVATION_DAYS + 1}.` : null,
      index: show ? card.index : null,
      tier: show ? (observation ? 'bronze' : card.tier) : null,
      completedTrips: card.completedTrips,
      windowDays: 14,
      metrics: show ? card.metrics : [],
      nudges,
      // Scoring §1: consequences the following Sunday, never the same day; none in month 1.
      consequencesFrom: !observation && nudges.length > 0 ? nextLocalSunday(now) : null,
    };
  }

  /** Delivery scores customers gave on his trips' orders, newest trips first, enough for the last 50. */
  private async deliveryRatings(trips: Awaited<ReturnType<TripsService['forDriver']>>): Promise<Array<{ score: number; at: Date }>> {
    const out: Array<{ score: number; at: Date }> = [];
    const ordered = [...trips].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
    for (const t of ordered) {
      if (out.length >= 50) break;
      if (t.state !== 'completed') continue;
      for (const link of t.orders) {
        try {
          const order = await this.orders.get(link.orderId);
          const score = order.rating?.delivery;
          if (score) out.push({ score, at: order.rating!.ratedAt });
        } catch {
          // an order the orders module no longer knows contributes nothing
        }
      }
    }
    return out;
  }

  // ───────────────────────── documents ─────────────────────────

  async documents(actor: Actor, input: { driverId?: string | undefined }): Promise<DocumentsView> {
    return this.documentsFor(await this.subject(actor, input.driverId));
  }

  async documentsFor(driverId: string): Promise<DocumentsView> {
    const now = this.clock.now();
    const current = await this.repo.currentDocuments([driverId]);
    const docs = latestPerKind(current);
    const roles = await this.identity.activeRoles(driverId);
    const required: DriverDocumentKind[] = ['national_id_front', 'national_id_back', 'photo'];
    if (roles.some((r) => CAR_ROLES.includes(r))) required.push('licence', 'vehicle_registration');
    const views = docs.map((d) => documentView(d, now));
    return {
      driverId,
      documents: views,
      missing: required.filter((k) => !docs.some((d) => d.kind === k)),
      // An approved document stays current until its renewal is approved, so a pending upload never
      // lifts an expiry (review 2026-10-04 #18).
      blocksOnline: expiredDocuments(current, now).length > 0,
    };
  }

  /** Current documents of many drivers (fleet dashboard), latest per kind each. */
  async documentsOf(driverIds: readonly string[]): Promise<Map<string, DriverDocumentView[]>> {
    const now = this.clock.now();
    const out = new Map<string, DriverDocumentView[]>();
    const all = await this.repo.currentDocuments(driverIds);
    for (const id of driverIds) out.set(id, latestPerKind(all.filter((d) => d.personId === id)).map((d) => documentView(d, now)));
    return out;
  }

  /** Documents waiting for review, oldest first, with the stored record (Console approvals queue). */
  async pendingDocuments(limit = 200): Promise<DocumentRecord[]> {
    return this.repo.pendingDocuments(limit);
  }

  /** One document as stored (approvals queue side-by-side view); null when unknown. */
  document(documentId: string): Promise<DocumentRecord | null> {
    return this.repo.document(documentId);
  }

  async uploadDocument(actor: Actor, input: UploadDocumentInput): Promise<DriverDocumentView> {
    await this.assertUpload(actor.personId, input.uploadId);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      // A new upload replaces earlier pending/rejected ones; an approved document stays in force until
      // the renewal is approved (else any photo would lift an expiry — review 2026-10-04 #18).
      const previous = (await this.repo.currentDocuments([actor.personId], tx)).filter((d) => d.kind === input.kind && d.status !== 'approved');
      for (const p of previous) await this.repo.updateDocument(p.id, { supersededAt: now }, tx);
      const doc = await this.repo.createDocument(
        { personId: actor.personId, kind: input.kind, status: 'pending', expiresAt: input.expiresAt ?? null, submittedAt: now, reviewedAt: null, reviewedById: null, rejectReason: null, supersededAt: null },
        tx,
      );
      await this.identity.attachVaultRef(actor.personId, 'documentRefs', { ref: input.uploadId, kind: input.kind, recordId: doc.id });
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'driver.document_submitted', occurredAt: now, payload: { documentId: doc.id, kind: doc.kind, expiresAt: doc.expiresAt?.toISOString() ?? null } },
        { name: 'person', id: actor.personId },
      );
      return documentView(doc, now);
    });
  }

  async reviewDocument(actor: Actor, input: ReviewDocumentInput): Promise<DriverDocumentView> {
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const doc = await this.repo.document(input.documentId, tx);
      if (!doc) throw new DriverError('document_not_found');
      // Separation of duties: a reviewer who also drives never decides on his own papers.
      if (doc.personId === actor.personId) throw new DriverError('forbidden');
      const approve = input.decision === 'approve';
      if (approve) {
        // The approved renewal takes over: older documents of the kind leave the current set.
        const older = (await this.repo.currentDocuments([doc.personId], tx)).filter((d) => d.kind === doc.kind && d.id !== doc.id && d.submittedAt.getTime() <= doc.submittedAt.getTime());
        for (const o of older) await this.repo.updateDocument(o.id, { supersededAt: now }, tx);
      }
      if (approve && doc.kind === 'photo') {
        // Ali, 2026-10-06: the approved photo becomes the main photo customers see.
        await this.identity.promoteMainPhoto(doc.personId, doc.id);
      }
      const updated = await this.repo.updateDocument(
        doc.id,
        {
          status: approve ? 'approved' : 'rejected',
          reviewedAt: now,
          reviewedById: actor.personId,
          rejectReason: approve ? null : (input.reason ?? null),
          ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        },
        tx,
      );
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'driver.document_reviewed', occurredAt: now, payload: { documentId: doc.id, personId: doc.personId, kind: doc.kind, decision: input.decision } },
        { name: 'person', id: doc.personId },
      );
      return documentView(updated, now);
    });
  }

  // ───────────────────────── main photo (Ali, 2026-10-06) ─────────────────────────

  /** His main photo: what customers see now and where his latest one stands. */
  async mainPhoto(actor: Actor): Promise<MainPhotoView> {
    const [docs, refs] = await Promise.all([this.repo.currentDocuments([actor.personId]), this.identity.ownPhotoRefs(actor.personId)]);
    const latest = latestPerKind(docs).find((d) => d.kind === 'photo') ?? null;
    const latestRef = latest ? refs.byDocument[latest.id] : undefined;
    return {
      state: mainPhotoState(latest),
      approved: refs.mainRef ? { url: this.blobs.readUrl(refs.mainRef), approvedAt: refs.mainAt } : null,
      latest: latest
        ? {
            documentId: latest.id,
            status: latest.status,
            url: latestRef ? this.blobs.readUrl(latestRef) : null,
            submittedAt: latest.submittedAt,
            reviewedAt: latest.reviewedAt,
            rejectReason: latest.rejectReason,
          }
        : null,
    };
  }

  /** A new main photo: a `photo` document for the approvals queue (replaces a pending or rejected one). */
  async setMainPhoto(actor: Actor, input: SetMainPhotoInput): Promise<MainPhotoView> {
    await this.uploadDocument(actor, { kind: 'photo', uploadId: input.uploadId });
    return this.mainPhoto(actor);
  }

  private async assertUpload(ownerId: string, uploadId: string): Promise<void> {
    const blob = await this.blobs.get(uploadId);
    if (!blob || blob.ownerId !== ownerId || blob.state !== 'stored') throw new DriverError('upload_invalid');
  }

  // ───────────────────────── daily check-in ─────────────────────────

  async checkInChallenge(actor: Actor): Promise<CheckInChallenge> {
    const now = this.clock.now();
    const status = await this.checkInStatusFor(actor.personId);
    if (status.lockedOut) throw new DriverError('checkin_locked');
    const gesture = GESTURES[randomInt(GESTURES.length)]!;
    const row = await this.repo.createCheckIn({
      personId: actor.personId,
      localDate: localDateKey(now),
      gesture,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      result: 'pending',
      submittedAt: null,
      livenessScore: null,
      failureReason: null,
    });
    return { challengeId: row.id, gesture, gesture_ar: GESTURE_AR[gesture], expiresAt: row.expiresAt };
  }

  /**
   * Liveness stub: passes when the selfie is stored, the challenge is the caller's and unexpired, and
   * the device SDK's score (default 1) is ≥ 0.5. Face match against the reference selfie is the
   * Console's (ops review) until a matcher lands. Second failure of the day locks him out + ops alert.
   */
  submitCheckIn(actor: Actor, input: SubmitCheckInInput): Promise<CheckInResult> {
    // One submission at a time per person: parallel selfies must not all pass the lock-out check
    // before any failure is recorded (review 2026-10-04 #17).
    return this.checkInLock.run(actor.personId, () => this.submitCheckInNow(actor, input));
  }

  private async submitCheckInNow(actor: Actor, input: SubmitCheckInInput): Promise<CheckInResult> {
    const now = this.clock.now();
    const row = await this.repo.checkIn(input.challengeId);
    if (!row || row.personId !== actor.personId || row.result !== 'pending' || row.expiresAt.getTime() < now.getTime()) throw new DriverError('checkin_challenge_invalid');
    const before = await this.checkInStatusFor(actor.personId);
    if (before.lockedOut) throw new DriverError('checkin_locked');
    const blob = await this.blobs.get(input.uploadId);
    const stored = Boolean(blob && blob.ownerId === actor.personId && blob.state === 'stored');
    const score = input.livenessScore ?? 1;
    const reason = !stored ? 'selfie_missing' : score < MIN_LIVENESS ? 'liveness_low' : null;
    const result: 'passed' | 'failed' = reason ? 'failed' : 'passed';
    await this.uow.run(async (tx) => {
      await this.repo.updateCheckIn(row.id, { result, submittedAt: now, livenessScore: score, failureReason: reason }, tx);
      if (stored) await this.identity.attachVaultRef(actor.personId, 'selfieRefs', { ref: input.uploadId, kind: 'daily_checkin', recordId: row.id });
      const failures = before.failuresToday + (result === 'failed' ? 1 : 0);
      await this.events.emit(
        tx,
        {
          actorId: actor.personId,
          type: result === 'passed' ? 'driver.checkin_selfie' : 'driver.checkin_failed',
          occurredAt: now,
          payload: { checkInId: row.id, gesture: row.gesture, livenessScore: score, reason, failuresToday: failures, opsAlert: failures >= MAX_CHECKIN_FAILURES },
          idempotencyKey: `checkin:${row.id}`,
        },
        { name: 'person', id: actor.personId },
      );
      await this.afterCheckIn(tx, actor.personId, failures, now);
    });
    const status = await this.checkInStatusFor(actor.personId);
    return { ...status, checkInId: row.id, result, reason };
  }

  private async afterCheckIn(tx: Tx, personId: string, failures: number, now: Date): Promise<void> {
    if (failures !== MAX_CHECKIN_FAILURES) return;
    // Scoring §2: two failures → offline + ops alert (dispatch and the Console subscribe to this).
    await this.events.emit(
      tx,
      { actorId: personId, type: 'driver.checkin_locked', occurredAt: now, payload: { personId, localDate: localDateKey(now), failures }, idempotencyKey: `checkin_locked:${personId}:${localDateKey(now)}` },
      { name: 'person', id: personId },
    );
  }

  checkInStatus(actor: Actor): Promise<CheckInStatus> {
    return this.checkInStatusFor(actor.personId);
  }

  async checkInStatusFor(personId: string): Promise<CheckInStatus> {
    const now = this.clock.now();
    const localDate = localDateKey(now);
    const rows: CheckInRecord[] = await this.repo.checkInsOn(personId, localDate);
    // In submission order: a pass only counts if it came before the second failure (two strikes).
    const done = rows.filter((r) => r.result !== 'pending').sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0));
    let strikes = 0;
    let firstPass: CheckInRecord | undefined;
    for (const r of done) {
      if (r.result === 'failed') strikes += 1;
      else if (r.result === 'passed' && !firstPass && strikes < MAX_CHECKIN_FAILURES) firstPass = r;
    }
    const passed = firstPass ? [firstPass] : [];
    const failures = rows.filter((r) => r.result === 'failed').length;
    const verified = passed.length > 0;
    const roles = await this.identity.activeRoles(personId);
    return {
      localDate,
      required: roles.some((r) => DRIVING_ROLES.includes(r)),
      verifiedToday: verified,
      verifiedAt: passed[0]?.submittedAt ?? null,
      failuresToday: failures,
      lockedOut: !verified && failures >= MAX_CHECKIN_FAILURES,
      badge_ar: verified ? 'متحقق اليوم' : null,
    };
  }

  // ───────────────────────── gate, hand-over code ─────────────────────────

  onlineGate(actor: Actor): Promise<OnlineGate> {
    return this.onlineGateFor(actor.personId);
  }

  /** What the Partner shell (and `partner` presence) checks before going online. */
  async onlineGateFor(personId: string): Promise<OnlineGate> {
    const [checkIn, current] = await Promise.all([this.checkInStatusFor(personId), this.repo.currentDocuments([personId])]);
    const reasons: OnlineGate['reasons'] = [];
    if (checkIn.lockedOut) reasons.push({ code: 'checkin_locked', message_ar: 'فشل التحقق مرتين اليوم. فريق العمليات راح يتواصل وياك' });
    else if (checkIn.required && !checkIn.verifiedToday) reasons.push({ code: 'checkin_required', message_ar: 'سوّي التحقق اليومي بالسيلفي قبل ما تشتغل' });
    for (const d of expiredDocuments(current, this.clock.now())) reasons.push({ code: 'document_expired', message_ar: `${DOCUMENT_KIND_AR[d.kind]} منتهية. جدّدها حتى تشتغل` });
    return { canGoOnline: reasons.length === 0, reasons, checkIn };
  }

  async handoverCode(actor: Actor): Promise<HandoverCode> {
    return this.codes.code(actor.personId, this.clock.now());
  }

  // ───────────────────────── end of shift (Partner audit S-4) ─────────────────────────

  /**
   * The shift he just ended, from the ledger: jobs, net, tips, per online hour, the clock hour that
   * paid most, the day so far, cash to hand over against his cap, one scorecard nudge at most, and
   * tomorrow's busiest two hours from the city's orders on the same weekday last week.
   */
  async shiftSummary(actor: Actor, input: { from?: Date | undefined; to?: Date | undefined }): Promise<ShiftSummary> {
    const driverId = actor.personId;
    const now = this.clock.now();
    const { from, to } = clampShift(input, now);
    const day = localPeriod('day', to);
    // Ledger reads are [from, to): one minute past `to` keeps a job posted in the same instant.
    const until = new Date(to.getTime() + 60_000);
    const [shiftView, dayView, card, tomorrow, guarantee] = await Promise.all([
      this.ledger.driverLedger({ driverId, from, to: until }),
      this.ledger.driverLedger({ driverId, from: day.from, to: until }),
      this.scorecardFor(driverId).catch(() => null),
      this.busiestTomorrow(now),
      this.shiftGuarantees(driverId, from, until),
    ]);
    const shift = composeEarnings(shiftView, 'day', { from, to }, AZIZIYAH_MONEY_RULES);
    const today = composeEarnings(dayView, 'day', { from: day.from, to }, AZIZIYAH_MONEY_RULES);
    const onlineMinutes = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
    return {
      driverId,
      from,
      to,
      onlineMinutes,
      jobs: shift.totals.jobs,
      netIqd: shift.totals.netIqd,
      tipsIqd: shift.totals.tipsIqd,
      perHourIqd: perHour(shift.totals.netIqd, onlineMinutes),
      bestHour: bestHour(shift.jobs),
      day: { netIqd: today.totals.netIqd, jobs: today.totals.jobs },
      cash: { heldIqd: today.cash.heldIqd, owedIqd: today.cap.owedIqd, capIqd: today.cap.capIqd, overCap: today.cap.overCap },
      tomorrow,
      // Shift-end carries a single nudge, never a list (audit S-4); none in the first 30 days.
      nudge: card && card.visible && !card.observation ? (card.nudges[0] ?? null) : null,
      guarantee,
    };
  }

  /** G-91: the guarantee shifts his work shift overlapped (none when the guarantee does not cover him). */
  private async shiftGuarantees(driverId: string, from: Date, to: Date): Promise<ShiftSummary['guarantee']> {
    if (!(await this.ledger.guaranteeCovers(driverId))) return [];
    return this.ledger.guaranteeWindows({ driverId, from, to });
  }

  private async busiestTomorrow(now: Date): Promise<ShiftSummary['tomorrow']> {
    const { tomorrow, lastWeekFrom, lastWeekTo } = tomorrowAndLastWeek(now);
    try {
      const counts = await this.orders.placedPerHour(SHIFT_CITY, lastWeekFrom, lastWeekTo);
      return busiestWindow(counts, tomorrow);
    } catch {
      return null;
    }
  }

  // ───────────────────────── "why was I paid this" (Partner audit S-7) ─────────────────────────

  /** One of his jobs with every pay line and its reason, the take rate and where the cash went. */
  async jobReceipt(actor: Actor, input: { key: string; at: Date }): Promise<JobReceipt> {
    const receipt = await this.receiptFor(actor.personId, input.key, input.at);
    if (!receipt) throw new DriverError('not_found');
    return receipt;
  }

  private async receiptFor(driverId: string, key: string, at: Date): Promise<JobReceipt | null> {
    const view = await this.ledger.driverLedger({ driverId, from: new Date(at.getTime() - RECEIPT_WINDOW_MS), to: new Date(at.getTime() + RECEIPT_WINDOW_MS) });
    const queryOpen = this.support ? await this.support.driverPayQueryOpen(driverId, key) : false;
    return composeReceipt(view, key, this.receiptContext(), { queryOpen });
  }

  /** Night start and the wait step from the city's pricing rules (the same numbers the quote used). */
  private receiptContext(): ReceiptContext {
    const city = this.config?.city(SHIFT_CITY);
    const rules = city?.verticals.flatMap((v) => v.components) ?? [];
    const night = rules.find((c) => c.key === 'night' && c.hours)?.hours?.[0] ?? 23;
    const wait = rules.find((c) => c.key === 'wait' && c.perUnit)?.perUnit ?? 250;
    return { nightFrom: formatClock(Date.UTC(2026, 0, 1, night - 3, 0), { period: false }), waitAmountIqd: wait };
  }

  /**
   * "عندي اعتراض": a support ticket with the job attached — the order (when it is a real order) and
   * trip, and the receipt as the opening note under his own words. One per job.
   */
  async payQuery(actor: Actor, input: { key: string; at: Date; message: string }): Promise<PayQueryResult> {
    if (!this.support) throw new DriverError('internal');
    const receipt = await this.receiptFor(actor.personId, input.key, input.at);
    if (!receipt) throw new DriverError('not_found');
    const ticket = receipt.ticket ? `#${receipt.ticket}` : `(${input.key.slice(-6)})`;
    const when = formatWhen(receipt.at, this.clock.now());
    return this.support.openDriverPayQuery(actor.personId, {
      key: input.key,
      orderId: receipt.orderId,
      tripId: receipt.tripId,
      subject: `اعتراض سايق على أجرة الطلب ${ticket}`,
      note: `${input.message}\n\nالطلب ${ticket} · ${when}\n${receiptNote(receipt)}`,
    });
  }

  /** Field ops' check of the code a courier reads out (`ops.recordCashReceipt`). */
  verifyHandoverCode(driverId: string, code: string): boolean {
    return this.codes.verify(driverId, code, this.clock.now());
  }
}

/** Current documents past their expiry, one per kind (an expired approved one blocks until its renewal is approved). */
function expiredDocuments(current: readonly DocumentRecord[], now: Date): DocumentRecord[] {
  const byKind = new Map<string, DocumentRecord>();
  for (const d of current) if (documentStatus(d, now) === 'expired' && !byKind.has(d.kind)) byKind.set(d.kind, d);
  return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

function latestPerKind(docs: readonly DocumentRecord[]): DocumentRecord[] {
  const byKind = new Map<string, DocumentRecord>();
  for (const d of docs) {
    const cur = byKind.get(d.kind);
    if (!cur || d.submittedAt.getTime() >= cur.submittedAt.getTime()) byKind.set(d.kind, d);
  }
  return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}
