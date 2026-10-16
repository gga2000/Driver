import { AZIZIYAH_LANDMARKS, type LatLng } from '@driver/contracts';

/** How far a public landmark may be from a stop and still name it («يم …»), in km. */
export const STOP_LANDMARK_MAX_KM = 0.6;

/** Flat-earth km to 0.1 (town distances; the same rounding the partner offer uses). */
export function kmApprox(a: LatLng, b: LatLng): number {
  const k = 111.32;
  const dx = (b.lng - a.lng) * k * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = (b.lat - a.lat) * k;
  return Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10;
}

/**
 * The public town landmark nearest a stop (garages and meeting points — never a person's door), its
 * Arabic name; null when none is within `maxKm`. Shared by the partner offer and job (o7, j2) and the
 * خطوط run (k2).
 */
export function nearestLandmark(at: LatLng | null, landmarks: readonly { name_ar: string; lat: number; lng: number }[] = AZIZIYAH_LANDMARKS, maxKm = STOP_LANDMARK_MAX_KM): string | null {
  if (!at) return null;
  let best: { name: string; km: number } | null = null;
  for (const l of landmarks) {
    const d = kmApprox(at, l);
    if (d <= maxKm && (!best || d < best.km)) best = { name: l.name_ar, km: d };
  }
  return best?.name ?? null;
}
