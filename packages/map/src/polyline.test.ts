import { describe, expect, it } from 'vitest';
import { decodePolyline } from './polyline.js';

/** Reference encoder (the same algorithm), for round trips at precision 6. */
function encode(points: Array<{ lat: number; lng: number }>, precision = 6): string {
  const factor = 10 ** precision;
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const put = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lng = Math.round(p.lng * factor);
    put(lat - pLat);
    put(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

describe('decodePolyline', () => {
  it('decodes the reference example (precision 5)', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
  it('round-trips an Aziziyah route at precision 6', () => {
    const pts = [
      { lat: 32.906234, lng: 45.061201 },
      { lat: 32.905811, lng: 45.063002 },
      { lat: 32.896105, lng: 45.070944 },
    ];
    expect(decodePolyline(encode(pts))).toEqual(pts);
  });
  it('an empty string is no points; a cut string is an error', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(() => decodePolyline('_p~iF~ps', 5)).toThrow(RangeError);
  });
});
