import { describe, expect, it } from 'vitest';
import { WalletHolds, walletLockKey } from './wallet-holds.js';

describe('wallet holds registry (SEC-07)', () => {
  it('sums every module but the asking one, and a source can be unregistered', async () => {
    const holds = new WalletHolds();
    holds.register('orders', async (id) => (id === 'c1' ? 11_500 : 0));
    const off = holds.register('routes', async (id) => (id === 'c1' ? 6_000 : 0));
    expect(await holds.held('c1')).toBe(17_500);
    expect(await holds.heldExcept('orders', 'c1')).toBe(6_000);
    expect(await holds.heldExcept('routes', 'c1')).toBe(11_500);
    expect(await holds.held('c2')).toBe(0);
    off();
    expect(await holds.held('c1')).toBe(11_500);
  });

  it('the wallet lock key is the one the tip lock already takes', () => {
    expect(walletLockKey('c1')).toBe('wallet:c1');
  });
});
