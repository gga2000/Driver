import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { pinSpot, welcomeLines } from './welcome-home';

describe('welcome-home moment (h7)', () => {
  it('lands every zone inside the drawing, on the ground band above the river', () => {
    for (const z of AZIZIYAH_ZONES) {
      const p = pinSpot(z.id);
      expect(p.x, z.id).toBeGreaterThanOrEqual(0.14);
      expect(p.x, z.id).toBeLessThanOrEqual(0.86);
      expect(p.y, z.id).toBeGreaterThanOrEqual(0.55);
      expect(p.y, z.id).toBeLessThanOrEqual(0.7);
    }
  });

  it('puts east to the right and north up', () => {
    const khamas = pinSpot('khamas'); // north-east
    const deir = pinSpot('deir'); // south-west
    expect(khamas.x).toBeGreaterThan(deir.x);
    expect(khamas.y).toBeLessThan(deir.y);
  });

  it('falls back to the town centre for an unknown or missing zone', () => {
    expect(pinSpot('nowhere')).toEqual(pinSpot('centre'));
    expect(pinSpot(null)).toEqual(pinSpot('centre'));
  });

  it('says hello by name and names the zone when there is one', () => {
    expect(welcomeLines('أم علي', 'street_30')).toEqual(['home.welcome_hello', 'home.welcome_zone']);
    expect(welcomeLines(null, null)).toEqual(['home.welcome_hello_anon', 'home.welcome_town']);
  });
});
