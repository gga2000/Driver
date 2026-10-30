import type { LatLng } from '@driver/contracts';

/** Decodes Google's encoded polyline (OSRM `polyline6`) into points. */
export function decodePolyline(encoded: string, precision = 6): LatLng[] {
  const scale = 10 ** precision;
  const out: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new RangeError('polyline ends mid-number');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    out.push({ lat: lat / scale, lng: lng / scale });
  }
  return out;
}

/** Encodes points as Google's polyline (precision 6, as OSRM's `polyline6`). */
export function encodePolyline(points: readonly LatLng[], precision = 6): string {
  const scale = 10 ** precision;
  let out = '';
  let lat = 0;
  let lng = 0;
  const put = (delta: number): void => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const la = Math.round(p.lat * scale);
    const ln = Math.round(p.lng * scale);
    put(la - lat);
    put(ln - lng);
    lat = la;
    lng = ln;
  }
  return out;
}
