import { z } from 'zod';
import type { Actor } from './identity-io.js';

/**
 * SOS (scoring & safety spec §3; edge-case decisions, UI/UX audit: a launch requirement). On every
 * active trip — a food job, a taxi or tuktuk ride, a الرجعة departure, a private ride from the
 * request board, a خطوط run — the driver and the customer can hold "طوارئ" for 3 seconds. That
 * opens a safety incident: the Console shows a red banner with sound on every page, on-shift
 * dispatchers and admins are paged (push + WhatsApp, SMS twin), the person's emergency contact
 * gets a WhatsApp (SMS twin) with a live-location link, and the pressing phone keeps sending its
 * position every few seconds while the incident is open. Within 10 seconds the person can cancel
 * ("تنبيه بالغلط"); the cancel is logged, never erased. A dispatcher acknowledges, calls through the
 * masked-call port and resolves with a note; every read of personal data is a logged vault read.
 */

export const SAFETY_RULES = {
  /** The hold that sends the alert. */
  holdMs: 3_000,
  /** "كنسل — تنبيه بالغلط" stays available this long after the alert is received. */
  cancelWindowSec: 10,
  /** The pressing phone sends its position this often while the incident is open. */
  positionEverySec: 5,
  /** Spec §3: not acknowledged within this → escalated to Ali (the admin on duty). */
  ackWithinSec: 60,
  /** New alerts per person per hour (a stuck button or a prank cannot flood the desk). */
  maxPerHour: 5,
  /** Position updates per incident per minute (anything faster is dropped, not an error). */
  maxPositionsPerMin: 30,
  /** A trip that just ended still counts as active for this long (the danger may outlast the trip). */
  graceAfterEndMin: 30,
  /** The emergency contact's live-location link lives this long after the incident closes. */
  linkAfterCloseMin: 30,
  /** Iraq's police emergency number, shown when the alert cannot be sent. */
  policeNumber: '104',
} as const;

/** What the alert is about. Customers name an order (ride) or a الرجعة booking; drivers a trip, departure or request. */
export const SosSubjectKind = z.enum(['trip', 'order', 'departure', 'booking', 'request']);
export type SosSubjectKind = z.infer<typeof SosSubjectKind>;

export const SosSubject = z.object({ kind: SosSubjectKind, id: z.string().min(1).max(80) });
export type SosSubject = z.infer<typeof SosSubject>;

/** Optional, picked after the alert is sent (never before: the hold must stay one gesture). */
export const SosCategory = z.enum(['accident', 'harassment', 'threat', 'medical', 'other']);
export type SosCategory = z.infer<typeof SosCategory>;

/** One fix from the pressing phone: where, how sure, and the device's own clock. */
export const SosPosition = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Metres (GPS horizontal accuracy); null when the platform does not say. */
  accuracyM: z.number().min(0).max(100_000).nullable(),
  /** Device wall time of the fix (skew is visible next to the server's receipt time). */
  at: z.coerce.date(),
});
export type SosPosition = z.infer<typeof SosPosition>;

export const SosRaiseInput = z.object({
  subject: SosSubject,
  /** Last known position; null when the phone has none yet (the alert still goes out). */
  position: SosPosition.nullable(),
  category: SosCategory.optional(),
  /** Device time of the press. */
  pressedAt: z.coerce.date().optional(),
  /** Idempotency: a retry of the same press (flaky network) returns the same incident. */
  clientId: z.string().min(8).max(80),
});
export type SosRaiseInput = z.infer<typeof SosRaiseInput>;

export const SosIncidentIdInput = z.object({ incidentId: z.string().min(1).max(80) });
export type SosIncidentIdInput = z.infer<typeof SosIncidentIdInput>;

export const SosPositionInput = z.object({ incidentId: z.string().min(1).max(80), position: SosPosition });
export type SosPositionInput = z.infer<typeof SosPositionInput>;

export const SosCategoryInput = z.object({ incidentId: z.string().min(1).max(80), category: SosCategory });
export type SosCategoryInput = z.infer<typeof SosCategoryInput>;

export const SosStatusInput = z.object({ incidentId: z.string().min(1).max(80).optional() });
export type SosStatusInput = z.infer<typeof SosStatusInput>;

/** `open` (nobody took it yet) → `acknowledged` → `resolved`; `cancelled` = false alarm inside the window. */
export const SafetyIncidentState = z.enum(['open', 'acknowledged', 'resolved', 'cancelled']);
export type SafetyIncidentState = z.infer<typeof SafetyIncidentState>;

export const SosRole = z.enum(['driver', 'customer']);
export type SosRole = z.infer<typeof SosRole>;

/** The emergency contact's message, as far as the providers told us. */
export const SosContactStatus = z.enum(['none', 'queued', 'sent', 'delivered', 'sms', 'failed']);
export type SosContactStatus = z.infer<typeof SosContactStatus>;

/** What the pressing phone sees (`safety.sos`, `safety.status`, `safety.cancel`). */
export const SosView = z.object({
  incidentId: z.string(),
  state: SafetyIncidentState,
  raisedAt: z.coerce.date(),
  /** "كنسل — تنبيه بالغلط" until then. */
  cancelUntil: z.coerce.date(),
  acknowledgedAt: z.coerce.date().nullable(),
  /** First name of the dispatcher who took it ("حيدر من فريق العمليات استلم تنبيهك"). */
  acknowledgedBy: z.string().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  /** The emergency contact's first name when one is set (the number never comes back). */
  contactName: z.string().nullable(),
  contactStatus: SosContactStatus,
  /** Keep sending positions every `positionEverySec` while true. */
  sharing: z.boolean(),
  category: SosCategory.nullable(),
  serverNow: z.coerce.date(),
});
export type SosView = z.infer<typeof SosView>;

/** Public read of the emergency contact's live-location link (no sign-in; coarse on purpose). */
export const SosSharedInput = z.object({ token: z.string().min(1).max(200) });
export type SosSharedInput = z.infer<typeof SosSharedInput>;

export const SosShared = z.object({
  status: z.enum(['live', 'closed', 'expired']),
  firstName: z.string().nullable(),
  position: z.object({ lat: z.number(), lng: z.number(), accuracyM: z.number().nullable(), at: z.coerce.date(), ageSec: z.number().int().min(0) }).nullable(),
  raisedAt: z.coerce.date().nullable(),
  serverNow: z.coerce.date(),
});
export type SosShared = z.infer<typeof SosShared>;

// ───────────────────────── Console ─────────────────────────

/** Back-office roles that see and answer SOS alerts (the launch rota: dispatchers, support, admin). */
export const SAFETY_DESK_ROLES = ['dispatcher', 'support', 'admin'] as const;

export const SafetyListInput = z.object({
  /** `open`: open + acknowledged (the banner and the default list); `all`: the last ones of every state. */
  scope: z.enum(['open', 'all']).default('open'),
  limit: z.number().int().min(1).max(200).default(50),
});
export type SafetyListInput = z.input<typeof SafetyListInput>;

export const SafetyIncidentIdInput = z.object({ id: z.string().min(1).max(80) });
export type SafetyIncidentIdInput = z.infer<typeof SafetyIncidentIdInput>;

export const SafetyPerson = z.object({
  personId: z.string(),
  role: SosRole,
  /** "حيدر ك." (logged vault read); null when the vault has no name. */
  displayName: z.string().nullable(),
  /** "0770 ••• 3344". */
  phoneMasked: z.string().nullable(),
});
export type SafetyPerson = z.infer<typeof SafetyPerson>;

export const SafetyFix = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().nullable(),
  /** Device time of the fix. */
  deviceAt: z.coerce.date(),
  /** When the server received it. */
  at: z.coerce.date(),
});
export type SafetyFix = z.infer<typeof SafetyFix>;

export const SafetySubjectView = z.object({
  kind: SosSubjectKind,
  id: z.string(),
  /** Arabic one-liner: "توصيل #1284 · مطعم خالد", "مشوار تكتك #1290", "الرجعة العزيزية ← بغداد 7:30". */
  label: z.string(),
  /** The order to open in the Console, when there is one. */
  orderId: z.string().nullable(),
  tripId: z.string().nullable(),
  /** Vehicle and plate when known ("كيا بونگو · 12345 واسط"). */
  vehicle: z.string().nullable(),
});
export type SafetySubjectView = z.infer<typeof SafetySubjectView>;

export const SafetyIncidentSummary = z.object({
  id: z.string(),
  cityId: z.string(),
  state: SafetyIncidentState,
  category: SosCategory.nullable(),
  raiser: SafetyPerson,
  subject: SafetySubjectView,
  raisedAt: z.coerce.date(),
  /** Device time of the press (skew shows next to `raisedAt`). */
  pressedAt: z.coerce.date().nullable(),
  lastPosition: SafetyFix.nullable(),
  acknowledgedAt: z.coerce.date().nullable(),
  acknowledgedByName: z.string().nullable(),
  resolvedAt: z.coerce.date().nullable(),
  /** Open and not taken for longer than `ackWithinSec`. */
  overdue: z.boolean(),
  escalatedAt: z.coerce.date().nullable(),
  contactStatus: SosContactStatus,
});
export type SafetyIncidentSummary = z.infer<typeof SafetyIncidentSummary>;

export const SafetyEntryKind = z.enum(['raised', 'cancelled', 'paged', 'contact', 'acknowledged', 'call', 'note', 'escalated', 'resolved', 'category']);
export type SafetyEntryKind = z.infer<typeof SafetyEntryKind>;

export const SafetyEntry = z.object({
  id: z.string(),
  kind: SafetyEntryKind,
  at: z.coerce.date(),
  /** Staff display name, or null for the system / the person who pressed. */
  byName: z.string().nullable(),
  note: z.string().nullable(),
  /** Small facts for the line ("count", "who", "outcome", "status"). */
  data: z.record(z.string(), z.string()),
});
export type SafetyEntry = z.infer<typeof SafetyEntry>;

export const SafetyOutcome = z.enum(['safe', 'false_alarm', 'emergency', 'escalated']);
export type SafetyOutcome = z.infer<typeof SafetyOutcome>;

export const SafetyIncidentCase = SafetyIncidentSummary.extend({
  counterpart: SafetyPerson.nullable(),
  contact: z.object({ set: z.boolean(), name: z.string().nullable(), phoneMasked: z.string().nullable(), status: SosContactStatus }),
  /** Every fix received, oldest first (the evidence trail). */
  trail: z.array(SafetyFix),
  timeline: z.array(SafetyEntry),
  outcome: SafetyOutcome.nullable(),
  resolution: z.string().nullable(),
  /** The live-location link the emergency contact got (full URL); null when there is no contact. */
  shareUrl: z.string().nullable(),
  serverNow: z.coerce.date(),
});
export type SafetyIncidentCase = z.infer<typeof SafetyIncidentCase>;

export const SafetyResolveInput = z.object({ id: z.string().min(1).max(80), outcome: SafetyOutcome, note: z.string().trim().min(5).max(2000) });
export type SafetyResolveInput = z.infer<typeof SafetyResolveInput>;

export const SafetyNoteInput = z.object({ id: z.string().min(1).max(80), note: z.string().trim().min(2).max(2000) });
export type SafetyNoteInput = z.infer<typeof SafetyNoteInput>;

export const SafetyCallTarget = z.enum(['raiser', 'counterpart', 'contact']);
export type SafetyCallTarget = z.infer<typeof SafetyCallTarget>;

export const SafetyCallInput = z.object({ id: z.string().min(1).max(80), who: SafetyCallTarget });
export type SafetyCallInput = z.infer<typeof SafetyCallInput>;

export const SafetyCallSession = z.object({
  mode: z.enum(['proxy', 'dev_direct']),
  /** What to dial (a `tel:` target). */
  dial: z.string(),
  expiresAt: z.coerce.date(),
});
export type SafetyCallSession = z.infer<typeof SafetyCallSession>;

/** Implemented by the API's `safety` module. */
export interface SafetyPort {
  // the person on the trip
  sos(actor: Actor, input: SosRaiseInput): Promise<SosView>;
  cancel(actor: Actor, input: SosIncidentIdInput): Promise<SosView>;
  status(actor: Actor, input: SosStatusInput): Promise<SosView | null>;
  position(actor: Actor, input: SosPositionInput): Promise<SosView>;
  setCategory(actor: Actor, input: SosCategoryInput): Promise<SosView>;
  /** Public: the token is the only credential. */
  shared(input: SosSharedInput): Promise<SosShared>;
  // the Console
  list(actor: Actor, input: z.infer<typeof SafetyListInput>): Promise<SafetyIncidentSummary[]>;
  get(actor: Actor, input: SafetyIncidentIdInput): Promise<SafetyIncidentCase>;
  acknowledge(actor: Actor, input: SafetyIncidentIdInput): Promise<SafetyIncidentCase>;
  note(actor: Actor, input: SafetyNoteInput): Promise<SafetyIncidentCase>;
  resolve(actor: Actor, input: SafetyResolveInput): Promise<SafetyIncidentCase>;
  call(actor: Actor, input: SafetyCallInput): Promise<SafetyCallSession>;
}
