import { z } from 'zod';
import { LatLng } from './common.js';

/**
 * N20 «شارع مسدود»: what the apps see of a closed street (the customer's map, the courier's job). Kept apart
 * from closures-io (Console and ops schemas, reached through `@driver/contracts/closures`) so the phone
 * bundles carry only this.
 */

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
