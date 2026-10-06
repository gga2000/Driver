import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, DriverError, INVITE_CODE_ALPHABET } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryReferralsRepository } from './referrals.repository.js';
import { inviteRuleOf, newInviteCode, ReferralsService } from './referrals.service.js';

const actor = (personId: string) => ({ personId, sessionId: `s_${personId}` });

type Parts = { phoneHash: string | null; deviceMarks: readonly string[]; homeMarks: readonly string[] };
/** Everyone has their own phone, device and home unless a test says otherwise. */
const own = (id: string): Parts => ({ phoneHash: `ph_${id}`, deviceMarks: [`dev_${id}`], homeMarks: [`home_${id}`] });

function harness(opts: { placed?: Record<string, number>; lines?: Record<string, Array<{ type: string; toAccount: string; memo?: string }>> } = {}) {
  const repo = new InMemoryReferralsRepository();
  const reads: Array<{ ids: readonly string[]; accessor: string; purpose: string }> = [];
  const names = {
    firstNamesFor: async (ids: readonly string[], accessor: string, purpose: string) => {
      reads.push({ ids, accessor, purpose });
      return Object.fromEntries(ids.map((id) => [id, id === 'ali' ? 'علي' : null]));
    },
  };
  const groups = new Set<string>();
  const ledger = { eventsFor: async (account: string) => opts.lines?.[account] ?? [], hasGroup: async (id: string) => groups.has(id) };
  const parts = new Map<string, Parts>();
  const fingerprint = { partsOf: async (id: string) => parts.get(id) ?? own(id) };
  let seed = 7;
  // A tiny deterministic generator: the codes are stable across runs.
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const service = new ReferralsService(repo, names, ledger, AZIZIYAH_MONEY_RULES, random, new FakeClock('2026-10-07T09:00:00Z'), fingerprint);
  service.bindOrders({ placedCount: async (id) => opts.placed?.[id] ?? 0 });
  return { service, repo, reads, parts, groups };
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

  describe('the fingerprint on device + phone + home place (decisions §1)', () => {
    /** Ali invites Zaid with these fingerprints; returns what the claim, the list and the payout say. */
    async function invite(setup: (h: ReturnType<typeof harness>) => void | Promise<void>) {
      const h = harness();
      await setup(h);
      const { code: c } = await h.service.mine(actor('ali'));
      const claimed = await h.service.claim(actor('zaid'), { code: c });
      return { h, claimed, payout: await h.service.referrerOf('zaid'), row: await h.repo.referralOf('zaid'), list: (await h.service.mine(actor('ali'))).friends };
    }

    it('a friend with his own phone, device and home counts', async () => {
      const r = await invite(() => undefined);
      expect(r.payout).toBe('ali');
      expect(r.row?.blockedReason).toBeNull();
      expect(r.row?.refereeMarks).toEqual(['p:ph_zaid', 'd:dev_zaid', 'h:home_zaid']);
      expect(r.list).toEqual([{ firstName: null, state: 'waiting' }]);
    });

    for (const [name, patch, reason] of [
      ['the same device as the inviter', { deviceMarks: ['dev_ali'] }, 'shared_device'],
      ['the same phone as the inviter', { phoneHash: 'ph_ali' }, 'shared_phone'],
      ['the same home as the inviter', { homeMarks: ['home_ali'] }, 'shared_home'],
    ] as const) {
      it(`blocks ${name}: no points, no error, «ما انحسبت» on the list`, async () => {
        const r = await invite((h) => {
          h.parts.set('zaid', { ...own('zaid'), ...patch });
        });
        expect(r.claimed.ok).toBe(true);
        expect(r.row?.blockedReason).toBe(reason);
        expect(r.row?.blockedAt).toBeInstanceOf(Date);
        expect(r.payout).toBeNull();
        expect(r.list).toEqual([{ firstName: null, state: 'not_counted' }]);
      });
    }

    for (const [name, patch, reason] of [
      ['a device', { deviceMarks: ['dev_hasan'] }, 'device_earned'],
      ['a phone', { phoneHash: 'ph_hasan' }, 'phone_earned'],
      ['a home', { homeMarks: ['home_hasan'] }, 'home_earned'],
    ] as const) {
      it(`blocks ${name} of someone who already earned a referral`, async () => {
        const r = await invite(async (h) => {
          // Sara invited Hasan earlier and it paid.
          const { code: s } = await h.service.mine(actor('sara'));
          await h.service.claim(actor('hasan'), { code: s });
          h.groups.add('referral:hasan');
          h.parts.set('zaid', { ...own('zaid'), ...patch });
        });
        expect(r.row?.blockedReason).toBe(reason);
        expect(r.payout).toBeNull();
      });
    }

    it('a referral that has not paid yet does not block anyone', async () => {
      const r = await invite(async (h) => {
        const { code: s } = await h.service.mine(actor('sara'));
        await h.service.claim(actor('hasan'), { code: s });
        h.parts.set('zaid', { ...own('zaid'), deviceMarks: ['dev_hasan'] });
      });
      expect(r.row?.blockedReason).toBeNull();
      expect(r.payout).toBe('ali');
    });

    it('is checked again at payout: a home shared after the claim stops it, and the block stays', async () => {
      const r = await invite(() => undefined);
      expect(r.payout).toBe('ali');
      r.h.parts.set('zaid', { ...own('zaid'), homeMarks: ['home_ali'] });
      expect(await r.h.service.referrerOf('zaid')).toBeNull();
      expect((await r.h.repo.referralOf('zaid'))?.blockedReason).toBe('shared_home');
      r.h.parts.set('zaid', own('zaid'));
      expect(await r.h.service.referrerOf('zaid')).toBeNull();
    });

    it('once paid, the closed orders keep naming the inviter (the ledger posts once)', async () => {
      const r = await invite(() => undefined);
      r.h.groups.add('referral:zaid');
      r.h.parts.set('zaid', { ...own('zaid'), deviceMarks: ['dev_ali'] });
      expect(await r.h.service.referrerOf('zaid')).toBe('ali');
      expect((await r.h.service.mine(actor('ali'))).friends).toEqual([{ firstName: null, state: 'counted' }]);
    });
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
