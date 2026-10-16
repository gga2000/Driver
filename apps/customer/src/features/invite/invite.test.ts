import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES } from '@driver/contracts';
import { t } from '@driver/i18n';
import { claimProblem, friendLabel, inviteMessage, pointsWorthIqd, progressCopy, ruleLines } from './invite';

/** The rule as the server gives it once the reward is switched on (`inviteRuleOf`, M-5 approved). */
const rule = {
  rewardsOn: true,
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

  it('the friend reads the same rule from his side, without the inviter’s monthly cap', () => {
    const lines = ruleLines(rule, 'friend').map((c) => t(c.key, c.params));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('لصديقك');
    expect(lines[0]).toContain('2,000 دينار');
    expect(lines[1]).toContain('إلك');
  });

  it('another unlock order reads with its number', () => {
    expect(ruleLines({ ...rule, unlockOnOrder: 3 })[1]!.key).toBe('invite.rule_when_nth');
  });

  it('while the reward is switched off (THIN-18), nothing promises points', () => {
    const off = { ...rule, rewardsOn: AZIZIYAH_MONEY_RULES.referral.enabled };
    expect(off.rewardsOn).toBe(false);
    expect(ruleLines(off)).toEqual([]);
    expect(ruleLines(off, 'friend')).toEqual([]);
    const msg = inviteMessage({ url: 'https://driver.iq/i/K7Q2MX', code: 'K7Q2MX', rule: off });
    const text = t(msg.key, msg.params);
    expect(text).toContain('K7Q2MX');
    expect(text).not.toContain('نقطة');
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

  it('a blocked friend reads «ما انحسبت», nothing more', () => {
    expect(t(friendLabel('not_counted'))).toBe('ما انحسبت');
    expect(t(friendLabel('counted'))).toBe('انحسبت');
    expect(t(friendLabel('waiting'))).toBe('بعده');
  });

  it('claim refusals have their own words; anything else is a retry', () => {
    expect(claimProblem('invite_own')).toBe('error.invite_own');
    expect(claimProblem('network')).toBeNull();
    expect(claimProblem(null)).toBeNull();
  });
});
