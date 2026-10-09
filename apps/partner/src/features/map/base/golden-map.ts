import type { StyleSpecification } from 'maplibre-gl';
import { SOURCE } from '@driver/map';
import { chooseMapStyle, GOLDEN_FIRST_LABEL, resolveLight, type GoldenLight } from '@driver/map/golden';

/**
 * The Golden hour (عصرية) map on the courier's web map (docs/specs/2026-10-09-map-golden-hour-design.md,
 * "How a screen switches over"). Our own Aziziyah tiles and Arabic letters when both URLs are set at
 * build time, the original street picture otherwise and whenever the tiles do not answer.
 */
export interface GoldenUrls {
  tilesUrl?: string | undefined;
  glyphsUrl?: string | undefined;
}

export const MAP_URLS: GoldenUrls = {
  tilesUrl: process.env.EXPO_PUBLIC_MAP_TILES_URL || undefined,
  glyphsUrl: process.env.EXPO_PUBLIC_MAP_GLYPHS_URL || undefined,
};

/** How often the light is looked at again while the map is open (a quiet swap, no animation). */
export const LIGHT_CHECK_MS = 10 * 60_000;

/**
 * The light follows the app's own look (Account «شكل الشاشة»: auto at Aziziyah sunset, or day/night by
 * hand): night look → the night map; day look → the sun's hour, but never the night map by day.
 */
export function goldenLightFor(night: boolean, now: Date = new Date()): GoldenLight {
  if (night) return 'night';
  const { light } = resolveLight({ now });
  return light === 'night' ? 'day' : light;
}

/**
 * The courier Golden hour style with the app's zone layers (from its original style) laid under the
 * street names, or null when the URLs are not set and the original map stays.
 */
export function courierGoldenStyle(urls: GoldenUrls, light: GoldenLight, original: StyleSpecification): StyleSpecification | null {
  const { style, golden } = chooseMapStyle({ ...urls, mode: 'courier', light });
  if (!golden) return null;
  const zoneLayers = original.layers.filter((l) => 'source' in l && l.source === SOURCE.zones);
  const zones = original.sources[SOURCE.zones];
  const layers = style.layers as unknown as StyleSpecification['layers'];
  const at = layers.findIndex((l) => l.id === GOLDEN_FIRST_LABEL);
  const cut = at < 0 ? layers.length : at;
  return {
    ...(style as unknown as StyleSpecification),
    sources: { ...(style.sources as unknown as StyleSpecification['sources']), ...(zones ? { [SOURCE.zones]: zones } : {}) },
    layers: [...layers.slice(0, cut), ...zoneLayers, ...layers.slice(cut)],
  };
}
