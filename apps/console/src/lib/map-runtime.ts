import maplibregl, { type Map as MlMap } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { RTL_TEXT_PLUGIN_URL, type DriverStyleOptions } from '@driver/map';
import { fallBackToOriginalMap, type FallbackMap } from '@driver/map/golden';
import { consoleMapStyle, MAP_FILES } from './map-style';

/**
 * What every Console map calls: the style to open with, and the safety net while it opens. Only the
 * map chunks import this (they load on demand), so pages without a map carry none of it.
 */

let prepared = false;
/** Our map failed once in this tab: later maps open on the original map without waiting 10 s again. */
let goldenFailed = false;

function prepare() {
  if (prepared) return;
  prepared = true;
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  // Arabic street and place names need shaping; the CSP allows this one file (lib/csp.ts).
  void maplibregl.setRTLTextPlugin(RTL_TEXT_PLUGIN_URL, true).catch(() => undefined);
}

export interface ConsoleMapOpen {
  theme: 'light' | 'dark';
  zoneShading?: DriverStyleOptions['zoneShading'];
}

/** The style for a new map: Golden hour when its files are set and have not failed here, else the original map. */
export function openConsoleMapStyle(opts: ConsoleMapOpen) {
  const choice = consoleMapStyle({ ...opts, ...MAP_FILES, originalOnly: goldenFailed });
  if (choice.golden) prepare();
  return choice;
}

/**
 * While a Golden hour map opens: if our map file fails or does not answer within 10 s, the screen
 * reopens on the original map (`onFallback` bumps the screen's map key, so its own layers, markers
 * and data come back the way they were first drawn). Returns the stop function for unmount.
 */
export function watchGoldenMap(map: MlMap, opts: ConsoleMapOpen, onFallback: () => void): () => void {
  // maplibre's overloaded on/off are wider than the net's narrow view of them.
  return fallBackToOriginalMap(map as unknown as FallbackMap, {
    fallback: { theme: opts.theme, ...(opts.zoneShading ? { zoneShading: opts.zoneShading } : {}) },
    onFallback: () => {
      goldenFailed = true;
      onFallback();
    },
  });
}
