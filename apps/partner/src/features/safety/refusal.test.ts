import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';
import { isSosRefusal } from './refusal';

const serverSaid = (code: string) => new TRPCClientError(code, { result: { error: { message: code, code: -32600, data: { httpStatus: 429, code } } } as never });

describe('isSosRefusal (FLOW-08)', () => {
  it('treats an old server’s hourly limit and a trip refusal as final: no retry loop', () => {
    expect(isSosRefusal(serverSaid('sos_rate_limited'))).toBe(true);
    expect(isSosRefusal(serverSaid('sos_trip_over'))).toBe(true);
    expect(isSosRefusal(serverSaid('sos_not_party'))).toBe(true);
  });

  it('keeps retrying on anything a retry can fix (network, server trouble)', () => {
    expect(isSosRefusal(serverSaid('internal'))).toBe(false);
    expect(isSosRefusal(new TypeError('Network request failed'))).toBe(false);
    expect(isSosRefusal(null)).toBe(false);
  });
});
