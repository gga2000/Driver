import { describe, expect, it } from 'vitest';
import { AZIZIYAH_ZONES, type ZonePlacementView } from '@driver/contracts';
import { liveZones, mergeZones, setLiveZones } from './zones-state';

const row = (key: string, over: Partial<ZonePlacementView> = {}): ZonePlacementView => ({
  key,
  name_ar: 'اسم جديد',
  name_en: 'New name',
  tier: 'mid',
  group: 'mid',
  placement: 'drawn',
  ring: [],
  centre: { lat: 32.91, lng: 45.07 },
  areaM2: 0,
  placedBy: null,
  placedAt: null,
  ...over,
} as ZonePlacementView);

describe('the areas the apps use', () => {
  it('are the built-in ones until the server has answered', () => {
    expect(mergeZones(undefined)).toBe(AZIZIYAH_ZONES);
    expect(mergeZones([])).toBe(AZIZIYAH_ZONES);
  });

  it('take the name, group and place ops set in the Console', () => {
    const first = AZIZIYAH_ZONES[0]!;
    const merged = mergeZones([row(first.id)]);
    expect(merged).toHaveLength(AZIZIYAH_ZONES.length);
    expect(merged[0]).toMatchObject({ id: first.id, name_ar: 'اسم جديد', tier: 'mid', lat: 32.91, lng: 45.07, radiusM: first.radiusM });
    expect(merged[1]).toEqual(AZIZIYAH_ZONES[1]);
  });

  it('add an area only the server has, and keep one it has no row for', () => {
    const merged = mergeZones([row('new_area', { name_ar: 'حي جديد' })]);
    expect(merged).toHaveLength(AZIZIYAH_ZONES.length + 1);
    expect(merged.at(-1)).toMatchObject({ id: 'new_area', name_ar: 'حي جديد', tier: 'mid' });
    expect(merged.find((z) => z.id === AZIZIYAH_ZONES[3]!.id)).toEqual(AZIZIYAH_ZONES[3]);
  });

  it('are served by liveZones() after the server answers', () => {
    setLiveZones([row('new_area')]);
    expect(liveZones().some((z) => z.id === 'new_area')).toBe(true);
    setLiveZones(undefined);
    expect(liveZones()).toBe(AZIZIYAH_ZONES);
  });
});
