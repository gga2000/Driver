import { z } from 'zod';
import { Iqd, LatLng } from './common.js';
import type { CallSession } from './chat-io.js';
import type { Actor } from './identity-io.js';
import type { SafetyCallSession } from './safety-io.js';
import { StopState, StopType, TripState } from './trip.js';

/**
 * `khat.*` — the خطوط driver's side (partner spec; edge-case §5). A khat run is a Trip of vertical
 * `khat` whose stops each carry one child's opaque vault ref. Children's names come only through the
 * identity vault for the run's own driver (every read logged) and are cut to the first name here.
 */

/**
 * The end-of-run "no child left in the car" sweep (partner S-6; Ali, 2026-10-06). One place for its
 * timings so the server, the Partner app and the Console agree.
 */
export const KHAT_RULES = {
  /**
   * A run whose last child stop settled this long ago without "تأكدت، السيارة فاضية" raises a sweep
   * alert: the Console's safety strip (dispatchers) and a reminder push to the driver, once per run.
   */
  sweepAlertAfterMin: 5,
  /** Step 1 of the sweep: "باوعت، كمّل" stays disabled this long ("باوع زين… 3") so he really looks. */
  sweepLookPauseSec: 3,
  /** A sweep alert the driver confirmed late stays on the Console strip this long ("تأكد متأخر 7 دقيقة"). */
  sweepClearedShowMin: 30,
  /** Open sweep alerts older than this drop off the strip (a run's day is over; the record stays). */
  sweepOpenShowHours: 12,
  /** The dispatcher's note when closing an alert for "غيرها" (required then, optional otherwise). */
  sweepCloseNoteMin: 2,
  sweepCloseNoteMax: 300,
} as const;

const DeviceStamp = {
  occurredAt: z.coerce.date().optional(),
  deviceUptimeMs: z.number().int().min(0).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
};

export const KhatStopView = z.object({
  stopId: z.string(),
  seq: z.number().int(),
  type: StopType,
  state: StopState,
  zoneKey: z.string(),
  windowStart: z.coerce.date().nullable(),
  windowEnd: z.coerce.date().nullable(),
  /** Null on stops without a child (school gate wait, depot). */
  child: z
    .object({
      childRef: z.string(),
      firstName: z.string(),
      /**
       * The photo the guardian added (short-lived signed URL; null = the initial). Only ever sent to the
       * run's own driver (the assigned one, or the substitute once the run is his); never on share pages.
       */
      photoUrl: z.string().nullable(),
    })
    .nullable(),
  tappedInAt: z.coerce.date().nullable(),
  tappedOutAt: z.coerce.date().nullable(),
  /** Reported absent for this run: the child's stops are skipped. */
  absent: z.boolean(),
});
export type KhatStopView = z.infer<typeof KhatStopView>;

export const KhatRunTrip = z.object({
  tripId: z.string(),
  state: TripState,
  stops: z.array(KhatStopView),
  childrenTotal: z.number().int(),
  /** Tapped in and not yet out. */
  onBoard: z.number().int(),
  delivered: z.number().int(),
  absent: z.number().int(),
  /**
   * The end-of-run "no child left in the car" sweep (partner S-6): when the driver confirmed the car
   * is empty (`khat.confirmEmptyCar`, logged as `khat.empty_car_confirmed`); null until then.
   */
  emptyCarCheckedAt: z.coerce.date().nullable(),
});
export type KhatRunTrip = z.infer<typeof KhatRunTrip>;

/** "تأكدت، السيارة فاضية": every child stop is settled and the driver checked the seats. */
export const ConfirmEmptyCarInput = z.object({ tripId: z.string().min(1) });
export type ConfirmEmptyCarInput = z.infer<typeof ConfirmEmptyCarInput>;

/** A masked call to the guardian of a child on today's run (never a raw number in production). */
export const CallGuardianInput = z.object({ tripId: z.string().min(1), childRef: z.string().min(1) });
export type CallGuardianInput = z.infer<typeof CallGuardianInput>;

/**
 * Why a dispatcher closed a sweep alert: "اتصلت بالسايق، السيارة فاضية", "اتصلت بالأهل", or "غيرها"
 * with a short note.
 */
export const KhatSweepCloseReason = z.enum(['driver_called_empty', 'guardian_called', 'other']);
export type KhatSweepCloseReason = z.infer<typeof KhatSweepCloseReason>;

/**
 * A run that ended without the sweep (Console safety strip). The driver's name and masked number are
 * a logged vault read for the dispatcher asking; never a child's name.
 */
export const KhatSweepAlert = z.object({
  alertId: z.string(),
  tripId: z.string(),
  cityId: z.string(),
  driver: z.object({
    personId: z.string(),
    /** "حيدر ك."; null when the vault has no name. */
    displayName: z.string().nullable(),
    /** Masked number (identity's member card), never the number itself. */
    phoneMasked: z.string().nullable(),
  }),
  childrenTotal: z.number().int(),
  /** The last child's tap-out at school (null when no child was dropped, e.g. the rest absent). */
  lastDropAt: z.coerce.date().nullable(),
  /** Zone of that last drop-off ("مركز العزيزية"), for where the car was. */
  lastDropZone: z.string().nullable(),
  /** When the last child stop settled: the timer runs from here. */
  runEndedAt: z.coerce.date(),
  raisedAt: z.coerce.date(),
  /** The driver's late "تأكدت، السيارة فاضية" (the alert clears itself); null while open. */
  confirmedAt: z.coerce.date().nullable(),
  /** Whole minutes from the run's end to the late confirm ("تأكد متأخر 7 دقيقة"); null while open. */
  confirmedLateMin: z.number().int().nullable(),
  /**
   * A dispatcher closed it from the Console (Ali, 2026-10-06): it leaves the strip; the record keeps
   * who (staff person id), when and why. A late driver confirm after the close still sets `confirmedAt`.
   */
  closedAt: z.coerce.date().nullable(),
  closedById: z.string().nullable(),
  closeReason: KhatSweepCloseReason.nullable(),
  closeNote: z.string().nullable(),
});
export type KhatSweepAlert = z.infer<typeof KhatSweepAlert>;

/** "سكّر التنبيه": the reason, and a note (required for "غيرها"). Idempotent: the first close stays. */
export const KhatSweepCloseInput = z
  .object({
    alertId: z.string().min(1).max(80),
    reason: KhatSweepCloseReason,
    note: z.string().trim().max(KHAT_RULES.sweepCloseNoteMax).optional(),
  })
  .refine((v) => v.reason !== 'other' || (v.note?.length ?? 0) >= KHAT_RULES.sweepCloseNoteMin, { message: 'note required', path: ['note'] });
export type KhatSweepCloseInput = z.infer<typeof KhatSweepCloseInput>;

/** Open sweep alerts and the ones confirmed late in the last `sweepClearedShowMin`, open first. */
export const KhatSweepAlertsInput = z.object({ cityId: z.string().min(1) });
export type KhatSweepAlertsInput = z.infer<typeof KhatSweepAlertsInput>;

/** The dispatcher's masked call to the driver from a sweep alert. */
export const KhatSweepCallInput = z.object({ alertId: z.string().min(1).max(80) });
export type KhatSweepCallInput = z.infer<typeof KhatSweepCallInput>;

export const TodayRunInput = z.object({ date: z.coerce.date().optional() });
export const TodayRunView = z.object({
  /** Baghdad local date (YYYY-MM-DD). */
  localDate: z.string(),
  trips: z.array(KhatRunTrip),
});
export type TodayRunView = z.infer<typeof TodayRunView>;

/** Tap a named child in (pickup stop) or out (dropoff stop). Arrives the stop first if needed. */
export const KhatTapInput = z.object({ tripId: z.string().min(1), stopId: z.string().min(1), pin: LatLng.optional(), ...DeviceStamp });
export type KhatTapInput = z.infer<typeof KhatTapInput>;

export const AbsenceReason = z.enum(['guardian_notice', 'not_at_stop', 'sick', 'other']);
export type AbsenceReason = z.infer<typeof AbsenceReason>;

export const ReportAbsenceInput = z.object({
  tripId: z.string().min(1),
  childRef: z.string().min(1),
  reason: AbsenceReason,
  note: z.string().trim().max(300).optional(),
});
export type ReportAbsenceInput = z.infer<typeof ReportAbsenceInput>;

export const AbsenceView = z.object({
  absenceId: z.string(),
  tripId: z.string(),
  childRef: z.string(),
  reason: AbsenceReason,
  skippedStopIds: z.array(z.string()),
  reportedAt: z.coerce.date(),
});
export type AbsenceView = z.infer<typeof AbsenceView>;

export const SubstituteOffersInput = z.object({ cityId: z.string().min(1) });
export const SubstituteOffer = z.object({
  offerId: z.string(),
  tripId: z.string(),
  expiresInSec: z.number().int(),
  stopsCount: z.number().int(),
  childrenCount: z.number().int(),
  firstWindowStart: z.coerce.date().nullable(),
  zones: z.array(z.string()),
  compensationIqd: Iqd,
});
export type SubstituteOffer = z.infer<typeof SubstituteOffer>;

export const AcceptSubstituteInput = z.object({ offerId: z.string().min(1) });
export const AcceptSubstituteOutput = z.object({ outcome: z.enum(['assigned', 'declined']), tripId: z.string() });

// ───────────────────────── guardian: a child's photo (Ali, 2026-10-06) ─────────────────────────

/**
 * A guardian's own خطوط child as the customer app shows it, with the photo he added (signed URL; null =
 * none). The photo is seen ONLY by the driver of that child's run (and the substitute driving it); never
 * on a share page or by anyone else. The guardian removes it at any time (the bytes are deleted).
 */
export const GuardianChild = z.object({ childRef: z.string(), name: z.string(), photoUrl: z.string().nullable() });
export type GuardianChild = z.infer<typeof GuardianChild>;

/** Upload first with `places.photoUpload`, then send its id. Replaces (and deletes) an earlier photo. */
export const SetChildPhotoInput = z.object({ childRef: z.string().min(1).max(80), uploadId: z.string().min(1).max(80) });
export type SetChildPhotoInput = z.infer<typeof SetChildPhotoInput>;
export const RemoveChildPhotoInput = z.object({ childRef: z.string().min(1).max(80) });
export type RemoveChildPhotoInput = z.infer<typeof RemoveChildPhotoInput>;

export interface KhatPort {
  guardianChildren(actor: Actor): Promise<GuardianChild[]>;
  setChildPhoto(actor: Actor, input: SetChildPhotoInput): Promise<GuardianChild>;
  removeChildPhoto(actor: Actor, input: RemoveChildPhotoInput): Promise<GuardianChild>;
  todayRun(actor: Actor, input: z.infer<typeof TodayRunInput>): Promise<TodayRunView>;
  tapIn(actor: Actor, input: KhatTapInput): Promise<KhatRunTrip>;
  tapOut(actor: Actor, input: KhatTapInput): Promise<KhatRunTrip>;
  reportAbsence(actor: Actor, input: ReportAbsenceInput): Promise<AbsenceView>;
  substituteOffers(actor: Actor, input: z.infer<typeof SubstituteOffersInput>): Promise<SubstituteOffer[]>;
  acceptSubstitute(actor: Actor, input: z.infer<typeof AcceptSubstituteInput>): Promise<z.infer<typeof AcceptSubstituteOutput>>;
  confirmEmptyCar(actor: Actor, input: ConfirmEmptyCarInput): Promise<KhatRunTrip>;
  callGuardian(actor: Actor, input: CallGuardianInput): Promise<CallSession>;
  sweepAlerts(actor: Actor, input: KhatSweepAlertsInput): Promise<KhatSweepAlert[]>;
  callSweepDriver(actor: Actor, input: KhatSweepCallInput): Promise<SafetyCallSession>;
  closeSweepAlert(actor: Actor, input: KhatSweepCloseInput): Promise<KhatSweepAlert>;
}
