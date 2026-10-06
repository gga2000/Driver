import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES } from '@driver/contracts';
import { t } from '@driver/i18n';
import { claimProblem, inviteMessage, pointsWorthIqd, progressCopy, ruleLines } from './invite';

/** The rule exactly as the server gives it (`inviteRuleOf(AZIZIYAH_MONEY_RULES)`). */
const rule = {
  pointsPerSide: AZIZIYAH_MONEY_RULES.referral.pointsPerSide,
  pointValueIqd: AZIZIYAH_MONEY_RULES.points.pointValueIqd,
  minOrderIqd: AZIZIYAH_MONEY_RULES.referral.minOrderIqd,
  unlockOnOrder: AZIZIYAH_MONEY_RULES.referral.unlockOnQualifyingOrder,
  monthlyCap: AZIZIYAH_MONEY_RULES.referral.monthlyCapPerReferrer,
};

describe('invite as a gift (joy g2)', () => {
  it('200 points each, worth 2,000 دينار: never «2,000 points»', () => {
    expect(pointsWorthIqd(rule)).toBe(2000);
    const [gift, when, cap] = ruleLines(rule).map((c) => t(c.key, c.params));
    expect(gift).toContain('200 نقطة');
    expect(gift).toContain('2,000 دينار');
    expect(gift).not.toContain('2,000 نقطة');
    expect(when).toContain('10,000 دينار');
    expect(when).toContain('ثاني');
    expect(cap).toContain('10');
  });

  it('another unlock order reads with its number', () => {
    expect(ruleLines({ ...rule, unlockOnOrder: 3 })[1]!.key).toBe('invite.rule_when_nth');
  });

  it('the WhatsApp text carries the link and the code', () => {
    const msg = inviteMessage({ url: 'https://driver.iq/i/K7Q2MX', code: 'K7Q2MX', rule });
    const text = t(msg.key, msg.params);
    expect(text).toContain('https://driver.iq/i/K7Q2MX');
    expect(text).toContain('K7Q2MX');
    expect(text).toContain('200 نقطة');
  });

  it('progress says nothing yet, invited, or paid', () => {
    expect(progressCopy(0, 0).key).toBe('invite.progress_none');
    expect(progressCopy(3, 0)).toEqual({ key: 'invite.progress_invited', params: { n: 3 } });
    expect(progressCopy(3, 1)).toEqual({ key: 'invite.progress_rewarded', params: { n: 3, m: 1 } });
  });

  it('claim refusals have their own words; anything else is a retry', () => {
    expect(claimProblem('invite_own')).toBe('error.invite_own');
    expect(claimProblem('network')).toBeNull();
    expect(claimProblem(null)).toBeNull();
  });
});
