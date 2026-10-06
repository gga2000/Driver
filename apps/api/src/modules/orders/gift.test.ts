import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { giftProblem, giftView } from './gift.js';
import { ordersHarness } from './test-harness.js';

describe('«عزيمة» gift orders (joy g1)', () => {
  const base = { type: 'food' as const, paymentMethod: 'wallet' as const, participantRoles: ['recipient' as const] };

  it('an ordinary order has nothing to check', () => {
    expect(giftProblem({ ...base, gift: undefined, participantRoles: [] })).toBeNull();
  });

  it('a wallet gift with hidden prices for someone else is fine', () => {
    expect(giftProblem({ ...base, gift: { hidePrices: true } })).toBeNull();
  });

  it('a gift the recipient pays in cash is fine while the prices show', () => {
    expect(giftProblem({ ...base, paymentMethod: 'cash', gift: { hidePrices: false } })).toBeNull();
  });

  it('hidden prices need the wallet: cash at the door must be said', () => {
    expect(giftProblem({ ...base, paymentMethod: 'cash', gift: { hidePrices: true } })).toBe('gift_hidden_prices_need_wallet');
  });

  it('a gift goes to someone else', () => {
    expect(giftProblem({ ...base, participantRoles: ['diner'], gift: { hidePrices: false } })).toBe('gift_needs_recipient');
  });

  it('only food and grocery deliveries can be gifts', () => {
    expect(giftProblem({ ...base, type: 'ride', gift: { hidePrices: false } })).toBe('invalid_input');
    expect(giftProblem({ ...base, type: 'grocery_catalog', gift: { hidePrices: false } })).toBeNull();
  });

  it('the view says gift or not, and whether prices are hidden', () => {
    expect(giftView({})).toBeNull();
    expect(giftView({ gift: false, giftHidePrices: true })).toBeNull();
    expect(giftView({ gift: true })).toEqual({ hidePrices: false });
    expect(giftView({ gift: true, giftHidePrices: true })).toEqual({ hidePrices: true });
  });
});

describe('placing a gift (orders.place)', () => {
  const recipient = [{ ref: 'r', role: 'recipient' as const, label: 'أمي', phone: '07701234567' }];
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (err) {
      return err instanceof DriverError ? err.code : String(err);
    }
  };

  it('stores the gift and shows it on the order', async () => {
    const h = ordersHarness();
    h.wallets.set('customer:c1', 100_000);
    const o = await h.orders.place('c1', h.foodInput({ paymentMethod: 'wallet', participants: recipient, gift: { hidePrices: true } }));
    expect(o.gift).toEqual({ hidePrices: true });
    expect((await h.orders.get(o.id)).gift).toEqual({ hidePrices: true });
    const plain = await h.orders.place('c1', h.foodInput());
    expect(plain.gift).toBeNull();
  });

  it('refuses a gift with nobody to receive it, and hidden prices on cash', async () => {
    const h = ordersHarness();
    expect(await code(h.orders.place('c1', h.foodInput({ gift: { hidePrices: false } })))).toBe('gift_needs_recipient');
    expect(await code(h.orders.place('c1', h.foodInput({ participants: recipient, gift: { hidePrices: true } })))).toBe('gift_hidden_prices_need_wallet');
    expect((await h.orders.place('c1', h.foodInput({ participants: recipient, gift: { hidePrices: false } }))).gift).toEqual({ hidePrices: false });
  });
});
