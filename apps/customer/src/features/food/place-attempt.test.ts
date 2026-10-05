import { describe, expect, it } from 'vitest';
import { PlaceOrderInput } from '@driver/contracts';
import { afterFailure, attemptFor, attemptSignature, newRequestKey, refusedForSure, shouldReplay } from './place-attempt';

describe('place attempts — no duplicate orders', () => {
  it('keys are valid clientRequestIds and differ between attempts', () => {
    const a = newRequestKey();
    const b = newRequestKey();
    expect(a).not.toBe(b);
    for (const k of [a, b, newRequestKey('ride', 0, () => 0.999999)]) {
      expect(PlaceOrderInput.shape.clientRequestId.safeParse(k).success, k).toBe(true);
    }
  });

  it('one attempt per basket: a retry of the same basket keeps the key, a different basket gets a new one', () => {
    const sig = attemptSignature('org_1', [{ key: 'kebab|', qty: 2 }, { key: 'tikka|', qty: 1 }]);
    // Line order does not matter.
    expect(attemptSignature('org_1', [{ key: 'tikka|', qty: 1 }, { key: 'kebab|', qty: 2 }])).toBe(sig);
    const first = attemptFor(null, sig, () => 'chk_first_key');
    expect(first).toEqual({ key: 'chk_first_key', signature: sig, unknownSince: null });
    const lost = afterFailure(first, null, 1000)!;
    expect(attemptFor(lost, sig, () => 'chk_other_key')).toBe(lost);
    const more = attemptSignature('org_1', [{ key: 'kebab|', qty: 3 }, { key: 'tikka|', qty: 1 }]);
    expect(attemptFor(lost, more, () => 'chk_other_key').key).toBe('chk_other_key');
  });

  it('a refusal the server named drops the key; a lost answer or a server failure keeps it', () => {
    const a = attemptFor(null, 's', () => 'chk_k_123456');
    for (const c of ['price_changed', 'deal_changed', 'wallet_insufficient', 'new_customer_cash_cap', 'rate_limited']) {
      expect(refusedForSure(c), c).toBe(true);
      expect(afterFailure(a, c)).toBeNull();
    }
    for (const c of [null, 'INTERNAL_SERVER_ERROR', 'TIMEOUT', 'BAD_GATEWAY']) {
      expect(refusedForSure(c), String(c)).toBe(false);
      expect(afterFailure(a, c, 5000)).toEqual({ ...a, unknownSince: 5000 });
    }
    // The first loss time sticks.
    expect(afterFailure({ ...a, unknownSince: 10 }, null, 99)?.unknownSince).toBe(10);
  });

  it('replays by itself only for a lost answer, online, nothing in flight, within 30 minutes', () => {
    const fresh = attemptFor(null, 's', () => 'chk_k_123456');
    const lost = { ...fresh, unknownSince: 0 };
    expect(shouldReplay(null, { online: true, inFlight: false })).toBe(false);
    expect(shouldReplay(fresh, { online: true, inFlight: false, now: 1 })).toBe(false);
    expect(shouldReplay(lost, { online: false, inFlight: false, now: 1 })).toBe(false);
    expect(shouldReplay(lost, { online: true, inFlight: true, now: 1 })).toBe(false);
    expect(shouldReplay(lost, { online: true, inFlight: false, now: 1 })).toBe(true);
    expect(shouldReplay(lost, { online: true, inFlight: false, now: 31 * 60_000 })).toBe(false);
  });
});
