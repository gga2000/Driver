import { z } from 'zod';
import type { Actor } from './identity-io.js';

/**
 * The Today list (Console build plan E1, CON-12): one row per problem, so nothing falls through.
 *
 * Rows are opened by the server from domain events (an SOS, a trip nobody took, a shop that went
 * quiet, a late order, a courier who can't reach the door, an order on the stuck list, a courier over
 * his cash cap, a document or a new shop waiting, a خطوط empty-car check missed, a seat PIN alert, a bad
 * rating). A row closes by itself when the problem ends (the order
 * is delivered, someone took the trip, the SOS is resolved); otherwise a person closes it, always with
 * an outcome. Anyone on a desk can take a row (it is then theirs), hand it to someone, snooze it for a
 * few minutes or close it. The row keeps ids and short facts only; names are read from the vault when
 * shown.
 */
export const INBOX_KINDS = [
  'sos',
  'safety_report',
  'no_driver',
  'store_silent',
  'late',
  'unreachable',
  'stuck',
  'cash_cap',
  'low_rating',
  'sweep',
  'pin_alert',
  'approval',
  'late_departure',
] as const;
export const InboxKind = z.enum(INBOX_KINDS);
export type InboxKind = z.infer<typeof InboxKind>;

/** Most urgent first: the list sorts by this, then oldest first. */
export const INBOX_PRIORITY: Record<InboxKind, number> = {
  sos: 0,
  safety_report: 1,
  sweep: 2,
  pin_alert: 3,
  // Riders standing at a garage with no car, or a car out on the road that never said «وصلت».
  late_departure: 4,
  no_driver: 5,
  unreachable: 6,
  stuck: 7,
  store_silent: 8,
  late: 9,
  cash_cap: 10,
  low_rating: 11,
  approval: 12,
};

export const InboxSubjectKind = z.enum([
  'incident',
  'trip',
  'order',
  'document',
  'onboarding',
  'sweep_alert',
  'pin_attempt',
  'courier',
  'ticket',
  'departure',
]);
export type InboxSubjectKind = z.infer<typeof InboxSubjectKind>;

/** Rows a person can't close here: they close when the problem is closed where it lives (the SOS desk, the خطوط check). */
export const INBOX_CLOSE_AT_SOURCE: readonly InboxKind[] = ['sos', 'safety_report', 'sweep'];

/** Who reads the list, and who works it (finance reads only). */
export const INBOX_READ_ROLES = ['admin', 'dispatcher', 'support', 'field_ops', 'finance'] as const;
export const INBOX_WORK_ROLES = ['admin', 'dispatcher', 'support', 'field_ops'] as const;

export const INBOX_RULES = {
  /**
   * A rating this low or lower (food or courier, 1–5) opens a case: staff hear the customer, the
   * restaurant and the courier or driver before closing it, and close it with a note (Ali, 2026-10-08:
   * every bad rating, not only repeats).
   */
  lowRatingMaxStars: 2,
  /** The snooze choices, minutes. */
  snoozeMinutes: [5, 15, 30, 60] as const,
  /** Closed rows stay visible under "done" this long. */
  doneKeepHours: 12,
  /** Most rows a list call returns. */
  listLimit: 200,
  noteMax: 500,
} as const;

/** Nothing closes without one. `auto`: the problem ended by itself (the server closed it). */
export const InboxOutcome = z.enum([
  'fixed',
  'called',
  'handed_over',
  'no_action',
  'duplicate',
  'auto',
]);
export type InboxOutcome = z.infer<typeof InboxOutcome>;
/** What a person may pick (never `auto`). */
export const InboxStaffOutcome = InboxOutcome.exclude(['auto']);
export type InboxStaffOutcome = z.infer<typeof InboxStaffOutcome>;

export const InboxState = z.enum(['open', 'snoozed', 'done']);
export type InboxState = z.infer<typeof InboxState>;

/** Short facts copied from the event (reason, vertical, document kind…): ids and keys, never names. */
export const InboxFacts = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type InboxFacts = z.infer<typeof InboxFacts>;

export const InboxItem = z.object({
  id: z.string(),
  cityId: z.string(),
  kind: InboxKind,
  subjectKind: InboxSubjectKind,
  subjectId: z.string(),
  orderId: z.string().nullable(),
  tripId: z.string().nullable(),
  facts: InboxFacts,
  /** When the problem was first seen; `times` counts how often it came back while open or after. */
  openedAt: z.coerce.date(),
  lastSeenAt: z.coerce.date(),
  times: z.number().int(),
  assigneeId: z.string().nullable(),
  assignedAt: z.coerce.date().nullable(),
  snoozedUntil: z.coerce.date().nullable(),
  doneAt: z.coerce.date().nullable(),
  doneById: z.string().nullable(),
  outcome: InboxOutcome.nullable(),
  note: z.string().nullable(),
});
export type InboxItem = z.infer<typeof InboxItem>;

/** A row as the Console shows it. */
export const InboxRow = InboxItem.extend({
  state: InboxState,
  assigneeName: z.string().nullable(),
  doneByName: z.string().nullable(),
  mine: z.boolean(),
});
export type InboxRow = z.infer<typeof InboxRow>;

export const InboxView = z.enum(['open', 'mine', 'snoozed', 'done']);
export type InboxView = z.infer<typeof InboxView>;

export const InboxListInput = z.object({
  cityId: z.string().min(1).max(40),
  view: InboxView.default('open'),
  kind: InboxKind.optional(),
});
export type InboxListInput = z.input<typeof InboxListInput>;

export const InboxCountsInput = z.object({ cityId: z.string().min(1).max(40) });
export type InboxCountsInput = z.infer<typeof InboxCountsInput>;

export const InboxCounts = z.object({
  cityId: z.string(),
  open: z.number().int(),
  unassigned: z.number().int(),
  mine: z.number().int(),
  snoozed: z.number().int(),
  doneToday: z.number().int(),
  byKind: z.record(InboxKind, z.number().int()),
  /** The oldest open row, for the "waiting since" line. */
  oldestOpenAt: z.coerce.date().nullable(),
});
export type InboxCounts = z.infer<typeof InboxCounts>;

const Id = z.object({ id: z.string().min(1).max(80) });
export const InboxTakeInput = Id;
export type InboxTakeInput = z.infer<typeof InboxTakeInput>;
export const InboxAssignInput = Id.extend({ personId: z.string().min(1).max(80) });
export type InboxAssignInput = z.infer<typeof InboxAssignInput>;
export const InboxSnoozeInput = Id.extend({
  minutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)]),
});
export type InboxSnoozeInput = z.infer<typeof InboxSnoozeInput>;
export const InboxDoneInput = Id.extend({
  outcome: InboxStaffOutcome,
  note: z.string().trim().max(INBOX_RULES.noteMax).optional(),
});
export type InboxDoneInput = z.infer<typeof InboxDoneInput>;
export const InboxNoteInput = Id.extend({
  note: z.string().trim().min(1).max(INBOX_RULES.noteMax),
});
export type InboxNoteInput = z.infer<typeof InboxNoteInput>;

/** `inbox.*` behind `ctx.inbox` (`modules/inbox`). */
export interface InboxServicePort {
  list(actor: Actor, input: z.output<typeof InboxListInput>): Promise<InboxRow[]>;
  counts(actor: Actor, input: z.output<typeof InboxCountsInput>): Promise<InboxCounts>;
  take(actor: Actor, input: InboxTakeInput): Promise<InboxRow>;
  assign(actor: Actor, input: InboxAssignInput): Promise<InboxRow>;
  snooze(actor: Actor, input: InboxSnoozeInput): Promise<InboxRow>;
  done(actor: Actor, input: z.output<typeof InboxDoneInput>): Promise<InboxRow>;
  note(actor: Actor, input: z.output<typeof InboxNoteInput>): Promise<InboxRow>;
}
