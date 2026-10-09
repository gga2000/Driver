import { describe, expect, it } from 'vitest';
import type { HouseholdView } from '@driver/contracts';
import { HOUSEHOLD_PAY_ENABLED, householdToPayFrom } from './household-pay';

const home = (myRole: HouseholdView['myRole']): HouseholdView => ({ id: 'org_home', name: 'بيت علي', cityId: 'aziziyah', myRole, members: [], pendingApprovals: [], month: null });

describe('household pay switch (RDB-03)', () => {
  it('is off: nothing funds the household account yet (Ali, 2026-10-08)', () => {
    expect(HOUSEHOLD_PAY_ENABLED).toBe(false);
  });

  it('off: checkout offers no household row to anyone, payer included', () => {
    for (const role of ['payer', 'orderer', 'member'] as const) expect(householdToPayFrom(home(role))).toBeNull();
    expect(householdToPayFrom(null)).toBeNull();
    expect(householdToPayFrom(undefined)).toBeNull();
  });

  it('on: payers and orderers get their household, plain members never do', () => {
    expect(householdToPayFrom(home('payer'), true)?.id).toBe('org_home');
    expect(householdToPayFrom(home('orderer'), true)?.id).toBe('org_home');
    expect(householdToPayFrom(home('member'), true)).toBeNull();
    expect(householdToPayFrom(null, true)).toBeNull();
  });
});
