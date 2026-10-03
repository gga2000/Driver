import type { MerchantStaffRole, StaffMember } from '@driver/contracts';

/**
 * Staff list logic (pure, tested): who shows where, and what the owner may do to whom.
 */

/** Active team (owners first, you first among them) and invites still waiting for a first sign-in. */
export function splitStaff(list: readonly StaffMember[]): { team: StaffMember[]; pending: StaffMember[] } {
  const rank = (s: StaffMember) => (s.you ? 0 : s.role === 'merchant_owner' ? 1 : 2);
  const team = list.filter((s) => !s.pending).sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? '', 'ar'));
  const pending = list.filter((s) => s.pending);
  return { team, pending };
}

/** The last owner can't be demoted or removed (API: `staff_last_owner`); say so before trying. */
export function isLastOwner(list: readonly StaffMember[], personId: string): boolean {
  const owners = list.filter((s) => s.role === 'merchant_owner');
  return owners.length <= 1 && owners[0]?.personId === personId;
}

export function roleKey(role: MerchantStaffRole): 'merchant.staff.role_owner' | 'merchant.staff.role_staff' {
  return role === 'merchant_owner' ? 'merchant.staff.role_owner' : 'merchant.staff.role_staff';
}

/** "0770 ••• 4567" (the number the owner typed), else the vault mask; LTR-isolated inside Arabic. */
export function invitePhone(s: Pick<StaffMember, 'phoneHint' | 'phoneMasked'>): string | null {
  const p = s.phoneHint ?? s.phoneMasked;
  return p ? `\u2066${p}\u2069` : null;
}

/** Whole minutes until a resend is allowed (0 = now). */
export function resendWaitMinutes(s: Pick<StaffMember, 'resendAfter'>, now: number): number {
  if (!s.resendAfter) return 0;
  return Math.max(0, Math.ceil((s.resendAfter.getTime() - now) / 60_000));
}
