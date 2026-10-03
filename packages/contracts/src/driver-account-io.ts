import { z } from 'zod';
import { Iqd } from './common.js';
import type { Actor } from './identity-io.js';
import { LedgerEventType } from './ledger.js';
import { CapRole, CapTier } from './ledger-rules.js';

/**
 * `driverAccount.*` (partner & merchant apps spec, "Also" list): a driving person's own money,
 * scorecard, documents and daily check-in. Earnings are composed from the ledger (every pay
 * component named); the scorecard from events (scoring spec §1); document photos and selfies are
 * refs in the identity vault, the public schema holds only status and expiry.
 */

// ───────────────────────── earnings ─────────────────────────

export const EarningsPeriod = z.enum(['day', 'week', 'month']);
export type EarningsPeriod = z.infer<typeof EarningsPeriod>;

export const EarningsInput = z.object({
  period: EarningsPeriod.default('day'),
  /** Any instant inside the wanted period (Baghdad local day / Sunday-start week / month); default now. */
  anchor: z.coerce.date().optional(),
  /** Fleet owners (their own drivers) and back office only; default the caller. */
  driverId: z.string().min(1).optional(),
});
export type EarningsInput = z.input<typeof EarningsInput>;

/** One named pay component on a job: fare, delivery fee, tip, take (negative), incentive… */
export const EarningsComponent = z.object({
  type: LedgerEventType,
  /** "أجرة التوصيل", "بقشيش", "عمولة المنصة"… from packages/i18n (`ledger.line.<type>`). */
  label_ar: z.string(),
  label_en: z.string(),
  /** Signed for the driver: + earned, − taken (platform take, penalties). */
  amountIqd: Iqd,
  memo: z.string().nullable(),
});
export type EarningsComponent = z.infer<typeof EarningsComponent>;

export const EarningsJobLine = z.object({
  /** Trip id, else order id, else the ledger group (adjustments). */
  key: z.string(),
  tripId: z.string().nullable(),
  orderId: z.string().nullable(),
  at: z.coerce.date(),
  components: z.array(EarningsComponent),
  netIqd: Iqd,
  /** Cash taken from the customer on this job (it is not his: it goes to the merchant / platform). */
  cashCollectedIqd: Iqd,
});
export type EarningsJobLine = z.infer<typeof EarningsJobLine>;

export const EarningsView = z.object({
  driverId: z.string(),
  period: EarningsPeriod,
  from: z.coerce.date(),
  to: z.coerce.date(),
  totals: z.object({
    /** Fares, delivery fees, seat money, late-meter and cancellation fees received (before take). */
    grossIqd: Iqd,
    /** Platform take (commission_accrued), as a positive number. */
    takeIqd: Iqd,
    tipsIqd: Iqd,
    /** Incentives other than the shift guarantee (rebroadcast compensation, promos…). */
    bonusesIqd: Iqd,
    /** Launch shift guarantee top-ups (money §2, G-91). */
    guaranteeTopUpsIqd: Iqd,
    /** Penalties and fees he paid (late meter, departure cancel). */
    penaltiesIqd: Iqd,
    netIqd: Iqd,
    jobs: z.number().int(),
  }),
  jobs: z.array(EarningsJobLine),
  cash: z.object({
    /** Cash collected from customers in the period. */
    collectedIqd: Iqd,
    /** Handed to merchants (PIN-confirmed) in the period. */
    toMerchantsIqd: Iqd,
    /** Settled to the company (ops round, agent, ZainCash) in the period. */
    settledIqd: Iqd,
    /** Right now: cash in hand that is not his. */
    heldIqd: Iqd,
    /** Right now: what he owes (cash not returned + fees owed − earnings). */
    owedIqd: Iqd,
  }),
  /** The cash cap bar (money §4): values by role and tier. */
  cap: z.object({
    role: CapRole,
    tier: CapTier,
    capIqd: Iqd,
    owedIqd: Iqd,
    remainingIqd: Iqd,
    /** 0–1 filled share of the bar. */
    fill: z.number().min(0).max(1),
    overCap: z.boolean(),
    /** The caps table for his role, so the bar can show the next tier. */
    byTier: z.object({ bronze: Iqd, silver: Iqd, gold: Iqd }),
  }),
  payoutDueIqd: Iqd,
});
export type EarningsView = z.infer<typeof EarningsView>;

// ───────────────────────── scorecard ─────────────────────────

export const ScoreMetricKey = z.enum(['acceptance', 'completion', 'on_time', 'rating', 'cash_return']);
export type ScoreMetricKey = z.infer<typeof ScoreMetricKey>;

export const ScoreMetric = z.object({
  key: ScoreMetricKey,
  label_ar: z.string(),
  /** Rate 0–1, or the average rating 1–5 for `rating`; null without samples. */
  value: z.number().nullable(),
  /** "86٪" / "4.7" */
  display: z.string(),
  samples: z.number().int(),
  /** Full marks and zero per scoring §1; the Silver line is where the component falls to 70 %. */
  fullAt: z.number(),
  zeroAt: z.number(),
  silverLine: z.number(),
  /** 0–1 share of the component's weight earned. */
  score: z.number().min(0).max(1),
  weight: z.number(),
  belowSilver: z.boolean(),
});
export type ScoreMetric = z.infer<typeof ScoreMetric>;

export const ScoreNudge = z.object({ key: ScoreMetricKey, message_ar: z.string(), message_en: z.string() });
export type ScoreNudge = z.infer<typeof ScoreNudge>;

export const ScorecardInput = z.object({ driverId: z.string().min(1).optional() });
export const ScorecardView = z.object({
  driverId: z.string(),
  /** Days since his first activity, 1-based. */
  dayNumber: z.number().int(),
  /** Scoring §1: days 1–30 are observation; the card shows to the driver from day 31. */
  visibleFrom: z.coerce.date(),
  visible: z.boolean(),
  observation: z.boolean(),
  /** "فترة تعلّم: نراقب أداءك ٣٠ يوم بدون أي إجراء" while observing; null after. */
  learningMessage_ar: z.string().nullable(),
  /** Null while hidden from the driver (back office always sees it). */
  index: z.number().min(0).max(100).nullable(),
  tier: CapTier.nullable(),
  completedTrips: z.number().int(),
  windowDays: z.number().int(),
  /** Empty while hidden from the driver. */
  metrics: z.array(ScoreMetric),
  /** Same-evening nudges for components under their Silver line (from day 31 only). */
  nudges: z.array(ScoreNudge),
  /** Consequences apply the following Sunday, never the same day; null in month 1 or with nothing below Silver. */
  consequencesFrom: z.coerce.date().nullable(),
});
export type ScorecardView = z.infer<typeof ScorecardView>;

// ───────────────────────── documents ─────────────────────────

export const DriverDocumentKind = z.enum(['national_id_front', 'national_id_back', 'licence', 'vehicle_registration', 'insurance', 'photo']);
export type DriverDocumentKind = z.infer<typeof DriverDocumentKind>;

/** Stored status is pending/approved/rejected; `expiring` (≤ 30 days) and `expired` are derived from the expiry. */
export const DriverDocumentStatus = z.enum(['pending', 'approved', 'rejected', 'expiring', 'expired']);
export type DriverDocumentStatus = z.infer<typeof DriverDocumentStatus>;

export const DriverDocumentView = z.object({
  id: z.string(),
  kind: DriverDocumentKind,
  kind_ar: z.string(),
  status: DriverDocumentStatus,
  status_ar: z.string(),
  expiresAt: z.coerce.date().nullable(),
  daysToExpiry: z.number().int().nullable(),
  submittedAt: z.coerce.date(),
  reviewedAt: z.coerce.date().nullable(),
  rejectReason: z.string().nullable(),
});
export type DriverDocumentView = z.infer<typeof DriverDocumentView>;

export const DocumentsInput = z.object({ driverId: z.string().min(1).optional() });
export const DocumentsView = z.object({
  driverId: z.string(),
  /** Latest submission per kind. */
  documents: z.array(DriverDocumentView),
  /** Kinds his roles need that were never submitted (licence and registration only for car/van drivers). */
  missing: z.array(DriverDocumentKind),
  /** Expired → offline (scoring §2). */
  blocksOnline: z.boolean(),
});
export type DocumentsView = z.infer<typeof DocumentsView>;

/**
 * The photo goes up first through `places.photoUpload` (signed PUT); this references its upload id.
 * The ref is written to the identity vault, never to the public schema.
 */
export const UploadDocumentInput = z.object({
  kind: DriverDocumentKind,
  uploadId: z.string().min(1),
  expiresAt: z.coerce.date().optional(),
});
export type UploadDocumentInput = z.infer<typeof UploadDocumentInput>;

/** Field ops / admin review (Console: ID vs selfie, plate vs photo). */
export const ReviewDocumentInput = z
  .object({ documentId: z.string().min(1), decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(1).max(200).optional(), expiresAt: z.coerce.date().optional() })
  .refine((v) => v.decision === 'approve' || Boolean(v.reason), { message: 'a rejection needs a reason', path: ['reason'] });
export type ReviewDocumentInput = z.infer<typeof ReviewDocumentInput>;

// ───────────────────────── daily check-in ─────────────────────────

export const LivenessGesture = z.enum(['blink', 'turn_left', 'turn_right', 'smile', 'nod']);
export type LivenessGesture = z.infer<typeof LivenessGesture>;

export const CheckInChallenge = z.object({
  challengeId: z.string(),
  gesture: LivenessGesture,
  /** "غمّض عيونك مرتين" */
  gesture_ar: z.string(),
  expiresAt: z.coerce.date(),
});
export type CheckInChallenge = z.infer<typeof CheckInChallenge>;

export const SubmitCheckInInput = z.object({
  challengeId: z.string().min(1),
  /** Selfie uploaded through `places.photoUpload`; the ref goes to the vault (dropped after 90 days, result kept). */
  uploadId: z.string().min(1),
  /** On-device liveness SDK score 0–1 (stub until the SDK lands); omitted = 1. */
  livenessScore: z.number().min(0).max(1).optional(),
});
export type SubmitCheckInInput = z.infer<typeof SubmitCheckInInput>;

export const CheckInStatus = z.object({
  /** Baghdad local date the status is for (YYYY-MM-DD). */
  localDate: z.string(),
  required: z.boolean(),
  verifiedToday: z.boolean(),
  verifiedAt: z.coerce.date().nullable(),
  failuresToday: z.number().int(),
  /** Two failures → offline for the day and an ops alert (scoring §2). */
  lockedOut: z.boolean(),
  /** "متحقق اليوم ✓" badge (scoring §5). */
  badge_ar: z.string().nullable(),
});
export type CheckInStatus = z.infer<typeof CheckInStatus>;

export const CheckInResult = CheckInStatus.extend({
  checkInId: z.string(),
  result: z.enum(['passed', 'failed']),
  reason: z.string().nullable(),
});
export type CheckInResult = z.infer<typeof CheckInResult>;

/** Whether he may go online now, and why not. The Partner shell calls it before `partner` presence. */
export const OnlineGate = z.object({
  canGoOnline: z.boolean(),
  reasons: z.array(z.object({ code: z.enum(['checkin_required', 'checkin_locked', 'document_expired']), message_ar: z.string() })),
  checkIn: CheckInStatus,
});
export type OnlineGate = z.infer<typeof OnlineGate>;

/** The 4-digit code he reads to field ops when handing cash in (`ops.recordCashReceipt`). Rotates daily. */
export const HandoverCode = z.object({ code: z.string().regex(/^\d{4}$/), validUntil: z.coerce.date() });
export type HandoverCode = z.infer<typeof HandoverCode>;

export interface DriverAccountPort {
  earnings(actor: Actor, input: z.output<typeof EarningsInput>): Promise<EarningsView>;
  scorecard(actor: Actor, input: z.infer<typeof ScorecardInput>): Promise<ScorecardView>;
  documents(actor: Actor, input: z.infer<typeof DocumentsInput>): Promise<DocumentsView>;
  uploadDocument(actor: Actor, input: UploadDocumentInput): Promise<DriverDocumentView>;
  reviewDocument(actor: Actor, input: ReviewDocumentInput): Promise<DriverDocumentView>;
  checkInChallenge(actor: Actor): Promise<CheckInChallenge>;
  submitCheckIn(actor: Actor, input: SubmitCheckInInput): Promise<CheckInResult>;
  checkInStatus(actor: Actor): Promise<CheckInStatus>;
  onlineGate(actor: Actor): Promise<OnlineGate>;
  handoverCode(actor: Actor): Promise<HandoverCode>;
}
