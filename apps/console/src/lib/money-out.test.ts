import { describe, expect, it } from 'vitest';
import { accountId, adjustProblem, driverPayable, needsOwner, payAmountProblem, payKey, SECOND_OK_ABOVE_IQD } from './money-out';

describe('money out on the finance desk', () => {
  it('a driver is owed his earnings net of the cash in his hand, never below 0', () => {
    expect(driverPayable({ cashBalanceIqd: 0, earningsBalanceIqd: 25_000 })).toBe(25_000);
    expect(driverPayable({ cashBalanceIqd: -16_500, earningsBalanceIqd: 1_000 })).toBe(0);
    expect(driverPayable({ cashBalanceIqd: -5_000, earningsBalanceIqd: 30_000 })).toBe(25_000);
  });

  it('the amount is whole, above 0 and within what is owed; each opened form has its own key', () => {
    expect(payAmountProblem(12_750, 12_750)).toBeNull();
    expect(payAmountProblem(0, 12_750)).toBe('empty');
    expect(payAmountProblem(13_000, 12_750)).toBe('too_much');
    expect(payKey('merchant', 'm1', 1_700_000_000_000, () => 0.5)).toMatch(/^console-pay:merchant:m1:[0-9a-z]+:[0-9a-z]+$/);
    expect(payKey('merchant', 'm1', 1, () => 0.1)).not.toBe(payKey('merchant', 'm1', 1, () => 0.2));
  });

  it('a correction names two different accounts, an amount, a reason and a ticket', () => {
    expect(needsOwner('platform')).toBe(false);
    expect(accountId('platform', 'x')).toBe('platform');
    expect(accountId('driver', ' p_12 ')).toBe('driver:p_12');
    expect(accountId('merchant_cash', '')).toBeNull();
    expect(accountId('cash', 'a b')).toBeNull();
    const ok = { from: 'platform', to: 'driver:p_12', amountIqd: 1_000, reason: 'missed tip', incidentId: 'tk_1' };
    expect(adjustProblem(ok)).toBeNull();
    expect(adjustProblem({ ...ok, to: null })).toBe('accounts');
    expect(adjustProblem({ ...ok, to: 'platform' })).toBe('same');
    expect(adjustProblem({ ...ok, amountIqd: 0 })).toBe('amount');
    expect(adjustProblem({ ...ok, reason: 'x' })).toBe('reason');
    expect(adjustProblem({ ...ok, incidentId: ' ' })).toBe('incident');
    expect(SECOND_OK_ABOVE_IQD).toBe(25_000);
  });
});
