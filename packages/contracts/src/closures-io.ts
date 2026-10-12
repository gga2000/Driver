import { z } from 'zod';
import type { RoleKind } from './auth.js';
import { CityId, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import { PARTNER_DRIVING_ROLES } from './partner-io.js';

/**
 * N20 «شارع مسدود» (Ali, 2026-10-11): field ops close a street for today on the Console map (two taps, the
 * line follows the street). Every route and arrival time goes around it, customers see it on their map
 * when their order goes around it, couriers get a line on the job, and it opens again by itself at
 * midnight (Baghdad) unless ops open it sooner. No price or fee changes.
 */

/** Who sees today's closures in the Console. */
export const CLOSURE_READ_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'finance', 'admin', 'field_ops'];
/** Who closes and opens streets: field ops on the ground, dispatchers on shift, Ali. */
export const CLOSURE_EDIT_ROLES: readonly RoleKind[] = ['admin', 'field_ops', 'dispatcher'];

/** Who reports a closed street from the road (Ali, 2026-10-12: "or the courier points them out"). */
export const CLOSURE_REPORT_ROLES: readonly RoleKind[] = PARTNER_DRIVING_ROLES;

/**
 * A courier's report routes nothing on its own: ops confirm it on the Console, or a second courier's
 * report of the same stretch confirms it; unconfirmed, it drops after `reportLiveMs`.
 */
export const CLOSURE_REPORT_RULES = {
  /** An unconfirmed report stays on the Console this long. */
  reportLiveMs: 2 * 60 * 60_000,
  /** The stretch reported, along his way: starting past the 30 m a trip may touch a closure at (so his own road bends too). */
  aheadFromM: 40,
  aheadToM: 190,
  /** Two reports whose stretches come this close are the same street. */
  sameStreetM: 40,
  /** Reports one person can make in a day (Baghdad). */
  perDay: 5,
  /** The same person reporting the same street again within this changes nothing. */
  againMs: 60 * 60_000,
} as const;

export const ClosureSource = z.enum(['ops', 'courier']);
export type ClosureSource = z.infer<typeof ClosureSource>;

export const CLOSURE_LIMITS = {
  /** Points in a closed stretch (the road between two taps, simplified). */
  maxPoints: 400,
  /** A closure longer than this is a district, not a street: ask ops to split it. */
  maxLengthM: 3_000,
  /** Shorter than this is a tap by mistake. */
  minLengthM: 20,
  nameMax: 60,
} as const;

/** Why the street is closed: works (أشغال), a funeral tent (عزا), water (مي), anything else (غيره). */
export const ClosureReason = z.enum(['works', 'funeral', 'water', 'other']);
export type ClosureReason = z.infer<typeof ClosureReason>;

/** A closed street as everyone else sees it (customer map, courier's job, Console list). */
export const ClosedStreet = z.object({
  id: z.string(),
  path: z.array(LatLng).min(2),
  reason: ClosureReason,
  /** What ops called it («شارع المستشفى»); null = no name (show «شارع مسدود»). */
  nameAr: z.string().nullable(),
  endsAt: z.coerce.date(),
});
export type ClosedStreet = z.infer<typeof ClosedStreet>;

/** A closed street a route was sent around, and the whole minutes the way around adds (0 = under a minute). */
export const AvoidedStreet = ClosedStreet.extend({ extraMin: z.number().int().nonnegative() });
export type AvoidedStreet = z.infer<typeof AvoidedStreet>;

/** A closure in the Console: who closed it, how long it is, and whether it is still closed. */
export const ClosureView = ClosedStreet.extend({
  cityId: CityId,
  lengthM: z.number().int().nonnegative(),
  startsAt: z.coerce.date(),
  closedByName: z.string().nullable(),
  openedAt: z.coerce.date().nullable(),
  openedByName: z.string().nullable(),
  /** Still closed now (not opened early, not past its end). */
  active: z.boolean(),
  /** ops = closed on the Console; courier = reported from the road. */
  source: ClosureSource,
  /** A courier's report: false while it waits for ops (routes nothing); ops closures are always true. */
  confirmed: z.boolean(),
  /** Who confirmed a courier's report (ops, or the second courier who reported it); null otherwise. */
  confirmedByName: z.string().nullable(),
});
export type ClosureView = z.infer<typeof ClosureView>;

export const ClosuresInput = z.object({ cityId: CityId });
export type ClosuresInput = z.infer<typeof ClosuresInput>;

/** The road between the two taps, for the Console to draw before ops confirm. */
export const SnapClosureInput = z.object({ cityId: CityId, from: LatLng, to: LatLng });
export type SnapClosureInput = z.infer<typeof SnapClosureInput>;

export const SnappedClosure = z.object({
  path: z.array(LatLng).min(2),
  lengthM: z.number().int().nonnegative(),
  /** road = it follows the street (OSRM); estimated = a straight line between the taps (no road data). */
  basis: z.enum(['road', 'estimated']),
});
export type SnappedClosure = z.infer<typeof SnappedClosure>;

export const CloseStreetInput = z.object({
  cityId: CityId,
  path: z.array(LatLng).min(2).max(CLOSURE_LIMITS.maxPoints),
  reason: ClosureReason,
  nameAr: z.string().trim().max(CLOSURE_LIMITS.nameMax).nullable().default(null),
  /** Opens again at this time today; absent = midnight (Baghdad). Never later than the next midnight. */
  until: z.coerce.date().optional(),
});
export type CloseStreetInput = z.input<typeof CloseStreetInput>;

export const OpenStreetInput = z.object({ id: z.string().min(1) });
export type OpenStreetInput = z.infer<typeof OpenStreetInput>;

/** Ops confirm a courier's report: every route goes around it until midnight. */
export const ConfirmClosureInput = z.object({ id: z.string().min(1) });
export type ConfirmClosureInput = z.infer<typeof ConfirmClosureInput>;

/**
 * «الشارع مسدود قدامي», from the courier's job. Only why: the server takes where from his own live job
 * road (his last fix toward his next stop), never from a point the app sends.
 */
/** `cityId` is ignored: the server takes the city from his job (kept optional for older apps). */
export const ReportClosureInput = z.object({ cityId: CityId.optional(), reason: ClosureReason });
export type ReportClosureInput = z.infer<typeof ReportClosureInput>;

/** What the courier sees after reporting: thanks, and whether it now counts (his was the second report). */
export const ReportClosureResult = z.object({ id: z.string(), confirmed: z.boolean() });
export type ReportClosureResult = z.infer<typeof ReportClosureResult>;

export interface ClosuresPort {
  list(input: ClosuresInput): Promise<ClosureView[]>;
  snap(input: SnapClosureInput): Promise<SnappedClosure>;
  close(actor: Actor, input: z.infer<typeof CloseStreetInput>): Promise<ClosureView>;
  open(actor: Actor, input: OpenStreetInput): Promise<ClosureView>;
  confirm(actor: Actor, input: ConfirmClosureInput): Promise<ClosureView>;
  report(actor: Actor, input: ReportClosureInput): Promise<ReportClosureResult>;
}
