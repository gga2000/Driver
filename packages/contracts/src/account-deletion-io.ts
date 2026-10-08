import { z } from 'zod';

/**
 * Account deletion (W7, REL-01; docs/api/account-deletion.md). A customer deletes his own account
 * from حسابي: the app reads what stands in the way (`check`), sends a code to his own number
 * (`start`) and deletes with that code (`confirm`). Identities, saved places, photos and voice notes
 * are erased; what ties a location to him is blurred; money records and the vault access log stay,
 * under an id that no longer leads to a name or a number.
 */

/** Why the account can't be deleted yet. Each one names what the person does about it. */
export const DeletionBlockerKind = z.enum([
  /** A food order, errand, parcel or ride that hasn't finished. */
  'open_order',
  /** A الرجعة seat or a ride request still booked or waiting. */
  'open_booking',
  /** A خطوط subscription still running. */
  'active_subscription',
  /** Money in his wallet: spend it first (or support pays it out). */
  'wallet_balance',
  /** He owes us (an unpaid fee): pay first. */
  'wallet_owes',
  /** He runs a household with other members or money in it. */
  'household',
  /** He works or worked with us (driver, courier, restaurant, staff): support closes these. */
  'work_role',
]);
export type DeletionBlockerKind = z.infer<typeof DeletionBlockerKind>;

export const DeletionBlocker = z.object({
  kind: DeletionBlockerKind,
  /** How many (open orders, bookings), when it helps to say. */
  count: z.number().int().nonnegative().optional(),
  /** The amount, for the wallet blockers (always positive). */
  amountIqd: z.number().int().nonnegative().optional(),
});
export type DeletionBlocker = z.infer<typeof DeletionBlocker>;

export const DeletionCheckView = z.object({
  /** False while the `ACCOUNT_DELETION` switch is off: the screen sends him to support. */
  available: z.boolean(),
  blockers: z.array(DeletionBlocker),
  /** Points he loses (the wallet must be empty; points can't be paid out). */
  points: z.number().int().nonnegative(),
});
export type DeletionCheckView = z.infer<typeof DeletionCheckView>;

export const DeletionStartOutput = z.object({ phoneMasked: z.string(), expiresAt: z.coerce.date(), resendAfterSec: z.number().int().nonnegative() });
export type DeletionStartOutput = z.infer<typeof DeletionStartOutput>;

export const DeletionConfirmInput = z.object({ code: z.string().regex(/^\d{6}$/) });
export type DeletionConfirmInput = z.infer<typeof DeletionConfirmInput>;

export const DeletionConfirmOutput = z.object({ deletedAt: z.coerce.date() });
export type DeletionConfirmOutput = z.infer<typeof DeletionConfirmOutput>;
