import { describe, expect, it } from 'vitest';
import { PriceRequest } from './pricing.js';
import { LedgerEvent } from './ledger.js';

describe('contracts', () => {
  it('parses a PriceRequest with defaults and coerces dates', () => {
    const req = PriceRequest.parse({
      cityId: 'aziziyah',
      vertical: 'taxi',
      stops: [{ zoneId: 'center' }, { zoneId: 'north' }],
      at: '2026-10-02T10:00:00Z',
    });
    expect(req.options.frontSeat).toBe(false);
    expect(req.stops[0]?.type).toBe('dropoff');
    expect(req.at).toBeInstanceOf(Date);
  });

  it('rejects a PriceRequest with fewer than two stops', () => {
    expect(() =>
      PriceRequest.parse({ cityId: 'aziziyah', vertical: 'taxi', stops: [{ zoneId: 'x' }], at: new Date() }),
    ).toThrow();
  });

  it('rejects non-integer or non-positive ledger amounts', () => {
    const base = {
      id: 'e1', type: 'cash_collected', currency: 'IQD', fromAccount: 'customer:c1', toAccount: 'cash:d1',
      occurredAt: new Date(), recordedAt: new Date(),
    };
    expect(LedgerEvent.safeParse({ ...base, amount: 1000.5 }).success).toBe(false);
    expect(LedgerEvent.safeParse({ ...base, amount: -1000 }).success).toBe(false);
    expect(LedgerEvent.safeParse({ ...base, amount: 1000 }).success).toBe(true);
  });

  it('rejects malformed account ids', () => {
    expect(LedgerEvent.shape.fromAccount.safeParse('wallet:1').success).toBe(false);
    expect(LedgerEvent.shape.fromAccount.safeParse('platform').success).toBe(true);
  });
});
