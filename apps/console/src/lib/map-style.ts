import type { StyleSpecification } from 'maplibre-gl';
import { buildMapStyle, SOURCE, type DriverStyleOptions } from '@driver/map';
import { chooseMapStyle, GOLDEN_FIRST_LABEL, type GoldenLight } from '@driver/map/golden';

/**
 * The Console's maps on the Golden hour basemap (docs/specs/2026-10-09-map-golden-hour-design.md),
 * with the original map as the fallback (Ali, 2026-10-09). Pure so it can be tested; the maps call
 * it through `lib/map-runtime.ts`.
 */

/** Where our own map files live (docs/deploy/map.md). Unset → the original map. */
export const MAP_FILES = {
  tilesUrl: process.env.NEXT_PUBLIC_MAP_TILES_URL,
  glyphsUrl: process.env.NEXT_PUBLIC_MAP_GLYPHS_URL,
} as const;

/** The Console pins its light to the screen's theme, never the clock: a high sun by day, warm night in dark. */
export const CONSOLE_LIGHT: Record<'light' | 'dark', GoldenLight> = { light: 'day', dark: 'night' };

export interface ConsoleMapStyleOptions {
  theme: 'light' | 'dark';
  zoneShading?: DriverStyleOptions['zoneShading'];
  tilesUrl?: string | undefined;
  glyphsUrl?: string | undefined;
  /** Our map already failed in this tab: go straight to the original map. */
  originalOnly?: boolean;
}

/** Sources of the original map that are its basemap, not the Console's own drawing. */
const BASEMAP_SOURCES: ReadonlySet<string> = new Set([SOURCE.osm, SOURCE.basemap]);

/**
 * The style a Console map opens with. The original map carries the Console's zones, garages, trips,
 * stops and drivers as part of its style; on the Golden hour basemap those same sources and layers
 * go in under the street and place names (`GOLDEN_FIRST_LABEL`), so every screen keeps the ids it
 * binds clicks and data to and draws exactly what it drew before, on a new basemap.
 */
export function consoleMapStyle(opts: ConsoleMapStyleOptions): { style: StyleSpecification; golden: boolean } {
  const fallback: DriverStyleOptions = { theme: opts.theme, ...(opts.zoneShading ? { zoneShading: opts.zoneShading } : {}) };
  const original = buildMapStyle(fallback) as StyleSpecification;
  if (opts.originalOnly) return { style: original, golden: false };
  const choice = chooseMapStyle({ tilesUrl: opts.tilesUrl, glyphsUrl: opts.glyphsUrl, mode: 'console', light: CONSOLE_LIGHT[opts.theme], fallback });
  if (!choice.golden) return { style: original, golden: false };
  const golden = choice.style as StyleSpecification;
  const sources = Object.fromEntries(Object.entries(original.sources).filter(([id]) => !BASEMAP_SOURCES.has(id)));
  const overlays = original.layers.filter((l) => 'source' in l && typeof l.source === 'string' && l.source in sources);
  const at = golden.layers.findIndex((l) => l.id === GOLDEN_FIRST_LABEL);
  const layers = at < 0 ? [...golden.layers, ...overlays] : [...golden.layers.slice(0, at), ...overlays, ...golden.layers.slice(at)];
  return { style: { ...golden, sources: { ...golden.sources, ...sources }, layers }, golden: true };
}
