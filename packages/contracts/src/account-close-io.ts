import { z } from 'zod';
import { RoleKind } from './auth.js';
import type { Actor } from './identity-io.js';

/**
 * Account deletion for people who work with us (docs/api/account-close.md). A courier, driver, fleet
 * owner, field agent or restaurant owner/staff asks from his own app («احذف حسابي»): that opens a
 * support case of kind `deletion`. An admin closes the account from the Console once nothing stands in
 * the way: his identity (name, number, contacts) and his document, selfie and photo files are erased;
 * the money records and the trips stay, under an id that no longer leads to a name or a number.
 */

/** Roles whose holders close through the Console (customers have their own in-app deletion). */
export const CLOSABLE_ROLES = ['courier', 'shopper', 'driver', 'intercity_driver', 'khat_driver', 'fleet_owner', 'field_ops', 'merchant_staff', 'merchant_owner'] as const satisfies readonly RoleKind[];

export const RequestDeletionInput = z.object({
  /** What he wants to tell us (optional). */
  note: z.string().trim().max(500).optional(),
});
export type RequestDeletionInput = z.infer<typeof RequestDeletionInput>;

export const RequestDeletionOutput = z.object({
  ticketId: z.string(),
  openedAt: z.coerce.date(),
  /** He had already asked and the case is still open: nothing new was opened. */
  alreadyOpen: z.boolean(),
});
export type RequestDeletionOutput = z.infer<typeof RequestDeletionOutput>;

/** Why the account can't be closed yet. */
export const AccountCloseBlockerKind = z.enum([
  /** Cash he collected and hasn't handed in. */
  'cash_held',
  /** A trip or الرجعة departure he is on that hasn't finished. */
  'open_jobs',
  /** Earnings we owe him (or he owes us), or a store of his with money not settled. */
  'unpaid_settlement',
  /** Money in his own customer wallet. */
  'wallet_balance',
]);
export type AccountCloseBlockerKind = z.infer<typeof AccountCloseBlockerKind>;

export const AccountCloseBlocker = z.object({
  kind: AccountCloseBlockerKind,
  count: z.number().int().nonnegative().optional(),
  /** Always positive; the sign is in the kind's wording. */
  amountIqd: z.number().int().nonnegative().optional(),
});
export type AccountCloseBlocker = z.infer<typeof AccountCloseBlocker>;

export const AccountCloseInput = z.object({ personId: z.string().min(1) });
export type AccountCloseInput = z.infer<typeof AccountCloseInput>;

export const AccountCloseView = z.object({
  personId: z.string(),
  /** Holds (or held) a role closed here; false for plain customers and staff. */
  closable: z.boolean(),
  closedAt: z.coerce.date().nullable(),
  blockers: z.array(AccountCloseBlocker),
});
export type AccountCloseView = z.infer<typeof AccountCloseView>;

export const ACCOUNT_CLOSE_RULES = { noteMin: 5, noteMax: 500 } as const;

export const CloseAccountInput = z.object({
  personId: z.string().min(1),
  /** Why (audited). */
  note: z.string().trim().min(ACCOUNT_CLOSE_RULES.noteMin).max(ACCOUNT_CLOSE_RULES.noteMax),
  /** The deletion case it answers; resolved with the note. */
  ticketId: z.string().optional(),
});
export type CloseAccountInput = z.infer<typeof CloseAccountInput>;

export const CloseAccountOutput = AccountCloseView.extend({
  /** Document, selfie and photo files removed from storage. */
  filesRemoved: z.number().int().nonnegative(),
});
export type CloseAccountOutput = z.infer<typeof CloseAccountOutput>;

/** The Console side (`modules/control-room`). */
export interface AccountClosePort {
  check(actor: Actor, input: AccountCloseInput): Promise<AccountCloseView>;
  close(actor: Actor, input: CloseAccountInput): Promise<CloseAccountOutput>;
}
