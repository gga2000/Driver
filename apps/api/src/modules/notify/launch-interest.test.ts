import { describe, expect, it } from 'vitest';
import type { AppContext } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';
import { notifyHarness } from './test-harness.js';

/** "خبرني لمن ينفتح" on the customer home's coming-soon tiles (audit C-03): demand capture. */
describe('notify.launchInterest', () => {
  function caller(h: ReturnType<typeof notifyHarness>, personId: string | null, roles: string[] = []) {
    const ctx = {
      auth: personId ? { sub: personId, sid: `s_${personId}`, iss: 'driver-api', iat: 0, exp: 0 } : null,
      authError: null,
      identity: { hasRole: async (_p: string, kind: string) => roles.includes(kind) },
      notify: h.service,
    } as unknown as AppContext;
    return t.createCallerFactory(appRouter)(ctx).notify;
  }

  it('records a person once per service (asking again refreshes the zone) and reads it back', async () => {
    const h = notifyHarness();
    const ali = caller(h, 'ali');
    expect(await ali.myLaunchInterests()).toEqual({ services: [] });
    expect(await ali.launchInterest({ service: 'khat', zoneKey: 'zakur' })).toEqual({ services: ['khat'] });
    h.clock.advance(60_000);
    await ali.launchInterest({ service: 'khat', zoneKey: 'centre' });
    expect(await ali.launchInterest({ service: 'grocery' })).toEqual({ services: ['grocery', 'khat'] });
    expect(h.repo.interests.size).toBe(2);
    expect(h.repo.interests.get('ali|khat')).toMatchObject({ zoneKey: 'centre' });
    // Another person's list is their own.
    expect(await caller(h, 'minar').myLaunchInterests()).toEqual({ services: [] });
  });

  it('needs a signed-in person (a guest is asked for the phone first)', async () => {
    const h = notifyHarness();
    await expect(caller(h, null).launchInterest({ service: 'parcel' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller(h, 'ali').launchInterest({ service: 'food' as never })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('gives the Console the demand per service and zone, most-asked first; customers cannot read it', async () => {
    const h = notifyHarness();
    await caller(h, 'a').launchInterest({ service: 'khat', zoneKey: 'zakur' });
    await caller(h, 'b').launchInterest({ service: 'khat', zoneKey: 'zakur' });
    await caller(h, 'c').launchInterest({ service: 'khat' });
    await caller(h, 'c').launchInterest({ service: 'parcel', zoneKey: 'centre' });

    const demand = await caller(h, 'ops', ['dispatcher']).launchDemand();
    expect(demand.map((d) => [d.service, d.people])).toEqual([
      ['khat', 3],
      ['parcel', 1],
      ['grocery', 0],
    ]);
    expect(demand[0]!.byZone).toEqual([
      { zoneKey: 'zakur', people: 2 },
      { zoneKey: null, people: 1 },
    ]);
    expect(demand[0]!.lastAt).toBeInstanceOf(Date);
    expect(demand[2]!.lastAt).toBeNull();

    await expect(caller(h, 'a').launchDemand()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
