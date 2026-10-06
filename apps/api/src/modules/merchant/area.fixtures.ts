import { AZIZIYAH_ZONES, draftRing, ringAreaM2, type ZonePlacementView } from '@driver/contracts';

/**
 * Tests only: Aziziyah's seed zones as the zones module lists them before anyone draws an outline
 * (drafts, hexagons around the seed centres) — the delivery map's input without the zones module's
 * repositories, names and drivers' checks.
 */
export const SEED_ZONES: readonly ZonePlacementView[] = AZIZIYAH_ZONES.map((z) => {
  const ring = draftRing(z);
  return {
    key: z.id,
    name_ar: z.name_ar,
    name_en: z.name_en,
    tier: z.tier,
    group: z.group,
    placement: 'draft',
    ring,
    centre: { lat: z.lat, lng: z.lng },
    areaM2: Math.round(ringAreaM2(ring)),
    placedBy: null,
    placedAt: null,
  };
});
