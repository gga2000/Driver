import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { createInMemoryEvents } from '../events/index.js';
import { OrgsService } from './orgs.service.js';

function setup() {
  const clock = new FakeClock();
  const { events } = createInMemoryEvents({ clock });
  const orgs = new OrgsService(events, clock);
  const seen: string[] = [];
  events.subscribe('test:seen', '*', async (e) => {
    seen.push(e.type);
  });
  return { events, orgs, seen };
}

describe('households (domain §12)', () => {
  it('creator is the payer; members carry a role and a spending limit', async () => {
    const { orgs, events, seen } = setup();
    const home = orgs.createHousehold({ name: 'بيت علي', cityId: 'aziziyah', payerId: 'p_ali' });
    expect(home.type).toBe('household');
    expect(home.members).toEqual([{ personId: 'p_ali', role: 'payer', spendingLimitIqd: null }]);
    orgs.addMember(home.id, 'p_minar', { role: 'orderer', spendingLimitIqd: 25_000, actorId: 'p_ali' });
    orgs.addMember(home.id, 'p_minar', { role: 'orderer', spendingLimitIqd: 25_000 });
    expect(home.members).toHaveLength(2);
    expect(orgs.withinLimit(home.id, 'p_minar', 25_000)).toBe(true);
    expect(orgs.withinLimit(home.id, 'p_minar', 25_250)).toBe(false);
    expect(orgs.withinLimit(home.id, 'p_ali', 1_000_000)).toBe(true);
    await orgs.settled();
    expect(seen).toEqual(['org.created', 'org.member_added']);
    expect(await events.pendingOutbox()).toBe(0);
    expect(orgs.householdsOf('p_minar').map((o) => o.id)).toEqual([home.id]);
  });

  it('requestPayerApproval emits org.payer_approval_requested once per order and the payer resolves it', async () => {
    const { orgs, seen } = setup();
    const home = orgs.createHousehold({ name: 'بيت', cityId: 'aziziyah', payerId: 'p_ali' });
    orgs.addMember(home.id, 'p_kid', { role: 'orderer', spendingLimitIqd: 10_000 });
    const req = orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_1', requestedBy: 'p_kid', amountIqd: 18_000 });
    expect(orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_1', requestedBy: 'p_kid', amountIqd: 18_000 }).id).toBe(req.id);
    expect(req.payerId).toBe('p_ali');
    expect(req.state).toBe('pending');
    expect(orgs.pendingApprovals(home.id)).toHaveLength(1);
    await orgs.settled();
    expect(seen.filter((t) => t === 'org.payer_approval_requested')).toHaveLength(1);
    expect(() => orgs.resolvePayerApproval(req.id, 'p_kid', 'approved')).toThrow(DriverError);
    expect(orgs.resolvePayerApproval(req.id, 'p_ali', 'approved').state).toBe('approved');
    expect(orgs.pendingApprovals(home.id)).toHaveLength(0);
    expect(() => orgs.requestPayerApproval({ orgId: home.id, orderId: 'ord_2', requestedBy: 'p_stranger', amountIqd: 1 })).toThrow(/household/);
  });

  it('a household without a payer cannot request approval', () => {
    const { orgs } = setup();
    const home = orgs.createHousehold({ name: 'بيت', cityId: 'aziziyah', payerId: 'p_ali' });
    orgs.addMember(home.id, 'p_ali', { role: 'member' });
    expect(() => orgs.requestPayerApproval({ orgId: home.id, orderId: 'o', requestedBy: 'p_ali', amountIqd: 5 })).toThrow(/payer/);
  });
});
