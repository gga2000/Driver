import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { sunriseCameraAt, sunriseEnd, sunriseLanding, sunriseLightAt, sunriseStandIn, TOWN } from './sunrise';

describe('the sign-up sunrise (map idea N4)', () => {
  it('lands on the saved door, else the picked zone, else the town centre', () => {
    expect(sunriseLanding({ lat: 32.91, lng: 45.07 }, 'street_30')).toEqual([45.07, 32.91]);
    const z = AZIZIYAH_ZONES.find((x) => x.id === 'street_30')!;
    expect(sunriseLanding(null, 'street_30')).toEqual([z.lng, z.lat]);
    expect(sunriseLanding(undefined, 'nowhere')).toEqual(TOWN);
    expect(sunriseLanding(null, null)).toEqual(TOWN);
  });

  it('plays once in 8 s and ends exactly over the landing street', () => {
    const at: [number, number] = [45.0635, 32.9095];
    const tour = sunriseStandIn(at);
    expect(tour.totalMs).toBe(8000);
    const end = sunriseEnd(tour);
    expect(end.camera.center).toEqual(at);
    expect(sunriseCameraAt(tour, 99_000)).toEqual(end.camera);
    expect(sunriseCameraAt(tour, -5)).toEqual(sunriseCameraAt(tour, 0));
  });

  it('eases between keyframes without jumping', () => {
    const tour = sunriseStandIn();
    let prev = sunriseCameraAt(tour, 0);
    for (let t = 100; t <= tour.totalMs; t += 100) {
      const cur = sunriseCameraAt(tour, t);
      expect(Math.abs(cur.zoom - prev.zoom)).toBeLessThan(0.2);
      expect(Math.abs(cur.bearing - prev.bearing)).toBeLessThan(3);
      prev = cur;
    }
    // The camera rises off the river and comes down onto the street.
    expect(sunriseCameraAt(tour, 0).zoom).toBeLessThan(sunriseCameraAt(tour, 8000).zoom);
  });

  it('the light warms from dawn to morning, one step at a time', () => {
    const tour = sunriseStandIn();
    expect(sunriseLightAt(tour, 0)).toBe('sunset');
    expect(sunriseLightAt(tour, 3000)).toBe('golden');
    expect(sunriseLightAt(tour, 8000)).toBe('morning');
    expect(sunriseEnd(tour).light).toBe('morning');
  });
});
