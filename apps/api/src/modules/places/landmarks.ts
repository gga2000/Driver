import { AZIZIYAH_LANDMARKS, landmarkCategoryOf, PLACE_LANDMARK_CHOICES, PLACE_LANDMARK_MAX_M, westernDigits, type LandmarkNearView, type LandmarkView, type LatLng, type Place } from '@driver/contracts';
import { distanceM } from './zones.js';

/** Seeded landmarks are not rows: their ids are the seed key with this prefix. */
const SEED_PREFIX = 'lm_';

/**
 * The city's landmarks — one list for every reader ("وين رايح؟" search, the "قرب شنو؟" chips, a
 * saved place's landmark, the courier's «قرب X»), so an id means the same landmark everywhere: the
 * seeded garages and meeting points (Aziziyah), then the approved landmark places (`learned`) whose
 * pin is in service and whose name the seed does not already carry. `zoneOf` resolves each pin on the
 * server, like saved places. Names read with Western digits (voice spec), as zone names do. Each gets
 * its map icon (maps program b3): the row's own category, else `landmarkCategoryOf` its name.
 */
export function cityLandmarks(cityId: string, learned: readonly Place[], zoneOf: (pin: LatLng) => string | null): LandmarkView[] {
  const seeded: LandmarkView[] =
    cityId === 'aziziyah'
      ? AZIZIYAH_LANDMARKS.map((l) => ({
          id: `${SEED_PREFIX}${l.key}`,
          name_ar: westernDigits(l.name_ar),
          name_en: l.name_en,
          pin: { lat: l.lat, lng: l.lng },
          zoneId: zoneOf({ lat: l.lat, lng: l.lng }) ?? l.zoneId,
          kind: l.kind,
          category: landmarkCategoryOf(l.name_ar, l.kind),
          aliases_ar: [...(l.aliases_ar ?? [])],
          photoUrl: null,
        }))
      : [];
  const out = [...seeded];
  for (const p of learned) {
    const zoneId = zoneOf(p.pin);
    if (!zoneId || seeded.some((s) => s.name_ar === westernDigits(p.name))) continue;
    out.push({ id: p.id, name_ar: westernDigits(p.name), name_en: p.name, pin: p.pin, zoneId, kind: 'landmark', category: p.landmarkCategory ?? landmarkCategoryOf(p.name), aliases_ar: [], photoUrl: p.photos[0]?.url ?? null });
  }
  return out;
}

/**
 * "قرب شنو؟" (maps program a2): the landmarks a courier could ask for on the way to this pin — within
 * `PLACE_LANDMARK_MAX_M`, nearest first (ties by id, so the chips never reorder), at most
 * `PLACE_LANDMARK_CHOICES`.
 */
export function nearestLandmarks(all: readonly LandmarkView[], pin: LatLng): LandmarkNearView[] {
  return all
    .map((l) => ({ l, d: distanceM(pin, l.pin) }))
    .filter((x) => x.d <= PLACE_LANDMARK_MAX_M)
    .sort((a, b) => a.d - b.d || a.l.id.localeCompare(b.l.id))
    .slice(0, PLACE_LANDMARK_CHOICES)
    .map((x) => ({ ...x.l, distanceM: Math.round(x.d) }));
}
