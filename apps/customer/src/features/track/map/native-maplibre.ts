import { TurboModuleRegistry } from 'react-native';
import type * as Mlrn from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';

/**
 * The phones' map (MapLibre Native), loaded only where the app was built with it: Expo Go and older
 * builds have no native map, so they keep the drawn town (`SvgBase`) instead of crashing on import.
 */
let loaded: typeof Mlrn | null | undefined;
export function nativeMapLibre(): typeof Mlrn | null {
  if (loaded !== undefined) return loaded;
  try {
    // A runtime require: importing it in a build without the native map throws at load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = TurboModuleRegistry.get('MLRNMapViewModule') ? (require('@maplibre/maplibre-react-native') as typeof Mlrn) : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** The Golden hour map is set up for this phone build: its files are configured and the native map is in it. */
export function nativeGolden(): boolean {
  return !!MAP_TILES_URL && !!MAP_GLYPHS_URL && nativeMapLibre() !== null;
}

type Golden = typeof import('@driver/map/golden');

/**
 * The Golden hour style for MapLibre Native: the same style as the web, reading `pmtiles://` natively
 * (no protocol to add) and shaping Arabic itself (no RTL plugin). The sky block is web-only.
 */
export function nativeGoldenStyle(golden: Golden, light: Parameters<Golden['goldenImages']>[0], mode: 'customer' | 'lite' = 'customer', extra: { riseAt?: number } = {}): StyleSpecification {
  const { style } = golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode, light, ...extra });
  const { sky: _sky, ...rest } = style as unknown as StyleSpecification & { sky?: unknown };
  return rest as StyleSpecification;
}

/** The style's fill patterns (palms, furrows) as PNG files MapLibre Native can load. */
export function nativeGoldenImages(golden: Golden, light: Parameters<Golden['goldenImages']>[0]): Record<string, string> {
  return Object.fromEntries(Object.entries(golden.goldenImages(light)).map(([id, img]) => [id, golden.patternPngDataUri(img)]));
}
