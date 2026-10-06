import { describe, expect, it } from 'vitest';
import { baghdadDayOfMonth, baghdadHour, baghdadMonth, baghdadMonthRange, householdApproval, householdMonthSpend, monthNumber, shiftMonth } from './household-budget.js';

const base = { role: 'orderer' as const, orderLimitIqd: null, monthlyBudgetIqd: null, monthSpentIqd: 0, totalIqd: 20_000 };

describe('householdApproval (joy w4)', () => {
  it('a payer is never limited', () => {
    expect(householdApproval({ ...base, role: 'payer', orderLimitIqd: 1_000, monthlyBudgetIqd: 1_000, monthSpentIqd: 900_000 })).toBeNull();
  });

  it('no limit and no budget: straight to the kitchen', () => {
    expect(householdApproval(base)).toBeNull();
  });

  it('over the per-order limit', () => {
    expect(householdApproval({ ...base, orderLimitIqd: 15_000 })).toBe('order_limit');
  });

  it('over the month with this order', () => {
    expect(householdApproval({ ...base, monthlyBudgetIqd: 50_000, monthSpentIqd: 35_000 })).toBe('month_budget');
  });

  it('both at once', () => {
    expect(householdApproval({ ...base, orderLimitIqd: 10_000, monthlyBudgetIqd: 50_000, monthSpentIqd: 45_000 })).toBe('both');
  });

  it('reaching a limit or a budget exactly is fine', () => {
    expect(householdApproval({ ...base, orderLimitIqd: 20_000, monthlyBudgetIqd: 50_000, monthSpentIqd: 30_000 })).toBeNull();
  });
});

describe('Baghdad months', () => {
  it('an instant late on the 30th UTC is already the 1st in Baghdad', () => {
    expect(baghdadMonth(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10');
    expect(baghdadMonth(new Date('2026-09-30T20:59:59Z'))).toBe('2026-09');
  });

  it('a month range starts and ends at Baghdad midnight', () => {
    expect(baghdadMonthRange('2026-10')).toEqual({ from: new Date('2026-09-30T21:00:00Z'), to: new Date('2026-10-31T21:00:00Z') });
    expect(baghdadMonthRange('2026-12').to).toEqual(new Date('2026-12-31T21:00:00Z'));
  });

  it('shifts across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -12)).toBe('2025-10');
  });

  it('day, hour and month number on the Baghdad clock', () => {
    expect(baghdadDayOfMonth(new Date('2026-09-30T21:30:00Z'))).toBe(1);
    expect(baghdadHour(new Date('2026-10-01T07:00:00Z'))).toBe(10);
    expect(monthNumber('2026-09')).toBe(9);
  });
});

describe('householdMonthSpend', () => {
  it('sums one member on one household wallet, open and waiting orders included, cancelled ones not', () => {
    const o = (ordererId: string, householdOrgId: string | null, totalIqd: number, state: 'placed' | 'closed' | 'customer_cancelled' | 'merchant_rejected' | 'preparing') => ({ ordererId, householdOrgId, totalIqd, state });
    const orders = [o('m', 'h', 10_000, 'closed'), o('m', 'h', 5_000, 'placed'), o('m', 'h', 7_000, 'preparing'), o('m', 'h', 9_000, 'customer_cancelled'), o('m', 'h', 4_000, 'merchant_rejected'), o('m', null, 20_000, 'closed'), o('m', 'h2', 3_000, 'closed'), o('x', 'h', 8_000, 'closed')];
    expect(householdMonthSpend(orders, 'h', 'm')).toBe(22_000);
  });
});
