import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { harness as identityHarness } from '../identity/test-harness.js';
import { HouseholdsRpc, type HouseholdMonthOrder } from './households.rpc.js';
import { OrgsService } from './orgs.service.js';

async function setup() {
  const id = identityHarness();
  const orgs = new OrgsService(undefined, id.clock);
  const rpc = new HouseholdsRpc(orgs, id.service, id.clock);
  const ali = (await id.login('07712345678')).actor;
  const minar = (await id.login('07712345679')).actor;
  const stranger = (await id.login('07712345670')).actor;
  await id.service.updateProfile(ali, { name: 'علي' });
  await id.service.updateProfile(minar, { name: 'منار' });
  return { id, orgs, rpc, ali, minar, stranger };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

describe('households (domain §12)', () => {
  it('create → the creator is the payer; one household per person', async () => {
    const { rpc, ali } = await setup();
    expect(await rpc.mine(ali)).toBeNull();
    const home = await rpc.create(ali, { name: 'بيت علي', cityId: 'aziziyah' });
    expect(home).toMatchObject({ name: 'بيت علي', myRole: 'payer', pendingApprovals: [] });
    expect(home.members).toEqual([{ personId: ali.personId, name: 'علي', phoneMasked: '+96477*****78', role: 'payer', spendingLimitIqd: null, isMe: true, monthlyBudgetIqd: null, monthSpentIqd: null }]);
    expect(await code(rpc.create(ali, { name: 'ثاني', cityId: 'aziziyah' }))).toBe('household_exists');
  });

  it('two quick taps on create make one household (RDB-05); the second tap gets the same one', async () => {
    const { rpc, ali } = await setup();
    const [a, b] = await Promise.all([rpc.create(ali, { name: 'بيت علي', cityId: 'aziziyah' }), rpc.create(ali, { name: 'بيت علي', cityId: 'aziziyah' })]);
    expect(a.id).toBe(b.id);
    expect((await rpc.create(ali, { name: 'بيت علي', cityId: 'aziziyah' })).id).toBe(a.id);
  });

  it('invite by phone (an existing account or a new pseudonymous person), then set a limit — payer only', async () => {
    const { rpc, ali, minar, id } = await setup();
    const home = await rpc.create(ali, { name: 'بيت علي', cityId: 'aziziyah' });
    const after = await rpc.inviteMember(ali, { householdId: home.id, phone: '0771 234 5679', role: 'orderer', spendingLimitIqd: 25_000 });
    expect(after.members.map((m) => [m.name, m.role, m.spendingLimitIqd])).toEqual([
      ['علي', 'payer', null],
      ['منار', 'orderer', 25_000],
    ]);
    // A number that never signed in becomes a person (vault only), named later by its owner.
    const withKid = await rpc.inviteMember(ali, { householdId: home.id, phone: '07701112233', role: 'member', spendingLimitIqd: null });
    const kid = withKid.members.find((m) => m.phoneMasked === '+96477*****33')!;
    expect(kid).toMatchObject({ name: null, role: 'member' });
    expect(await id.service.personIdByPhone('07701112233')).toBe(kid.personId);
    expect(await code(rpc.inviteMember(ali, { householdId: home.id, phone: '07712345678', role: 'orderer', spendingLimitIqd: null }))).toBe('invalid_input');
    // Members see the household; only the payer changes it.
    expect((await rpc.mine(minar))?.myRole).toBe('orderer');
    expect(await code(rpc.setLimit(minar, { householdId: home.id, personId: minar.personId, spendingLimitIqd: 1_000_000 }))).toBe('household_payer_only');
    expect(await code(rpc.inviteMember(minar, { householdId: home.id, phone: '07712345670', role: 'orderer', spendingLimitIqd: null }))).toBe('household_payer_only');
    expect(await code(rpc.setLimit(ali, { householdId: home.id, personId: ali.personId, spendingLimitIqd: 5_000 }))).toBe('invalid_input');
    const limited = await rpc.setLimit(ali, { householdId: home.id, personId: minar.personId, spendingLimitIqd: 30_000 });
    expect(limited.members.find((m) => m.personId === minar.personId)?.spendingLimitIqd).toBe(30_000);
  });

  it('strangers see nothing and can act on nothing', async () => {
    const { rpc, ali, stranger } = await setup();
    const home = await rpc.create(ali, { name: 'بيت علي', cityId: 'aziziyah' });
    expect(await rpc.mine(stranger)).toBeNull();
    expect(await code(rpc.approvals(stranger, { householdId: home.id }))).toBe('not_household_member');
    expect(await code(rpc.inviteMember(stranger, { householdId: home.id, phone: '07712345670', role: 'orderer', spendingLimitIqd: null }))).toBe('not_household_member');
    expect(await code(rpc.setLimit(stranger, { householdId: home.id, personId: ali.personId, spendingLimitIqd: 1 }))).toBe('not_household_member');
    expect(await code(rpc.approvals(ali, { householdId: 'org_nope' }))).toBe('org_not_found');
  });

  it('approval flow: over-limit request → payer approves once; the requester sees his own, cannot resolve', async () => {
    const { rpc, orgs, ali, minar, stranger, id } = await setup();
    const home = await rpc.create(ali, { name: 'بيت علي', cityId: 'aziziyah' });
    await rpc.inviteMember(ali, { householdId: home.id, phone: '07712345679', role: 'orderer', spendingLimitIqd: 25_000 });
    expect(await orgs.withinLimit(home.id, minar.personId, 32_000)).toBe(false);
    const req = await orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_1', requestedBy: minar.personId, amountIqd: 32_000 });

    const payerView = await rpc.mine(ali);
    expect(payerView?.pendingApprovals).toEqual([
      expect.objectContaining({ id: req.id, requestedByName: 'منار', amountIqd: 32_000, limitIqd: 25_000, state: 'pending', state_ar: 'بانتظار موافقتك', canResolve: true }),
    ]);
    const mineView = await rpc.approvals(minar, { householdId: home.id });
    expect(mineView.map((a) => [a.id, a.canResolve, a.state_ar])).toEqual([[req.id, false, 'بانتظار الموافقة']]);

    expect(await code(rpc.approve(minar, { requestId: req.id }))).toBe('household_payer_only');
    expect(await code(rpc.approve(stranger, { requestId: req.id }))).toBe('not_found');
    expect(await code(rpc.decline(ali, { requestId: 'pay_nope' }))).toBe('not_found');

    const done = await rpc.approve(ali, { requestId: req.id });
    expect(done).toMatchObject({ state: 'approved', state_ar: 'وافقت', canResolve: false });
    expect((await rpc.decline(ali, { requestId: req.id })).state).toBe('approved'); // resolved once
    expect((await rpc.mine(ali))?.pendingApprovals).toEqual([]);
    expect((await rpc.approvals(ali, { householdId: home.id })).map((a) => a.state)).toEqual(['approved']);

    const second = await orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_2', requestedBy: minar.personId, amountIqd: 40_000 });
    expect((await rpc.decline(ali, { requestId: second.id })).state).toBe('declined');
    // Reading member names for the payer is logged against each member read.
    const logs = await id.repo.vaultAccessLogs(minar.personId);
    expect(logs.filter((l) => l.accessorId === ali.personId && l.purpose === 'household_view').length).toBeGreaterThan(0);
  });

  it('w5: an approval carries what was ordered, from where and for where; a failing read leaves it out', async () => {
    const { rpc, orgs, ali, minar } = await setup();
    const home = await rpc.create(ali, { name: 'بيت علي', cityId: 'aziziyah' });
    await rpc.inviteMember(ali, { householdId: home.id, phone: '07712345679', role: 'orderer', spendingLimitIqd: 25_000 });
    await orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_1', requestedBy: minar.personId, amountIqd: 32_000 });
    expect((await rpc.mine(ali))?.pendingApprovals[0]?.context).toBeNull();
    const ctx = { merchantName: 'مطعم خالد', itemsSummary: '2× تكة، لبن', itemCount: 3, placeLabel: 'شارع 30' };
    rpc.bindOrderContext(async (orderId) => (orderId === 'ord_1' ? ctx : Promise.reject(new Error('gone'))));
    expect((await rpc.mine(ali))?.pendingApprovals[0]?.context).toEqual(ctx);
    await orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_x', requestedBy: minar.personId, amountIqd: 30_000 });
    expect((await rpc.mine(ali))?.pendingApprovals.map((a) => a.context?.merchantName ?? null).sort()).toEqual(['مطعم خالد', null].sort());
  });

  describe('joy w4: budgets, the month and the family table', () => {
    const at = new Date('2026-10-07T09:00:00Z');
    const order = (o: Partial<HouseholdMonthOrder> & Pick<HouseholdMonthOrder, 'orderId' | 'ordererId'>): HouseholdMonthOrder => ({
      householdOrgId: null,
      familyTable: false,
      heldForPayer: false,
      merchantName: 'مطعم خالد',
      totalIqd: 10_000,
      state: 'closed',
      placedAt: at,
      ...o,
    });

    async function family() {
      const s = await setup();
      s.id.clock.set(at);
      const home = await s.rpc.create(s.ali, { name: 'بيت علي', cityId: 'aziziyah' });
      await s.rpc.inviteMember(s.ali, { householdId: home.id, phone: '07712345679', role: 'orderer', spendingLimitIqd: 25_000 });
      const kid = (await s.id.login('07712345671')).actor;
      await s.id.service.updateProfile(kid, { name: 'حسين' });
      await s.rpc.inviteMember(s.ali, { householdId: home.id, phone: '07712345671', role: 'orderer', spendingLimitIqd: 10_000 });
      return { ...s, home, kid };
    }

    it('a payer sets a monthly budget; not on a payer, not by a member', async () => {
      const { rpc, ali, minar, home } = await family();
      const after = await rpc.setBudget(ali, { householdId: home.id, personId: minar.personId, monthlyBudgetIqd: 100_000 });
      expect(after.members.find((m) => m.personId === minar.personId)?.monthlyBudgetIqd).toBe(100_000);
      expect(await code(rpc.setBudget(ali, { householdId: home.id, personId: ali.personId, monthlyBudgetIqd: 1 }))).toBe('invalid_input');
      expect(await code(rpc.setBudget(minar, { householdId: home.id, personId: minar.personId, monthlyBudgetIqd: 900_000 }))).toBe('household_payer_only');
      const cleared = await rpc.setBudget(ali, { householdId: home.id, personId: minar.personId, monthlyBudgetIqd: null });
      expect(cleared.members.find((m) => m.personId === minar.personId)?.monthlyBudgetIqd).toBeNull();
    });

    it('spend per member: the payer sees everyone, a member only their own; the family table for all', async () => {
      const { rpc, ali, minar, kid, home } = await family();
      const seen: Array<{ householdId: string; month: string; members: number }> = [];
      rpc.bindMonthOrders(async ({ householdId, memberIds, month }) => {
        seen.push({ householdId, month, members: memberIds.length });
        return [
          order({ orderId: 'o1', ordererId: minar.personId, householdOrgId: home.id, totalIqd: 30_000 }),
          order({ orderId: 'o2', ordererId: minar.personId, householdOrgId: home.id, totalIqd: 16_000, state: 'preparing' }),
          order({ orderId: 'o3', ordererId: minar.personId, householdOrgId: home.id, totalIqd: 9_000, state: 'customer_cancelled' }),
          order({ orderId: 'o4', ordererId: kid.personId, householdOrgId: home.id, totalIqd: 12_000, state: 'placed', heldForPayer: true, placedAt: new Date(at.getTime() + 60_000) }),
          order({ orderId: 'o5', ordererId: ali.personId, familyTable: true, totalIqd: 41_000, merchantName: 'مشويات الحاج كريم', placedAt: new Date(at.getTime() - 60_000) }),
        ];
      });
      const forPayer = await rpc.mine(ali);
      expect(seen[0]).toEqual({ householdId: home.id, month: '2026-10', members: 3 });
      expect(forPayer?.members.map((m) => [m.name, m.monthSpentIqd])).toEqual([
        ['علي', 0],
        ['منار', 46_000],
        // حسين's only order waits for the payer: not spent yet (placement still counts it).
        ['حسين', 0],
      ]);
      expect(forPayer?.month?.tableOrders.map((o) => [o.orderId, o.status, o.onHouseholdWallet, o.familyTable, o.orderedByName])).toEqual([
        ['o4', 'waiting', true, false, 'حسين'],
        ['o2', 'live', true, false, 'منار'],
        ['o1', 'done', true, false, 'منار'],
        ['o5', 'done', false, true, 'علي'],
      ]);
      const forMinar = await rpc.mine(minar);
      expect(forMinar?.members.map((m) => [m.name, m.monthSpentIqd])).toEqual([
        ['علي', null],
        ['منار', 46_000],
        ['حسين', null],
      ]);
      // Her own household orders and the family table; never حسين's.
      expect(forMinar?.month?.tableOrders.map((o) => o.orderId)).toEqual(['o2', 'o1', 'o5']);
    });

    it('without a month reader (or when it fails) the hub still opens', async () => {
      const { rpc, ali } = await family();
      expect((await rpc.mine(ali))?.month).toBeNull();
      rpc.bindMonthOrders(() => Promise.reject(new Error('db down')));
      const v = await rpc.mine(ali);
      expect(v?.month).toBeNull();
      expect(v?.members.every((m) => m.monthSpentIqd === null)).toBe(true);
    });

    it('an approval says why and how the month stands (before this order); the decision hook hears the answer', async () => {
      const { rpc, orgs, ali, minar, home } = await family();
      await rpc.setBudget(ali, { householdId: home.id, personId: minar.personId, monthlyBudgetIqd: 50_000 });
      rpc.bindMonthOrders(async () => [order({ orderId: 'o1', ordererId: minar.personId, householdOrgId: home.id, totalIqd: 40_000 }), order({ orderId: 'ord_9', ordererId: minar.personId, householdOrgId: home.id, totalIqd: 18_000, state: 'placed', heldForPayer: true })]);
      const heard: string[] = [];
      rpc.bindDecision(async (r) => {
        heard.push(`${r.orderId}:${r.state}`);
      });
      const req = await orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_9', requestedBy: minar.personId, amountIqd: 18_000, reason: 'month_budget' });
      expect((await rpc.mine(ali))?.pendingApprovals[0]).toMatchObject({ reason: 'month_budget', monthBudgetIqd: 50_000, monthSpentIqd: 40_000, limitIqd: 25_000 });
      await rpc.approve(ali, { requestId: req.id });
      await rpc.approve(ali, { requestId: req.id });
      expect(heard).toEqual(['ord_9:approved']);
      // A failing hook never undoes the payer's answer.
      rpc.bindDecision(() => Promise.reject(new Error('orders down')));
      const second = await orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_10', requestedBy: minar.personId, amountIqd: 30_000, reason: 'order_limit' });
      expect((await rpc.decline(ali, { requestId: second.id })).state).toBe('declined');
    });

    it('a withdrawn request stops asking and stays withdrawn', async () => {
      const { rpc, orgs, ali, minar, home } = await family();
      const req = await orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_w', requestedBy: minar.personId, amountIqd: 30_000, reason: 'order_limit' });
      expect((await orgs.withdrawApproval(home.id, 'ord_w', minar.personId))?.state).toBe('withdrawn');
      expect((await orgs.withdrawApproval(home.id, 'ord_w', minar.personId))?.state).toBe('withdrawn');
      expect(await orgs.withdrawApproval(home.id, 'ord_none', minar.personId)).toBeNull();
      expect((await rpc.mine(ali))?.pendingApprovals).toEqual([]);
      expect((await rpc.approve(ali, { requestId: req.id })).state).toBe('withdrawn');
      expect((await rpc.approvals(ali, { householdId: home.id }))[0]).toMatchObject({ state: 'withdrawn', state_ar: 'انلغى الطلب', canResolve: false });
    });
  });
});
