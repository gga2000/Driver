import { z } from 'zod';
import type { RoleKind } from './auth.js';
import { CityId, LatLng } from './common.js';
import type { Actor } from './identity-io.js';

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

export interface ClosuresPort {
  list(input: ClosuresInput): Promise<ClosureView[]>;
  snap(input: SnapClosureInput): Promise<SnappedClosure>;
  close(actor: Actor, input: z.infer<typeof CloseStreetInput>): Promise<ClosureView>;
  open(actor: Actor, input: OpenStreetInput): Promise<ClosureView>;
}
