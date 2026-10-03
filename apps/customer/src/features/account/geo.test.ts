import { describe, expect, it } from 'vitest';
import { absoluteUrl, AZIZIYAH_BOX, canvasHeight, nearestZone, project, unproject, zoneCentre } from './geo';

describe('pin picker map', () => {
  it('projects and unprojects within a few metres', () => {
    const p = { lat: 32.9095, lng: 45.0635 };
    const h = canvasHeight(350);
    const { x, y } = project(p, 350, h);
    const back = unproject(x, y, 350, h);
    expect(Math.abs(back.lat - p.lat)).toBeLessThan(1e-5);
    expect(Math.abs(back.lng - p.lng)).toBeLessThan(1e-5);
    // north-west corner is the origin
    expect(project({ lat: AZIZIYAH_BOX.maxLat, lng: AZIZIYAH_BOX.minLng }, 350, h)).toEqual({ x: 0, y: 0 });
  });

  it('nearest zone previews what the server resolves', () => {
    expect(nearestZone({ lat: 32.9095, lng: 45.0635 })).toBe('street_30');
    expect(nearestZone({ lat: 32.887, lng: 45.0765 })).toBe('zakur');
    expect(zoneCentre('zakur')).toEqual({ lat: 32.887, lng: 45.0765 });
    expect(zoneCentre('nope')).toBeNull();
  });

  it('resolves relative API URLs against the API origin', () => {
    expect(absoluteUrl('/files/up_1?exp=1&sig=x', 'http://127.0.0.1:3440/trpc')).toBe('http://127.0.0.1:3440/files/up_1?exp=1&sig=x');
    expect(absoluteUrl('https://cdn.example/x.jpg', 'http://127.0.0.1:3440/trpc')).toBe('https://cdn.example/x.jpg');
    expect(absoluteUrl('blob:abc', 'http://127.0.0.1:3440/trpc')).toBe('blob:abc');
  });
});
