import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';
import { quoteStop } from './stopped';

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
