import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { harness as identityHarness } from '../identity/test-harness.js';
import { HouseholdsRpc } from './households.rpc.js';
import { OrgsService } from './orgs.service.js';

async function setup() {
  const id = identityHarness();
  const orgs = new OrgsService(undefined, id.clock);
  const rpc = new HouseholdsRpc(orgs, id.service);
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
    expect(home.members).toEqual([{ personId: ali.personId, name: 'علي', phoneMasked: '+96477*****78', role: 'payer', spendingLimitIqd: null, isMe: true }]);
    expect(await code(rpc.create(ali, { name: 'ثاني', cityId: 'aziziyah' }))).toBe('household_exists');
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
    expect(orgs.withinLimit(home.id, minar.personId, 32_000)).toBe(false);
    const req = orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_1', requestedBy: minar.personId, amountIqd: 32_000 });

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

    const second = orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_2', requestedBy: minar.personId, amountIqd: 40_000 });
    expect((await rpc.decline(ali, { requestId: second.id })).state).toBe('declined');
    // Reading member names for the payer is logged against each member read.
    const logs = await id.repo.vaultAccessLogs(minar.personId);
    expect(logs.filter((l) => l.accessorId === ali.personId && l.purpose === 'household_view').length).toBeGreaterThan(0);
  });
});
