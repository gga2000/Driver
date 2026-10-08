import { z } from 'zod';
import { Iqd } from './common.js';
import type { Actor } from './identity-io.js';
import { ComplimentCount, type CourierCompliments } from './order-compliment.js';
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

// ───────────────────────── main photo (Ali, 2026-10-06) ─────────────────────────

/**
 * Every driver has ONE main photo customers see (courier / driver card, ride match card, الرجعة
 * offers and seat, the share page). It is the `photo` driver document: a new one goes to the Console
 * approvals queue and only an approved one is shown; until then the previous approved photo (or his
 * initial) stays. `none` = never sent · `pending` = «تنتظر الموافقة» · `approved` = «مقبولة» ·
 * `rejected` = «مرفوضة: {reason}» (the latest submission's state).
 */
export const MainPhotoState = z.enum(['none', 'pending', 'approved', 'rejected']);
export type MainPhotoState = z.infer<typeof MainPhotoState>;

export const MainPhotoView = z.object({
  state: MainPhotoState,
  /** What customers see now: a short-lived signed URL (absolute, or relative to the API). Null = his initial. */
  approved: z.object({ url: z.string(), approvedAt: z.coerce.date().nullable() }).nullable(),
  /** His latest submission (null when he never sent one). */
  latest: z
    .object({
      documentId: z.string(),
      status: z.enum(['pending', 'approved', 'rejected']),
      /** Signed URL of the photo he sent (his own; null if the upload is gone). */
      url: z.string().nullable(),
      submittedAt: z.coerce.date(),
      reviewedAt: z.coerce.date().nullable(),
      rejectReason: z.string().nullable(),
    })
    .nullable(),
});
export type MainPhotoView = z.infer<typeof MainPhotoView>;

/** Upload first with `places.photoUpload`, then send its id: a new `photo` document for review. */
export const SetMainPhotoInput = z.object({ uploadId: z.string().min(1) });
export type SetMainPhotoInput = z.infer<typeof SetMainPhotoInput>;

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

// ───────────────────────── G-91 shift guarantee ─────────────────────────

/**
 * One guarantee shift of his (06:00–15:00 `day` or 15:00–02:00 `evening`), as the server counts it (docs/api/shift-guarantee.md). `live`: now inside
 * it, the numbers so far; `ended`: over, the top-up (if any) is paid on `paysOn`; `paid`: the
 * top-up line is in his earnings (`topUpIqd` is what was paid).
 */
export const GuaranteeWindowView = z.object({
  /** `2026-10-04:evening` (the date the shift starts on, even past midnight): the ledger line's memo is `guarantee:<id>`. */
  id: z.string(),
  /** The shift's key in `MoneyRules.guarantee.peaks`: `day` | `evening` in Aziziyah. */
  peak: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  status: z.enum(['live', 'ended', 'paid']),
  offers: z.number().int().min(0),
  accepted: z.number().int().min(0),
  /** accepted ÷ offers (0–1); null before the first offer. */
  acceptance: z.number().min(0).max(1).nullable(),
  cancelsAfterAccept: z.number().int().min(0),
  completedJobs: z.number().int().min(0),
  /** Earned on the shift's completed jobs (pay and tips less the take; penalties not counted). */
  earningsIqd: Iqd,
  meets: z.object({ acceptance: z.boolean(), cancels: z.boolean(), jobs: z.boolean() }),
  qualified: z.boolean(),
  /** Completed jobs still missing for the jobs condition. */
  jobsToGo: z.number().int().min(0),
  /** live/ended: what the rule gives as it stands; paid: what was paid. */
  topUpIqd: Iqd,
  /** The Sunday it is (or was) paid with the weekly scorecard (local midnight starting that Sunday). */
  paysOn: z.coerce.date(),
  /** The city's rule it was judged by, so every line can say it without a literal in the app. */
  rule: z.object({ amountIqd: Iqd, minAcceptance: z.number().min(0).max(1), maxCancelsAfterAccept: z.number().int().min(0), minCompletedJobs: z.number().int().min(0) }),
});
export type GuaranteeWindowView = z.infer<typeof GuaranteeWindowView>;

export const GuaranteeView = z.object({
  /** The city has the guarantee on and his role is covered; false → nothing to show. */
  enabled: z.boolean(),
  amountIqd: Iqd,
  minAcceptance: z.number().min(0).max(1),
  maxCancelsAfterAccept: z.number().int().min(0),
  minCompletedJobs: z.number().int().min(0),
  /** The peak shift happening now; null between peaks or when not enabled. */
  current: GuaranteeWindowView.nullable(),
  /** This local week's shifts so far (live, ended, paid), newest first; empty when not enabled. */
  week: z.array(GuaranteeWindowView),
  /** Top-ups earned and waiting for Sunday (ended, qualified, not yet paid), summed. */
  pendingIqd: Iqd,
});
export type GuaranteeView = z.infer<typeof GuaranteeView>;

// ───────────────────────── end of shift (partner S-4) ─────────────────────────

/**
 * The shift he just ended. `from` is when he went online (`partner.status.onlineSince`), `to` when he
 * went offline; both default (start of the Baghdad day, now) and are clamped server-side (never in the
 * future, at most `SHIFT_MAX_HOURS` long). Every number is computed on the server from the ledger.
 */
export const SHIFT_MAX_HOURS = 24;
/** Below this much online time "per hour" would be noise: null. */
export const SHIFT_PER_HOUR_MIN_MINUTES = 30;
/**
 * Per hour is a rate, not a payment: it is rounded to the nearest 50 (from the exact minutes) so it
 * reads like the sum a driver does in his head — 11,500 over 5 h 1 min is ≈ 2,300, never "2,250".
 */
export const SHIFT_PER_HOUR_STEP_IQD = 50;

export const ShiftSummaryInput = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ShiftSummaryInput = z.input<typeof ShiftSummaryInput>;

export const ShiftSummary = z.object({
  driverId: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  onlineMinutes: z.number().int().min(0),
  jobs: z.number().int().min(0),
  /** Net for the shift (pay + tips + incentives − take − penalties). */
  netIqd: Iqd,
  tipsIqd: Iqd,
  /** Net per online minute × 60, to the nearest `SHIFT_PER_HOUR_STEP_IQD`; null under `SHIFT_PER_HOUR_MIN_MINUTES`. */
  perHourIqd: Iqd.nullable(),
  /** The Baghdad clock hour that paid most in the shift; null without jobs. */
  bestHour: z.object({ from: z.coerce.date(), to: z.coerce.date(), netIqd: Iqd, jobs: z.number().int() }).nullable(),
  /** The whole Baghdad day so far (he may have had more than one shift). */
  day: z.object({ netIqd: Iqd, jobs: z.number().int() }),
  /** Cash right now: what he hands over (`owedIqd`) against his cap. */
  cash: z.object({ heldIqd: Iqd, owedIqd: Iqd, capIqd: Iqd, overCap: z.boolean() }),
  /**
   * Tomorrow's busiest two hours in the city, from the orders placed on the same weekday last week;
   * null when last week had too few orders to say.
   */
  tomorrow: z.object({ from: z.coerce.date(), to: z.coerce.date(), orders: z.number().int() }).nullable(),
  /** One scorecard nudge at most (the first component under its Silver line), from day 31 only. */
  nudge: ScoreNudge.nullable(),
  /** G-91: the peak shifts this shift overlapped, oldest first (empty when the guarantee does not cover him). */
  guarantee: z.array(GuaranteeWindowView).default([]),
  /** Joy l4: the kind words customers picked for him during the shift, most said first (empty: none). */
  compliments: z.array(ComplimentCount).default([]),
  /**
   * «يومك» (partner redesign e7): the straight-line km between the stops of the shift's trips, rounded
   * down to whole km. The road is never shorter, so the app says «أكثر من {km} كم»; null without trips.
   */
  minKm: z.number().int().min(0).nullable().default(null),
});
export type ShiftSummary = z.infer<typeof ShiftSummary>;

// ───────────────────────── his best (partner redesign e3 / e4) ─────────────────────────

/** How far back «أحسن وقت إلك» and his best day look: four whole weeks, so every weekday counts four times. */
export const MY_BEST_DAYS = 28;
/** The widest best-time window, in clock hours; edges that earned little are trimmed off it (never below 2 h). */
export const MY_BEST_WINDOW_MAX_HOURS = 4;
/** A best time is a habit, not one lucky night: at least this many jobs in it, on at least two different days. */
export const MY_BEST_MIN_JOBS = 4;

/**
 * His own week and his own best, from his ledger (partner redesign e3 / e4): the earnings tab shows
 * these instead of "less than yesterday". Nothing here is a promise or a payment: it is what he made.
 */
export const MyBestView = z.object({
  /** This Baghdad week so far (Sunday start). */
  week: z.object({ from: z.coerce.date(), netIqd: Iqd, jobs: z.number().int().min(0) }),
  /** His best Baghdad day in the last `MY_BEST_DAYS` days (today included); null without paid jobs. */
  bestDay: z.object({ at: z.coerce.date(), netIqd: Iqd, jobs: z.number().int().min(0) }).nullable(),
  /**
   * «أحسن وقت إلك: الخميس 7–11 بالليل»: the weekday and clock hours [fromHour, toHour) that paid him most
   * in the last four weeks, and what that window paid on average per hour of it (net, his history only).
   * Null until a window has `MY_BEST_MIN_JOBS` jobs on two different days.
   */
  bestWindow: z
    .object({
      /** 0 = Sunday … 6 = Saturday, Baghdad. */
      weekday: z.number().int().min(0).max(6),
      fromHour: z.number().int().min(0).max(23),
      toHour: z.number().int().min(1).max(24),
      perHourIqd: Iqd,
      jobs: z.number().int().min(0),
      days: z.number().int().min(0),
    })
    .nullable(),
  sinceDays: z.number().int(),
});
export type MyBestView = z.infer<typeof MyBestView>;

// ───────────────────────── "why was I paid this" (partner S-7) ─────────────────────────

/**
 * Why a pay line is what it is. `quote_*` codes read the customer's own quote reasons
 * (`quote.reason.*`), so the courier sees the same sentence the customer saw; the rest are partner
 * lines (`partner.receipt_reason_*`).
 */
export const ReceiptReasonCode = z.enum([
  'delivery_full',
  'night',
  'rain',
  'peak',
  'door_pickup',
  'wait',
  'fare',
  'take',
  'tip',
  'batch',
  'compensation',
  'guarantee',
  'incentive',
  'penalty',
]);
export type ReceiptReasonCode = z.infer<typeof ReceiptReasonCode>;

export const JobReceiptInput = z.object({
  /** `EarningsJobLine.key` (trip id, else order id). */
  key: z.string().min(1),
  /** `EarningsJobLine.at`: the job is looked up around it (the ledger is read by time). */
  at: z.coerce.date(),
});
export type JobReceiptInput = z.input<typeof JobReceiptInput>;

export const JobReceiptLine = EarningsComponent.extend({
  reason: z.object({ code: ReceiptReasonCode, params: z.record(z.string(), z.union([z.string(), z.number()])) }).nullable(),
});
export type JobReceiptLine = z.infer<typeof JobReceiptLine>;

export const JobReceipt = z.object({
  key: z.string(),
  tripId: z.string().nullable(),
  orderId: z.string().nullable(),
  /** "1284": the number the kitchen, the customer and support say (`orderTicketNumber`). */
  ticket: z.string().nullable(),
  at: z.coerce.date(),
  lines: z.array(JobReceiptLine),
  /** Positive pay before take (fares, delivery fees, extras). */
  grossIqd: Iqd,
  /** The platform's take on this job, positive. */
  takeIqd: Iqd,
  /** take ÷ the pay it was taken from (0–1); null when nothing was taken. */
  takeRate: z.number().min(0).max(1).nullable(),
  tipsIqd: Iqd,
  netIqd: Iqd,
  /** Cash he took at the door and where it went; null for a cashless job. */
  cash: z
    .object({
      collectedIqd: Iqd,
      /** Paid to the restaurant at pickup (PIN-confirmed). */
      toMerchantIqd: Iqd,
      /** His own pay for this job, kept out of the cash (the hand-over nets earnings against cash). */
      keptIqd: Iqd,
      /** The rest: the company's (with the restaurant's share when he did not pay it at pickup), handed over with the daily code. */
      toCompanyIqd: Iqd,
    })
    .nullable(),
  /** An objection for this job is already with support. */
  queryOpen: z.boolean(),
  /**
   * His objection and what support said (partner audit S-7 follow-up): `open` («قيد المراجعة») until the
   * ticket is resolved («انحلت»); `reply` is support's latest answer to him (never an internal note),
   * `resolution` the closing words. Null when he never objected (and on older servers).
   */
  query: z
    .object({
      ticketId: z.string(),
      status: z.enum(['open', 'resolved']),
      reply: z.object({ text: z.string(), at: z.coerce.date() }).nullable(),
      resolution: z.string().nullable(),
      resolvedAt: z.coerce.date().nullable(),
    })
    .nullable()
    .default(null),
});
export type JobReceipt = z.infer<typeof JobReceipt>;
export type PayQueryStatus = NonNullable<JobReceipt['query']>;

/** "عندي اعتراض": a support ticket with the job attached (receipt lines in the note). */
export const PayQueryInput = z.object({
  key: z.string().min(1),
  at: z.coerce.date(),
  message: z.string().trim().min(3).max(1000),
});
export type PayQueryInput = z.input<typeof PayQueryInput>;

export const PayQueryResult = z.object({
  ticketId: z.string(),
  openedAt: z.coerce.date(),
  /** He had already sent one for this job: the same ticket comes back. */
  alreadyOpen: z.boolean(),
});
export type PayQueryResult = z.infer<typeof PayQueryResult>;

export interface DriverAccountPort {
  guarantee(actor: Actor): Promise<GuaranteeView>;
  shiftSummary(actor: Actor, input: z.output<typeof ShiftSummaryInput>): Promise<ShiftSummary>;
  /** «كلام الزبائن» (joy l4): his compliments counted and the latest ones. */
  compliments(actor: Actor): Promise<CourierCompliments>;
  /** His week and his best (partner redesign e3 / e4). */
  myBest(actor: Actor): Promise<MyBestView>;
  jobReceipt(actor: Actor, input: z.output<typeof JobReceiptInput>): Promise<JobReceipt>;
  payQuery(actor: Actor, input: z.output<typeof PayQueryInput>): Promise<PayQueryResult>;
  earnings(actor: Actor, input: z.output<typeof EarningsInput>): Promise<EarningsView>;
  scorecard(actor: Actor, input: z.infer<typeof ScorecardInput>): Promise<ScorecardView>;
  documents(actor: Actor, input: z.infer<typeof DocumentsInput>): Promise<DocumentsView>;
  uploadDocument(actor: Actor, input: UploadDocumentInput): Promise<DriverDocumentView>;
  reviewDocument(actor: Actor, input: ReviewDocumentInput): Promise<DriverDocumentView>;
  mainPhoto(actor: Actor): Promise<MainPhotoView>;
  setMainPhoto(actor: Actor, input: SetMainPhotoInput): Promise<MainPhotoView>;
  checkInChallenge(actor: Actor): Promise<CheckInChallenge>;
  submitCheckIn(actor: Actor, input: SubmitCheckInInput): Promise<CheckInResult>;
  checkInStatus(actor: Actor): Promise<CheckInStatus>;
  onlineGate(actor: Actor): Promise<OnlineGate>;
  handoverCode(actor: Actor): Promise<HandoverCode>;
}
