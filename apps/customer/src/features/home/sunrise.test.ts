import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { sunriseTour } from '@driver/map/pieces';
import { sunriseCameraAt, sunriseEnd, sunriseLanding, sunriseLegs, sunriseLightAt, TOWN } from './sunrise';

describe('the sign-up sunrise (map idea N4)', () => {
  it('lands on the saved door, else the picked zone, else the town centre', () => {
    expect(sunriseLanding({ lat: 32.91, lng: 45.07 }, 'street_30')).toEqual([45.07, 32.91]);
    const z = AZIZIYAH_ZONES.find((x) => x.id === 'street_30')!;
    expect(sunriseLanding(null, 'street_30')).toEqual([z.lng, z.lat]);
    expect(sunriseLanding(undefined, 'nowhere')).toEqual(TOWN);
    expect(sunriseLanding(null, null)).toEqual(TOWN);
  });

  it('plays once in 8 s and ends exactly over the landing', () => {
    const at: [number, number] = [45.0635, 32.9095];
    const tour = sunriseTour(at);
    expect(tour.totalMs).toBe(8000);
    const end = sunriseEnd(tour);
    expect(end.camera.center).toEqual(at);
    expect(sunriseCameraAt(tour, 99_000)).toEqual(end.camera);
    expect(sunriseCameraAt(tour, -5)).toEqual(sunriseCameraAt(tour, 0));
  });

  it('eases between keyframes without jumping', () => {
    const tour = sunriseTour(TOWN);
    let prev = sunriseCameraAt(tour, 0);
    for (let t = 100; t <= tour.totalMs; t += 100) {
      const cur = sunriseCameraAt(tour, t);
      expect(Math.abs(cur.zoom - prev.zoom)).toBeLessThan(0.2);
      expect(Math.abs(cur.bearing - prev.bearing)).toBeLessThan(3);
      expect(Math.abs(cur.pitch - prev.pitch)).toBeLessThan(3);
      prev = cur;
    }
  });

  it('the light warms from night to day, one step at a time, and ends on the day map', () => {
    const tour = sunriseTour(TOWN);
    const steps = tour.lights.map((l) => l.light);
    expect(sunriseLightAt(tour, 0)).toBe(steps[0]);
    for (const step of tour.lights) expect(sunriseLightAt(tour, step.atMs)).toBe(step.light);
    expect(sunriseEnd(tour).light).toBe('day');
  });

  it('on phones, the same flight as back-to-back moves the map eases itself, ending on the landing', () => {
    const tour = sunriseTour(TOWN);
    const legs = sunriseLegs(tour);
    expect(legs).toHaveLength(tour.keyframes.length - 1);
    expect(legs[0]!.atMs).toBe(0);
    legs.forEach((leg, i) => {
      // Each move starts as the one before it ends, at the keyframe the web passes at that moment.
      if (i > 0) expect(leg.atMs).toBe(legs[i - 1]!.atMs + legs[i - 1]!.durationMs);
      expect(leg.to).toEqual(sunriseCameraAt(tour, leg.atMs + leg.durationMs));
    });
    const last = legs[legs.length - 1]!;
    expect(last.atMs + last.durationMs).toBe(tour.totalMs);
    expect(last.to).toEqual(sunriseEnd(tour).camera);
  });
});
