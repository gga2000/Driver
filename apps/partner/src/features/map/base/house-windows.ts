import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { GOLDEN_FIRST_LABEL, GOLDEN_SOURCE, type GoldenLight } from '@driver/map/golden';

type Windows = typeof import('@driver/map/pieces/windows');

/** The windows are thin (25–40 cm): the source's default simplification would fold them flat. */
export const WINDOW_TOLERANCE = 0.05;
const NO_WINDOWS: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** Tiles arrive in bursts: the windows are rebuilt once a burst settles. */
const TILES_SETTLE_MS = 250;

/**
 * When the windows need building again: the camera moved (to about 10 m) or zoomed, or more houses came in
 * with the tiles. Same key → keep what is drawn.
 */
export function windowsKey(zoom: number, centre: readonly [number, number], houses: number): string {
  return `${zoom.toFixed(1)}:${centre[0].toFixed(4)}:${centre[1].toFixed(4)}:${houses}`;
}

/**
 * Windows, doors and roof walls on the houses when the courier zooms in close (from z17, Golden hour map
 * only; `@driver/map/pieces/windows`, as on the customer's maps). `add` goes in every new style (a new light
 * replaces it); the pieces are rebuilt when the camera stops and when new houses come in with the tiles.
 */
export function bindHouseWindows(m: MlMap, win: Windows) {
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dress = () => {
    const src = m.getSource<GeoJSONSource>(win.WINDOW_SOURCE);
    if (!src) return;
    const zoom = m.getZoom();
    if (zoom < win.WINDOW_MINZOOM - 0.3) {
      if (last !== 'off') src.setData(NO_WINDOWS);
      last = 'off';
      return;
    }
    const c = m.getCenter();
    const centre: [number, number] = [c.lng, c.lat];
    const houses = win.housesFromFeatures(m.querySourceFeatures(GOLDEN_SOURCE, { sourceLayer: 'buildings' }) as never, centre);
    const key = windowsKey(zoom, centre, houses.length);
    if (key === last) return;
    last = key;
    src.setData(win.houseWindows(houses) as never);
  };
  m.on('moveend', dress);
  m.on('sourcedata', (e) => {
    if (e.sourceId !== GOLDEN_SOURCE || !e.tile || m.getZoom() < win.WINDOW_MINZOOM - 0.3) return;
    clearTimeout(timer);
    timer = setTimeout(dress, TILES_SETTLE_MS);
  });
  m.on('remove', () => clearTimeout(timer));
  return {
    /** Puts the source and layers on the style showing now; false while that style cannot take them yet. */
    add(light: GoldenLight): boolean {
      if (m.getSource(win.WINDOW_SOURCE)) return true;
      try {
        m.addSource(win.WINDOW_SOURCE, { type: 'geojson', data: NO_WINDOWS, tolerance: WINDOW_TOLERANCE });
        const before = m.getLayer(GOLDEN_FIRST_LABEL) ? GOLDEN_FIRST_LABEL : undefined;
        for (const layer of win.windowLayers(light)) m.addLayer(layer as never, before);
      } catch {
        return false;
      }
      last = '';
      dress();
      return true;
    },
  };
}
