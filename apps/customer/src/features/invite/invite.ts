import type { InviteRule } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { amountParam } from '@/lib/money';

/**
 * Invite as a gift (joy g2). Every number here is the server's referral rule (`referral.mine` /
 * `referral.preview` → `InviteRule`, the ledger's decisions §1 rule): the app only words it. Never a
 * hard-coded «2,000 points»: 200 points per side, which are worth 2,000 دينار when spent.
 */

export interface Copy {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** What the points are worth in دينار when spent (200 × 10 = 2,000). */
export function pointsWorthIqd(rule: InviteRule): number {
  return rule.pointsPerSide * rule.pointValueIqd;
}

/**
 * The rule in plain lines: what each side gets (points and what they are worth) and when it arrives
 * (the friend's Nth cash order of at least the minimum); the inviter also reads the monthly cap. The
 * friend on the landing page reads the same rule from his side («إلك و200 لصديقك»، «ثاني طلب كاش إلك»).
 */
export function ruleLines(rule: InviteRule, side: 'inviter' | 'friend' = 'inviter'): Copy[] {
  const friend = side === 'friend';
  const second = rule.unlockOnOrder === 2;
  const lines: Copy[] = [
    { key: friend ? 'invite.rule_gift_friend' : 'invite.rule_gift', params: { points: amountParam(rule.pointsPerSide), amount: amountParam(pointsWorthIqd(rule)) } },
    {
      key: friend ? (second ? 'invite.rule_when_second_friend' : 'invite.rule_when_nth_friend') : second ? 'invite.rule_when_second' : 'invite.rule_when_nth',
      params: { n: rule.unlockOnOrder, amount: amountParam(rule.minOrderIqd) },
    },
  ];
  if (!friend) lines.push({ key: 'invite.rule_cap', params: { n: rule.monthlyCap } });
  return lines;
}

/** The WhatsApp text in the sender's name: a treat, not a recruitment pitch. */
export function inviteMessage(input: { url: string; code: string; rule: InviteRule }): Copy {
  return { key: 'invite.message', params: { url: input.url, code: input.code, points: amountParam(input.rule.pointsPerSide), amount: amountParam(pointsWorthIqd(input.rule)) } };
}

/** How the invitations are going: nothing yet, invited only, or some already paid. */
export function progressCopy(invited: number, rewarded: number): Copy {
  if (invited === 0) return { key: 'invite.progress_none' };
  if (rewarded === 0) return { key: 'invite.progress_invited', params: { n: invited } };
  return { key: 'invite.progress_rewarded', params: { n: invited, m: rewarded } };
}

/**
 * A friend on my list (decisions §1): «بعده» while on the way, «انحسبت» once the points came, and
 * «ما انحسبت» when the fingerprint stopped it (a shared device, phone or home) — never more detail.
 */
export function friendLabel(state: 'waiting' | 'counted' | 'not_counted'): MessageKey {
  return state === 'counted' ? 'invite.friend_counted' : state === 'not_counted' ? 'invite.friend_not_counted' : 'invite.friend_waiting';
}

export function friendTone(state: 'waiting' | 'counted' | 'not_counted'): 'neutral' | 'success' {
  return state === 'counted' ? 'success' : 'neutral';
}

/** The claim answer the landing page shows for an error code (null = a network problem, retry). */
export function claimProblem(code: string | null): MessageKey | null {
  switch (code) {
    case 'invite_invalid':
    case 'invite_own':
    case 'invite_not_new':
    case 'invite_already_claimed':
      return `error.${code}`;
    default:
      return null;
  }
}
