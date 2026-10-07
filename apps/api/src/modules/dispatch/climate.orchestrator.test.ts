import { describe, expect, it } from 'vitest';
import { CLIMATE_DISPATCH_RULES, DriverError } from '@driver/contracts';
import { dispatchHarness, north } from './test-harness.js';

type H = ReturnType<typeof dispatchHarness>;

// 14 July 2026, 14:00 Baghdad: a hot afternoon in the day shift (06:00–15:00).
const SUMMER = '2026-07-14T11:00:00Z';
// 14 January 2026, 10:00 Baghdad: a cold day.
const WINTER = '2026-01-14T07:00:00Z';

const code = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DriverError);
  return (e as DriverError).code;
};

const ride = (h: H, extra: Record<string, unknown> = {}) => h.service.request({ tripId: 't1', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0), ...extra });

/** Cars `km` from the pickup; `ac` / `heat` ones carry that confirmed tag. */
async function cars(h: H, list: ReadonlyArray<readonly [string, number, ('ac' | 'heating')?]>) {
  for (const [id, km, feature] of list) {
    if (feature) h.facts.register(id, { vehicleClass: 'car', confirmedFeatures: [feature] });
    await h.online(id, km);
    h.keepAlive.add(id);
  }
}

const waves = (h: H) => h.events.ofType('dispatch.wave_sent').map((e) => ({ wave: e.payload['wave'], driverIds: e.payload['driverIds'], only: e.payload['only'] ?? null }));

describe('x1 cold car in summer: the first waves of a hot day’s car ride', () => {
  it(`waves 1–${CLIMATE_DISPATCH_RULES.onlyWaves} go only to AC cars; the last wave to everyone, AC cars still first`, async () => {
    const h = dispatchHarness(SUMMER);
    await cars(h, [
      ['near1', 0.1],
      ['near2', 0.2],
      ['ac1', 0.5, 'ac'],
      ['ac2', 0.6, 'ac'],
      ['ac3', 0.7, 'ac'],
      ['ac4', 0.8, 'ac'],
      ['ac5', 1.5, 'ac'],
    ]);
    await ride(h);
    await h.advance(15);
    await h.advance(15);
    expect(waves(h)).toEqual([
      { wave: 1, driverIds: ['ac1', 'ac2', 'ac3'], only: 'ac' },
      { wave: 2, driverIds: ['ac4', 'ac5'], only: 'ac' },
      { wave: 3, driverIds: ['near1', 'near2'], only: null },
    ]);
  });

  it('with no AC car free, everyone gets it at once: an empty wave never waits out its window', async () => {
    const h = dispatchHarness(SUMMER);
    await cars(h, [
      ['near1', 0.1],
      ['near2', 0.2],
    ]);
    await ride(h);
    expect(waves(h)).toEqual([{ wave: 3, driverIds: ['near1', 'near2'], only: null }]);
  });

  it('a driver who said «لا» this shift is out of the AC waves and not counted as AC; next shift he is back', async () => {
    const h = dispatchHarness(SUMMER);
    await cars(h, [
      ['broken', 0.1, 'ac'],
      ['cool', 0.9, 'ac'],
      ['plain', 0.3],
    ]);
    await h.climate.answer('broken', ['ac'], false);
    expect((await h.service.vehicleFacts(['broken'])).get('broken')?.confirmedFeatures).toEqual([]);
    await ride(h);
    expect(waves(h)[0]).toEqual({ wave: 1, driverIds: ['cool'], only: 'ac' });
    // Wave 3 (wave 2 has nobody new): no longer an AC car, he is ranked by distance with the rest.
    await h.advance(15);
    expect(waves(h)[1]).toEqual({ wave: 3, driverIds: ['broken', 'plain'], only: null });

    // 15:00 opens the evening shift: his answer was for the day shift.
    h.clock.advance(60 * 60_000);
    expect((await h.service.vehicleFacts(['broken'])).get('broken')?.confirmedFeatures).toEqual(['ac']);
  });

  it('a «نعم» changes nothing: the car check already counts', async () => {
    const h = dispatchHarness(SUMMER);
    await cars(h, [
      ['plain', 0.1],
      ['ok', 0.5, 'ac'],
    ]);
    await h.climate.answer('ok', ['ac'], true);
    await ride(h);
    expect(waves(h)[0]).toEqual({ wave: 1, driverIds: ['ok'], only: 'ac' });
  });

  it('on a cold day the same for heating', async () => {
    const h = dispatchHarness(WINTER);
    await cars(h, [
      ['plain', 0.1],
      ['ac', 0.2, 'ac'],
      ['warm', 0.5, 'heating'],
    ]);
    await ride(h);
    expect(waves(h)[0]).toEqual({ wave: 1, driverIds: ['warm'], only: 'heating' });
  });

  it('tuktuk rides, food and mild days are untouched', async () => {
    const mild = dispatchHarness();
    await cars(mild, [
      ['near1', 0.1],
      ['ac1', 0.5, 'ac'],
    ]);
    await ride(mild);
    expect(waves(mild)[0]).toEqual({ wave: 1, driverIds: ['near1', 'ac1'], only: null });

    const tuk = dispatchHarness(SUMMER);
    await tuk.online('tuk1', 0.1, { vehicle: 'tuktuk' });
    await ride(tuk, { vertical: 'tuktuk' });
    expect(waves(tuk)[0]).toEqual({ wave: 1, driverIds: ['tuk1'], only: null });

    const food = dispatchHarness(SUMMER);
    await food.online('bike1', 0.1, { vehicle: 'bike' });
    await food.service.request({ tripId: 'f1', cityId: 'aziziyah', vertical: 'food', zoneId: 'centre', pickup: north(0) });
    expect(food.trips.offers[0]?.driverIds).toEqual(['bike1']);
  });

  it('«عوائل» still narrows the first wave, inside the AC cars', async () => {
    const h = dispatchHarness(SUMMER);
    h.service.bindRiders({
      avoided: async () => [],
      favourites: async () => [],
      standing: async (ids) => new Map(ids.map((id) => [id, { rating: 4.9, driverSince: new Date('2025-01-01T00:00:00Z') }])),
    });
    h.facts.register('fam_ac', { vehicleClass: 'car', confirmedFeatures: ['ac', 'family'] });
    h.facts.register('fam_hot', { vehicleClass: 'car', confirmedFeatures: ['family'] });
    await cars(h, [
      ['fam_hot', 0.1],
      ['ac1', 0.2, 'ac'],
      ['fam_ac', 0.8],
    ]);
    await ride(h, { riderId: 'c1', familyPreferred: true });
    expect(waves(h)[0]).toEqual({ wave: 1, driverIds: ['fam_ac'], only: 'ac' });
  });
});

describe('«المكيّفة شغالة اليوم؟» — the shift question (x1)', () => {
  it('is asked on a hot shift of a car with confirmed AC, and holds his latest answer for the shift', async () => {
    const h = dispatchHarness(SUMMER);
    expect(await h.climate.checkFor('d1', ['ac', 'family'])).toEqual({ feature: 'ac', climate: 'hot', shiftId: '2026-07-14:day', endsAt: new Date('2026-07-14T12:00:00Z'), working: null });
    expect(await h.climate.answer('d1', ['ac'], false)).toMatchObject({ working: false });
    expect(await h.climate.answer('d1', ['ac'], true)).toMatchObject({ working: true });
    expect((await h.climate.checkFor('d1', ['ac']))?.working).toBe(true);
    expect(await h.climate.offNow(['d1'])).toEqual(new Map());
  });

  it('a summer morning is asked already: the afternoon heat is in the same shift', async () => {
    const h = dispatchHarness('2026-07-14T04:00:00Z'); // 07:00 Baghdad
    expect((await h.climate.checkFor('d1', ['ac']))?.shiftId).toBe('2026-07-14:day');
  });

  it('nothing is asked on a mild shift, without the confirmed feature, or after the heat (21:00)', async () => {
    expect(await dispatchHarness().climate.checkFor('d1', ['ac'])).toBeNull();
    expect(await dispatchHarness(SUMMER).climate.checkFor('d1', ['heating', 'family'])).toBeNull();
    const night = dispatchHarness('2026-07-14T18:00:00Z');
    expect(await night.climate.checkFor('d1', ['ac'])).toBeNull();
    expect(await code(night.climate.answer('d1', ['ac'], false))).toBe('climate_check_none');
  });

  it('a cold day asks about heating', async () => {
    expect(await dispatchHarness(WINTER).climate.checkFor('d1', ['ac', 'heating'])).toMatchObject({ feature: 'heating', climate: 'cold', shiftId: '2026-01-14:day' });
  });
});
