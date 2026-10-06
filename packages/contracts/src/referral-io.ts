import { z } from 'zod';
import { Iqd } from './common.js';
import type { Actor } from './identity-io.js';

/**
 * Invite as a gift (joy g2). The money is the referral rule that already exists (decisions §1,
 * `MoneyRules.referral`): `pointsPerSide` points to the friend and to the inviter once the friend
 * completes his `unlockOnOrder`-th cash order of at least `minOrderIqd`, at most `monthlyCap` friends
 * a month for the inviter. The apps only say these numbers; the ledger posts them.
 */
export const InviteRule = z.object({
  pointsPerSide: z.number().int().positive(),
  /** What one point is worth when spent (100 points = 1,000 دينار → 10). */
  pointValueIqd: Iqd.positive(),
  minOrderIqd: Iqd.min(0),
  unlockOnOrder: z.number().int().positive(),
  monthlyCap: z.number().int().positive(),
});
export type InviteRule = z.infer<typeof InviteRule>;

/** Invite codes: 6 characters with no look-alikes (no 0/O, 1/I/L). */
export const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_LENGTH = 6;

/** A code as typed or linked: case and spaces don't matter. Null when it can't be a code. */
export function normalizeInviteCode(raw: string): string | null {
  const code = raw.replace(/\s+/g, '').toUpperCase();
  if (code.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of code) if (!INVITE_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** The path of the invite landing page on the customer web app (`/i/<code>`). */
export function invitePath(code: string): string {
  return `/i/${code}`;
}

/**
 * Why a referral will not pay (decisions §1, the fingerprint on device + phone + home place): the friend
 * shares one with the inviter (`shared_*`) or with someone who already earned a referral (`*_earned`).
 * Recorded on the referral; the person never sees an error, the inviter's list says «ما انحسبت».
 */
export const ReferralBlockReason = z.enum(['shared_device', 'shared_phone', 'shared_home', 'device_earned', 'phone_earned', 'home_earned']);
export type ReferralBlockReason = z.infer<typeof ReferralBlockReason>;

/** One friend on the inviter's list: still on the way, counted (paid), or not counted (blocked). */
export const InviteFriend = z.object({
  /** The friend's first name (logged vault read); null when none was set. */
  firstName: z.string().nullable(),
  state: z.enum(['waiting', 'counted', 'not_counted']),
});
export type InviteFriend = z.infer<typeof InviteFriend>;

/** `referral.mine`: my code, the rule in numbers, and how my invitations are going. */
export const InviteView = z.object({
  code: z.string(),
  /** `/i/<code>`: the app makes it absolute with the public web origin. */
  path: z.string(),
  rule: InviteRule,
  /** Friends who accepted my invitation. */
  invited: z.number().int().min(0),
  /** Friends whose invitation already paid (my side of the points arrived). */
  rewarded: z.number().int().min(0),
  /** My friends, newest first: on the way, counted, or «ما انحسبت» (the fingerprint said no). */
  friends: z.array(InviteFriend),
});
export type InviteView = z.infer<typeof InviteView>;

export const InvitePreviewInput = z.object({ code: z.string().min(1).max(16) });
export type InvitePreviewInput = z.input<typeof InvitePreviewInput>;

/** `referral.preview` (public): what the landing page says before the friend signs in. */
export const InvitePreview = z.object({
  valid: z.boolean(),
  /** The inviter's first name (logged vault read); null when he set none or the code is unknown. */
  inviterFirstName: z.string().nullable(),
  rule: InviteRule,
});
export type InvitePreview = z.infer<typeof InvitePreview>;

export const ClaimInviteInput = z.object({ code: z.string().min(1).max(16) });
export type ClaimInviteInput = z.input<typeof ClaimInviteInput>;

export const ClaimInviteOutput = z.object({
  ok: z.literal(true),
  inviterFirstName: z.string().nullable(),
  rule: InviteRule,
});
export type ClaimInviteOutput = z.infer<typeof ClaimInviteOutput>;

export interface ReferralsPort {
  mine(actor: Actor): Promise<InviteView>;
  preview(input: InvitePreviewInput): Promise<InvitePreview>;
  /**
   * The friend accepts: once per person, never his own code, and only before his first order
   * (`invite_invalid`, `invite_own`, `invite_already_claimed`, `invite_not_new`).
   */
  claim(actor: Actor, input: ClaimInviteInput): Promise<ClaimInviteOutput>;
}
