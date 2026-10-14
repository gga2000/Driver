import { describe, expect, it } from 'vitest';
import type { AppContext, ZonePlacementView } from '@driver/contracts';
import { appRouter, t } from '@driver/contracts/router';

const placed: ZonePlacementView = {
  key: 'centre', name_ar: 'العزيزية (مركز)', name_en: 'Aziziyah centre', tier: 'centre', group: 'centre', placement: 'placed',
  ring: [{ lat: 32.904, lng: 45.059 }, { lat: 32.906, lng: 45.059 }, { lat: 32.906, lng: 45.061 }],
  centre: { lat: 32.905, lng: 45.06 }, areaM2: 40_000, placedBy: 'علي', placedAt: new Date('2026-10-13T10:00:00Z'),
  checks: { yes: 3, no: 1, drivers: 2, flaggedAt: null },
};

function caller(signedIn: boolean) {
  const ctx = {
    auth: signedIn ? { sub: 'staff', sid: 's_staff', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async () => signedIn },
    zones: { list: async () => [placed] },
  } as unknown as AppContext;
  return t.createCallerFactory(appRouter)(ctx).ops.zones;
}

/** The app maps read the outlines with no sign-in (the Golden map's neighbourhoods, 2026-10-14). */
describe('ops.zones.map', () => {
  it('gives anyone the outline and name, never who drew it or what drivers answered', async () => {
    const [zone] = await caller(false).map({ cityId: 'aziziyah' });
    expect(zone).toMatchObject({ key: 'centre', name_ar: 'العزيزية (مركز)', placement: 'placed', ring: placed.ring, centre: placed.centre });
    expect(zone!.placedBy).toBeNull();
    expect(zone!.checks).toBeUndefined();
  });
  it('still shows the Console who placed it', async () => {
    const [zone] = await caller(true).list({ cityId: 'aziziyah' });
    expect(zone).toMatchObject({ placedBy: 'علي', checks: { yes: 3 } });
  });
});
