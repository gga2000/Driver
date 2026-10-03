import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
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
  type HandoverCode,
  type LivenessGesture,
  type OnlineGate,
  type ReviewDocumentInput,
  type RoleKind,
  type ScorecardView,
  type SubmitCheckInInput,
  type UploadDocumentInput,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { localDateKey, localPeriod, nextLocalSunday } from '../../shared/local-time.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { LedgerFacade } from '../ledger/index.js';
import { OrdersService } from '../orders/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { nudgesFor, OBSERVATION_DAYS, reliabilityCard } from '../scoring/index.js';
import { TripsService } from '../trips/index.js';
import { DRIVER_ACCOUNT_REPOSITORY, type CheckInRecord, type DocumentRecord, type DriverAccountRepository } from './driver-account.repository.js';
import { composeEarnings } from './earnings.js';
import { HANDOVER_SECRET, HandoverCodes } from './handover-code.js';

const DAY_MS = 86_400_000;
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
  pending: 'قيد المراجعة',
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

  /** Public read for fleet owners' dashboards (the fleet module checks membership). */
  async earningsFor(driverId: string, period: EarningsPeriod, anchor?: Date): Promise<EarningsView> {
    const range = localPeriod(period, anchor ?? this.clock.now());
    const view = await this.ledger.driverLedger({ driverId, from: range.from, to: range.to });
    return composeEarnings(view, period, range, AZIZIYAH_MONEY_RULES);
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
    const docs = latestPerKind(await this.repo.currentDocuments([driverId]));
    const roles = await this.identity.activeRoles(driverId);
    const required: DriverDocumentKind[] = ['national_id_front', 'national_id_back', 'photo'];
    if (roles.some((r) => CAR_ROLES.includes(r))) required.push('licence', 'vehicle_registration');
    const views = docs.map((d) => documentView(d, now));
    return {
      driverId,
      documents: views,
      missing: required.filter((k) => !docs.some((d) => d.kind === k)),
      blocksOnline: views.some((v) => v.status === 'expired'),
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

  async uploadDocument(actor: Actor, input: UploadDocumentInput): Promise<DriverDocumentView> {
    await this.assertUpload(actor.personId, input.uploadId);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const previous = (await this.repo.currentDocuments([actor.personId], tx)).filter((d) => d.kind === input.kind);
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
  async submitCheckIn(actor: Actor, input: SubmitCheckInInput): Promise<CheckInResult> {
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
    const passed = rows.filter((r) => r.result === 'passed').sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0));
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
    const [checkIn, docs] = await Promise.all([this.checkInStatusFor(personId), this.documentsFor(personId)]);
    const reasons: OnlineGate['reasons'] = [];
    if (checkIn.lockedOut) reasons.push({ code: 'checkin_locked', message_ar: 'فشل التحقق مرتين اليوم. فريق العمليات راح يتواصل وياك' });
    else if (checkIn.required && !checkIn.verifiedToday) reasons.push({ code: 'checkin_required', message_ar: 'سوّي التحقق اليومي بالسيلفي قبل ما تشتغل' });
    for (const d of docs.documents) if (d.status === 'expired') reasons.push({ code: 'document_expired', message_ar: `${d.kind_ar} منتهية. جدّدها حتى تشتغل` });
    return { canGoOnline: reasons.length === 0, reasons, checkIn };
  }

  async handoverCode(actor: Actor): Promise<HandoverCode> {
    return this.codes.code(actor.personId, this.clock.now());
  }

  /** Field ops' check of the code a courier reads out (`ops.recordCashReceipt`). */
  verifyHandoverCode(driverId: string, code: string): boolean {
    return this.codes.verify(driverId, code, this.clock.now());
  }
}

function latestPerKind(docs: readonly DocumentRecord[]): DocumentRecord[] {
  const byKind = new Map<string, DocumentRecord>();
  for (const d of docs) {
    const cur = byKind.get(d.kind);
    if (!cur || d.submittedAt.getTime() >= cur.submittedAt.getTime()) byKind.set(d.kind, d);
  }
  return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}
