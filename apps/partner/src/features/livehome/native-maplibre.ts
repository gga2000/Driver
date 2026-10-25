import { TurboModuleRegistry } from 'react-native';
import type * as Mlrn from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import type { GoldenLight } from '@driver/map/golden';
import { MAP_URLS } from '@/features/map/base/golden-map';

type Golden = typeof import('@driver/map/golden');

/**
 * The phones' 3D map (MapLibre Native, as in the customer app), loaded only where the app was built
 * with it: Expo Go and older builds have no native map, so they keep the flat live map instead of
 * crashing on import.
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

/** The 3D live map can draw on this phone: our map files are set at build time and the native map is in it. */
export function nativeGolden(): boolean {
  return Boolean(MAP_URLS.tilesUrl && MAP_URLS.glyphsUrl) && nativeMapLibre() !== null;
}

/**
 * The courier Golden hour style for MapLibre Native: the web's style, reading `pmtiles://` natively and
 * shaping Arabic itself (no RTL plugin). The sky block is web-only.
 */
export function nativeCourierStyle(golden: Golden, light: GoldenLight): StyleSpecification {
  const { style } = golden.chooseMapStyle({ ...MAP_URLS, mode: 'courier', light });
  const { sky: _sky, ...rest } = style as unknown as StyleSpecification & { sky?: unknown };
  return rest as StyleSpecification;
}

/** The style's fill patterns (palms, furrows) as PNG files MapLibre Native can load. */
export function nativeGoldenImages(golden: Golden, light: GoldenLight): Record<string, string> {
  return Object.fromEntries(Object.entries(golden.goldenImages(light)).map(([id, img]) => [id, golden.patternPngDataUri(img)]));
}
