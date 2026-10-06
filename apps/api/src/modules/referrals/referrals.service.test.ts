import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, DriverError, INVITE_CODE_ALPHABET } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryReferralsRepository } from './referrals.repository.js';
import { inviteRuleOf, newInviteCode, ReferralsService } from './referrals.service.js';

const actor = (personId: string) => ({ personId, sessionId: `s_${personId}` });

function harness(opts: { placed?: Record<string, number>; lines?: Record<string, Array<{ type: string; toAccount: string; memo?: string }>> } = {}) {
  const repo = new InMemoryReferralsRepository();
  const reads: Array<{ ids: readonly string[]; accessor: string; purpose: string }> = [];
  const names = {
    firstNamesFor: async (ids: readonly string[], accessor: string, purpose: string) => {
      reads.push({ ids, accessor, purpose });
      return Object.fromEntries(ids.map((id) => [id, id === 'ali' ? 'علي' : null]));
    },
  };
  const ledger = { eventsFor: async (account: string) => opts.lines?.[account] ?? [] };
  let seed = 7;
  // A tiny deterministic generator: the codes are stable across runs.
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const service = new ReferralsService(repo, names, ledger, AZIZIYAH_MONEY_RULES, random, new FakeClock('2026-10-07T09:00:00Z'));
  service.bindOrders({ placedCount: async (id) => opts.placed?.[id] ?? 0 });
  return { service, repo, reads };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

describe('invite as a gift (joy g2)', () => {
  it('the rule is the money rules’ referral rule, nothing new', () => {
    expect(inviteRuleOf(AZIZIYAH_MONEY_RULES)).toEqual({ pointsPerSide: 200, pointValueIqd: 10, minOrderIqd: 10_000, unlockOnOrder: 2, monthlyCap: 10 });
  });

  it('codes are 6 characters without look-alikes', () => {
    const c = newInviteCode(() => 0);
    expect(c).toBe('222222');
    const r = newInviteCode((n) => n - 1);
    expect(r).toHaveLength(6);
    for (const ch of r) expect(INVITE_CODE_ALPHABET).toContain(ch);
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('one code per person, stable on repeat, with the path and the rule', async () => {
    const { service } = harness();
    const a = await service.mine(actor('ali'));
    const b = await service.mine(actor('ali'));
    expect(a.code).toBe(b.code);
    expect(a.path).toBe(`/i/${a.code}`);
    expect(a.rule.pointsPerSide).toBe(200);
    expect(a).toMatchObject({ invited: 0, rewarded: 0 });
    expect((await service.mine(actor('sara'))).code).not.toBe(a.code);
  });

  it('a new friend accepts once; the inviter is then sent with his orders', async () => {
    const { service, reads } = harness();
    const { code: c } = await service.mine(actor('ali'));
    const res = await service.claim(actor('zaid'), { code: c.toLowerCase() });
    expect(res).toMatchObject({ ok: true, inviterFirstName: 'علي' });
    expect(reads.at(-1)).toMatchObject({ ids: ['ali'], accessor: 'zaid', purpose: 'invite_claim' });
    expect(await service.referrerOf('zaid')).toBe('ali');
    expect(await service.referrerOf('ali')).toBeNull();
    // A retry of the same claim answers the same way.
    expect((await service.claim(actor('zaid'), { code: c })).ok).toBe(true);
    expect((await service.mine(actor('ali'))).invited).toBe(1);
  });

  it('refuses a wrong code, your own code, a second inviter and someone who already ordered', async () => {
    const { service } = harness({ placed: { old: 3 } });
    const { code: ali } = await service.mine(actor('ali'));
    const { code: sara } = await service.mine(actor('sara'));
    expect(await code(service.claim(actor('zaid'), { code: 'NOPE' }))).toBe('invite_invalid');
    expect(await code(service.claim(actor('zaid'), { code: 'ZZZZZZ' }))).toBe('invite_invalid');
    expect(await code(service.claim(actor('ali'), { code: ali }))).toBe('invite_own');
    expect(await code(service.claim(actor('old'), { code: ali }))).toBe('invite_not_new');
    await service.claim(actor('zaid'), { code: ali });
    expect(await code(service.claim(actor('zaid'), { code: sara }))).toBe('invite_already_claimed');
  });

  it('the public preview greets the friend by the inviter’s first name', async () => {
    const { service, reads } = harness();
    const { code: c } = await service.mine(actor('ali'));
    expect(await service.preview({ code: c })).toMatchObject({ valid: true, inviterFirstName: 'علي' });
    expect(reads.at(-1)).toMatchObject({ accessor: 'ali', purpose: 'invite_preview' });
    expect(await service.preview({ code: 'nothing' })).toMatchObject({ valid: false, inviterFirstName: null });
  });

  it('rewarded counts the inviter’s own referral lines', async () => {
    const lines = {
      'points:ali': [
        { type: 'referral_bonus', toAccount: 'points:ali', memo: 'referrer_of:zaid' },
        { type: 'referral_bonus', toAccount: 'points:ali', memo: 'referee' },
        { type: 'points_earned', toAccount: 'points:ali' },
      ],
    };
    const { service } = harness({ lines });
    expect((await service.mine(actor('ali'))).rewarded).toBe(1);
  });
});
