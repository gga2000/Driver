import { z } from 'zod';
import type { Actor } from './identity-io.js';

/**
 * On call (Console build plan E1, CON-02 and G0-9): who answers when an alert reaches nobody.
 *
 * An alert (an SOS today; the خطوط sweep and the seat PIN alerts later) first rings the whole desk:
 * every dispatcher, support agent and admin, by push, again every `ringEverySec` until someone takes
 * it. If nobody has taken it after `onCallAfterSec`, the people on call now for that desk are reached
 * on every channel (push, WhatsApp, and an SMS twin when WhatsApp is not read), and after
 * `nextRankAfterSec` the people after them. With nobody on the roster, the admins are reached instead,
 * so the list is never empty. The alert stays marked unanswered until someone takes it; it never goes
 * quiet. The voice-call step waits on how calls are carried (K0b) and is off.
 */
export const ON_CALL_RULES = {
  /** The desk is rung again (push) this often while nobody has taken the alert… */
  ringEverySec: 30,
  /** …and, once it has been ringing this long, less often (a forgotten alert must not drain phones). */
  ringSlowAfterSec: 600,
  ringSlowEverySec: 120,
  /** Nobody took it by now: the first people on call, on every channel; the alert is marked unanswered. */
  onCallAfterSec: 60,
  /** Still nobody: the people after them (or the admins when there is no one after them). */
  nextRankAfterSec: 120,
  /** The voice-call step (K0b decides how calls are carried). Off until then. */
  callAfterSec: null as number | null,
  /** The sweep that drives the ladder runs this often (restart-safe: the state is in the database). */
  tickSec: 5,
} as const;

/** What a shift holds: SOS and safety alerts, or the cash handed in at the end of the day. */
export const OnCallDesk = z.enum(['sos', 'cash']);
export type OnCallDesk = z.infer<typeof OnCallDesk>;

/** Who rings the desk first, before anyone on call: the staff roles that answer alerts. */
export const ON_CALL_RING_ROLES = ['dispatcher', 'support', 'admin'] as const;
/** Who may change the roster. */
export const ON_CALL_EDIT_ROLES = ['admin'] as const;
/** Who may read it (every staff desk: they need to know whom to call). */
export const ON_CALL_READ_ROLES = [
  'admin',
  'dispatcher',
  'support',
  'finance',
  'field_ops',
] as const;

export const OnCallShift = z.object({
  id: z.string(),
  cityId: z.string(),
  desk: OnCallDesk,
  personId: z.string(),
  /** 1 is reached first, 2 after them. */
  rank: z.number().int().min(1).max(2),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  createdById: z.string(),
  createdAt: z.coerce.date(),
  /** Taken off the roster early (the row stays for the record). */
  endedAt: z.coerce.date().nullable(),
});
export type OnCallShift = z.infer<typeof OnCallShift>;

export const OnCallShiftRow = OnCallShift.extend({
  /** "علي ح." (logged vault read); null when the vault has no name. */
  displayName: z.string().nullable(),
  /** On call at the moment of the read. */
  now: z.boolean(),
});
export type OnCallShiftRow = z.infer<typeof OnCallShiftRow>;

/** Longest single shift (a week covers a Friday–Saturday weekend with room to spare). */
export const ON_CALL_MAX_SHIFT_HOURS = 24 * 7;

export const OnCallListInput = z.object({
  cityId: z.string().min(1).max(40),
  /** Shifts that end after `from` and start before `to` (default: now to 7 days ahead). */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type OnCallListInput = z.input<typeof OnCallListInput>;

export const OnCallAddInput = z
  .object({
    cityId: z.string().min(1).max(40),
    desk: OnCallDesk,
    personId: z.string().min(1).max(80),
    rank: z.number().int().min(1).max(2),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((v) => v.endsAt.getTime() > v.startsAt.getTime(), {
    message: 'ends_before_start',
    path: ['endsAt'],
  })
  .refine((v) => v.endsAt.getTime() - v.startsAt.getTime() <= ON_CALL_MAX_SHIFT_HOURS * 3_600_000, {
    message: 'shift_too_long',
    path: ['endsAt'],
  });
export type OnCallAddInput = z.infer<typeof OnCallAddInput>;

export const OnCallEndInput = z.object({ id: z.string().min(1).max(80) });
export type OnCallEndInput = z.infer<typeof OnCallEndInput>;

/** Who is reached right now, per desk and rank: the Today strip and the roster page's top line. */
export const OnCallNow = z.object({
  cityId: z.string(),
  desk: OnCallDesk,
  /** Rank 1 then rank 2; empty when nobody is on the roster. */
  people: z.array(
    z.object({
      personId: z.string(),
      rank: z.number().int(),
      displayName: z.string().nullable(),
      until: z.coerce.date(),
    }),
  ),
  /** Nobody on call: the admins are reached instead (shown in red). */
  fallbackToAdmins: z.boolean(),
});
export type OnCallNow = z.infer<typeof OnCallNow>;

export const OnCallNowInput = z.object({ cityId: z.string().min(1).max(40) });
export type OnCallNowInput = z.infer<typeof OnCallNowInput>;

/** A staff member who can be put on call (the roster form's list). */
export const OnCallStaff = z.object({
  personId: z.string(),
  displayName: z.string().nullable(),
  roles: z.array(z.string()),
});
export type OnCallStaff = z.infer<typeof OnCallStaff>;

/** The kinds of alert the ladder carries. */
export const AlertKind = z.enum(['sos', 'safety_report', 'sweep_alert', 'pin_alert']);
export type AlertKind = z.infer<typeof AlertKind>;

/** One step of an alert's ladder, as the Console shows it on the incident. */
export const LadderStep = z.object({
  at: z.coerce.date(),
  /** `ring`: the desk again (push); `on_call_1` / `on_call_2`: the people on call; `admins`: nobody on the roster. */
  step: z.enum(['ring', 'on_call_1', 'on_call_2', 'admins']),
  count: z.number().int(),
});
export type LadderStep = z.infer<typeof LadderStep>;

export const AlertLadder = z.object({
  alertId: z.string(),
  kind: AlertKind,
  cityId: z.string(),
  openedAt: z.coerce.date(),
  /** Nobody took it within `onCallAfterSec`; cleared when someone does. */
  unanswered: z.boolean(),
  takenAt: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  rings: z.number().int(),
  steps: z.array(LadderStep),
});
export type AlertLadder = z.infer<typeof AlertLadder>;

export const AlertLadderInput = z.object({ alertId: z.string().min(1).max(80) });
export type AlertLadderInput = z.infer<typeof AlertLadderInput>;

// ─────────────── the port the safety module calls (agreed with lane A, 2026-10-07) ───────────────

/** What safety hands over when an incident opens (ids only; names stay in the vault). */
export interface IncidentForPaging {
  incidentId: string;
  kind: AlertKind;
  cityId: string;
  zoneKey: string | null;
  orderId: string | null;
  rideId: string | null;
  tripId: string | null;
  createdAt: Date;
}

/** Who to page first. Never empty while the city has any dispatcher or admin. */
export interface PagePlan {
  step: 'ring';
  staffPersonIds: string[];
  /** Nobody took it by then → the ladder reaches the people on call. */
  ackWithinSec: number;
  /** `roster`: from the staff roles; `fallback_all_dispatchers` only if the roster read failed. */
  source: 'roster' | 'fallback_all_dispatchers';
}

export interface OnCallPort {
  firstPage(incident: IncidentForPaging): Promise<PagePlan>;
}

/** `onCall.*` behind `ctx.onCall` (`modules/on-call`). */
export interface OnCallServicePort {
  list(actor: Actor, input: z.output<typeof OnCallListInput>): Promise<OnCallShiftRow[]>;
  now(actor: Actor, input: z.output<typeof OnCallNowInput>): Promise<OnCallNow[]>;
  add(actor: Actor, input: z.output<typeof OnCallAddInput>): Promise<OnCallShiftRow>;
  end(actor: Actor, input: z.output<typeof OnCallEndInput>): Promise<OnCallShiftRow>;
  ladder(actor: Actor, input: z.output<typeof AlertLadderInput>): Promise<AlertLadder | null>;
  staff(actor: Actor): Promise<OnCallStaff[]>;
}
