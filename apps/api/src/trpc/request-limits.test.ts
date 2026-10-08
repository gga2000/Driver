import { describe, expect, it } from 'vitest';
import { DriverError, REQUEST_LIMITS, type RequestCall } from '@driver/contracts';
import { FakeClock } from '../shared/clock.js';
import { InMemoryWindowCounter, type WindowCounter } from '../shared/window-counter.js';
import { RequestLimits, ipModeFromEnv } from './request-limits.js';

const L = REQUEST_LIMITS;

const outcome = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

function setup(mode: 'alert' | 'enforce' = 'alert') {
  const clock = new FakeClock('2026-10-08T09:00:10Z');
  return { clock, limits: new RequestLimits(new InMemoryWindowCounter(clock), mode) };
}

const person = (personId: string, path = 'orders.mine'): RequestCall => ({ path, type: 'query', personId, ip: '10.0.0.1' });
const guest = (ip: string, path = 'catalog.storefronts'): RequestCall => ({ path, type: 'query', personId: null, ip });

async function calls(limits: RequestLimits, call: RequestCall, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(await outcome(limits.check(call)));
  return out;
}

describe('request limits (SCALE-20)', () => {
  it('a signed-in person gets their calls a minute, then rate_limited until the minute ends', async () => {
    const { clock, limits } = setup();
    expect((await calls(limits, person('p1'), L.perPerson)).every((r) => r === 'ok')).toBe(true);
    const refused = await limits.check(person('p1')).catch((e: DriverError) => e);
    expect(refused).toBeInstanceOf(DriverError);
    expect((refused as DriverError).code).toBe('rate_limited');
    expect((refused as DriverError).envelope.retryAfterSec).toBe(50);
    // Someone else on the same address is not affected.
    expect(await outcome(limits.check(person('p2')))).toBe('ok');
    clock.advance(50_000);
    expect(await outcome(limits.check(person('p1')))).toBe('ok');
  });

  it('price checks have their own lower limit, per person and per address, both enforced', async () => {
    const { limits } = setup('alert');
    const quotes = await calls(limits, person('p1', 'pricing.quote'), L.quotePerPerson + 1);
    expect(quotes.slice(0, L.quotePerPerson).every((r) => r === 'ok')).toBe(true);
    expect(quotes.at(-1)).toBe('rate_limited');
    expect(await outcome(limits.check(person('p1')))).toBe('ok');
    const guests = await calls(limits, guest('10.0.0.9', 'pricing.quote'), L.quotePerGuestIp + 1);
    expect(guests.at(-2)).toBe('ok');
    expect(guests.at(-1)).toBe('rate_limited');
  });

  it('guests behind one address: alert-only at launch (a whole town shares a few addresses)', async () => {
    const { limits } = setup('alert');
    expect((await calls(limits, guest('10.0.0.2'), L.perGuestIp + 50)).every((r) => r === 'ok')).toBe(true);
  });

  it('guests behind one address: enforced when switched on; sign-in and health are never counted', async () => {
    const { limits } = setup('enforce');
    const out = await calls(limits, guest('10.0.0.3'), L.perGuestIp + 1);
    expect(out.at(-2)).toBe('ok');
    expect(out.at(-1)).toBe('rate_limited');
    expect(await outcome(limits.check(guest('10.0.0.3', 'identity.refresh')))).toBe('ok');
    expect(await outcome(limits.check(guest('10.0.0.3', 'health.ping')))).toBe('ok');
    expect(await outcome(limits.check({ ...guest('10.0.0.3'), ip: null }))).toBe('ok');
  });

  it('a counter that fails lets calls through', async () => {
    const broken: WindowCounter = {
      count: async () => 0,
      hit: async () => ({ allowed: true, count: 0, retryAfterSec: 0 }),
      tally: async () => {
        throw new Error('redis down');
      },
    };
    const limits = new RequestLimits(broken, 'enforce');
    expect(await outcome(limits.check(person('p1')))).toBe('ok');
    expect(await outcome(limits.check(guest('10.0.0.4')))).toBe('ok');
  });

  it('the address rule is alert-only unless REQUEST_LIMIT_IP_MODE=enforce', () => {
    expect(ipModeFromEnv({})).toBe('alert');
    expect(ipModeFromEnv({ REQUEST_LIMIT_IP_MODE: 'enforce' })).toBe('enforce');
    expect(ipModeFromEnv({ REQUEST_LIMIT_IP_MODE: 'yes' })).toBe('alert');
  });

  it('staff calls: writes and reads have their own limits per staff person, always enforced (CON-21)', async () => {
    const { clock, limits } = setup('alert');
    const staff = (type: 'query' | 'mutation', personId = 's1') => ({ path: type === 'mutation' ? 'dispatch.override' : 'dispatch.board', type, personId, ip: '10.0.0.9' });
    const writes: string[] = [];
    for (let i = 0; i <= L.staffWritesPerPerson; i++) writes.push(await outcome(limits.checkStaff(staff('mutation'))));
    expect(writes.slice(0, L.staffWritesPerPerson).every((r) => r === 'ok')).toBe(true);
    expect(writes.at(-1)).toBe('rate_limited');
    // Reads are counted apart, and another staff person is not affected.
    expect(await outcome(limits.checkStaff(staff('query')))).toBe('ok');
    expect(await outcome(limits.checkStaff(staff('mutation', 's2')))).toBe('ok');
    const reads: string[] = [];
    for (let i = 0; i < L.staffReadsPerPerson; i++) reads.push(await outcome(limits.checkStaff(staff('query'))));
    expect(reads.at(-1)).toBe('rate_limited');
    // Never a ban: the next minute works again.
    clock.advance(L.windowMs);
    expect(await outcome(limits.checkStaff(staff('mutation')))).toBe('ok');
  });

  it('logs the first refusal of a minute and every 50th after it, naming the call', async () => {
    const { limits } = setup('alert');
    const warned: string[] = [];
    (limits as unknown as { logger: { warn: (m: string) => void } }).logger.warn = (m: string) => warned.push(m);
    for (let i = 0; i < L.staffWritesPerPerson + 100; i++) await outcome(limits.checkStaff({ path: 'support.refund', type: 'mutation', personId: 's1', ip: null }));
    expect(warned).toHaveLength(3);
    expect(warned[0]).toContain('support.refund');
    expect(warned[0]).toContain('1 over');
    expect(warned[2]).toContain('100 over');
  });

  it('a staff person gets the Console ceiling overall once they made a staff call', async () => {
    const { limits } = setup('alert');
    const call = (personId: string) => ({ path: 'console.wall', type: 'query' as const, personId, ip: null });
    // Someone who never made a staff call stays on the app ceiling.
    const app = await calls(limits, call('a1'), L.perPerson + 1);
    expect(app.at(-1)).toBe('rate_limited');
    await limits.checkStaff({ ...call('s1') });
    const staff = await calls(limits, call('s1'), L.staffReadsPerPerson + L.staffWritesPerPerson + 1);
    expect(staff.slice(0, -1).every((r) => r === 'ok')).toBe(true);
    expect(staff.at(-1)).toBe('rate_limited');
  });
});
