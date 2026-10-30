import { AZIZIYAH_ZONES, type AziziyahZoneSeed, type ZonePlacementView } from '@driver/contracts';

/** A zone the Console added has no built-in radius; this is how far from its centre a pin still counts as «near». */
const NEW_ZONE_RADIUS_M = 200;

/**
 * The areas as the server has them now. The built-in list is what the app knows at install; ops edits names,
 * groups and places in the Console and adds areas, and those must show here too (names, pickers, the ride
 * list). An area the server has no row for keeps its built-in entry; one only the server has is added.
 * Pure, so it runs in the Node tests.
 */
export function mergeZones(rows: readonly ZonePlacementView[] | undefined): readonly AziziyahZoneSeed[] {
  if (!rows || rows.length === 0) return AZIZIYAH_ZONES;
  const live = new Map(rows.map((r) => [r.key, r]));
  const known = new Set(AZIZIYAH_ZONES.map((z) => z.id));
  const merged = AZIZIYAH_ZONES.flatMap((z): AziziyahZoneSeed[] => {
    const r = live.get(z.id);
    return [r ? { ...z, name_ar: r.name_ar, name_en: r.name_en, tier: r.tier, group: r.group, lat: r.centre.lat, lng: r.centre.lng } : z];
  });
  const added = rows
    .filter((r) => !known.has(r.key))
    .map((r): AziziyahZoneSeed => ({ id: r.key, extId: r.key, name_ar: r.name_ar, name_en: r.name_en, tier: r.tier, group: r.group, lat: r.centre.lat, lng: r.centre.lng, radiusM: NEW_ZONE_RADIUS_M }));
  return [...merged, ...added];
}

let current: readonly AziziyahZoneSeed[] = AZIZIYAH_ZONES;
const listeners = new Set<() => void>();

/** For `useSyncExternalStore`: calls `cb` whenever the list changes. */
export function subscribeZones(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** The areas to use right now: the server's list once it has answered, the built-in one until then. */
export function liveZones(): readonly AziziyahZoneSeed[] {
  return current;
}

export function setLiveZones(rows: readonly ZonePlacementView[] | undefined): void {
  const next = mergeZones(rows);
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}
