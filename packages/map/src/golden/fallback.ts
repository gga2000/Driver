import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { buildMapStyle, type DriverStyleOptions } from '../style.js';
import { buildGoldenStyle, GOLDEN_SOURCE, type GoldenStyleOptions } from './golden-style.js';

export interface MapStyleChoice {
  style: StyleSpecification;
  /** true when the Golden hour map was chosen, false when it fell back to the original map. */
  golden: boolean;
}

export interface MapStyleWithFallbackOptions extends Omit<GoldenStyleOptions, 'pmtilesUrl' | 'glyphs'> {
  /** MAP_TILES_URL (https://…/wasit.pmtiles, with or without `pmtiles://`). Missing → the original map. */
  tilesUrl?: string;
  /** MAP_GLYPHS_URL. Missing → the original map. */
  glyphsUrl?: string;
  /** How the original map is drawn when it stands in (default: the customer app's light theme). */
  fallback?: DriverStyleOptions;
}

/** The original map: today's street picture (OSM raster) in the light theme, or as `fallback` asks. */
export function originalMapStyle(fallback: DriverStyleOptions = { theme: 'light' }): StyleSpecification {
  return buildMapStyle(fallback);
}

/**
 * The Golden hour map when its files are set up, otherwise the original map. Screens call this
 * instead of choosing themselves, so a missing setting can never leave a blank map.
 */
export function chooseMapStyle(opts: MapStyleWithFallbackOptions): MapStyleChoice {
  const { tilesUrl, glyphsUrl, fallback, ...golden } = opts;
  if (!tilesUrl || !glyphsUrl) return { style: originalMapStyle(fallback), golden: false };
  const pmtilesUrl = tilesUrl.startsWith('pmtiles://') ? tilesUrl : `pmtiles://${tilesUrl}`;
  return { style: buildGoldenStyle({ ...golden, pmtilesUrl, glyphs: glyphsUrl }), golden: true };
}

/** The few MapLibre map methods the safety net needs (web `maplibre-gl` and tests both fit). */
export interface FallbackMap {
  on(type: 'error', listener: (e: { sourceId?: string; error?: unknown }) => void): unknown;
  on(type: 'sourcedata', listener: (e: { sourceId?: string; isSourceLoaded?: boolean }) => void): unknown;
  off(type: 'error' | 'sourcedata', listener: (...args: never[]) => void): unknown;
  setStyle(style: StyleSpecification): unknown;
}

/**
 * Safety net while the map is open: if our map file does not answer (no network to the host, a
 * failed upload, a blocked request) within `timeoutMs`, or a tile request fails before the first
 * tile arrives, swap to the original map once. After our map has loaded, a single failed tile
 * (a weak signal mid-ride) is left alone: MapLibre retries it, and switching looks would be worse.
 * Returns a function that stops watching (call it when the screen closes).
 */
export function fallBackToOriginalMap(
  map: FallbackMap,
  opts: { fallback?: DriverStyleOptions; timeoutMs?: number; onFallback?: () => void } = {},
): () => void {
  let settled = false;
  const stop = () => {
    settled = true;
    clearTimeout(timer);
    map.off('error', onError as never);
    map.off('sourcedata', onData as never);
  };
  const swap = () => {
    if (settled) return;
    stop();
    map.setStyle(originalMapStyle(opts.fallback));
    opts.onFallback?.();
  };
  const onError = (e: { sourceId?: string }) => {
    if (e.sourceId === GOLDEN_SOURCE) swap();
  };
  const onData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
    if (e.sourceId === GOLDEN_SOURCE && e.isSourceLoaded) stop();
  };
  const timer = setTimeout(swap, opts.timeoutMs ?? 10_000);
  map.on('error', onError);
  map.on('sourcedata', onData);
  return stop;
}
