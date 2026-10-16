import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';
import { closedLine, quoteStop } from './stopped';

const err = (code: string, message_ar?: string) => new TRPCClientError('x', { result: { error: { message: 'x', code: -32600, data: { code, message_ar } } } } as never);
const t = (k: string) => k;

describe('quoteStop (REL-16): a stopped service or a full zone, said calmly', () => {
  it("uses the switch's own words, else our line; other failures are not a stop", () => {
    expect(quoteStop(err('service_paused', 'موقفين الأكل لساعة'), t)).toBe('موقفين الأكل لساعة');
    expect(quoteStop(err('zone_at_capacity'), t)).toBe('error.zone_at_capacity');
    expect(quoteStop(err('merchant_closed'), t)).toBeNull();
    expect(quoteStop(null, t)).toBeNull();
  });
});

describe('closedLine: a back-at time only when there is one', () => {
  const tp = (k: string, p?: Record<string, string>) => (p ? `${k}:${p.time}` : k);
  it('says the time for a pause or the hours, and no time when the shop has none (tablet offline)', () => {
    expect(closedLine({ closedReason: 'paused', opensAt: '9:30 م' }, tp)).toBe('restaurant.paused_until:9:30 م');
    expect(closedLine({ closedReason: 'paused', opensAt: null }, tp)).toBe('error.merchant_paused');
    expect(closedLine({ closedReason: 'hours', opensAt: '10:00 ص' }, tp)).toBe('error.merchant_closed:10:00 ص');
    expect(closedLine({ closedReason: 'hours', opensAt: null }, tp)).toBe('error.merchant_closed_now');
  });
});
