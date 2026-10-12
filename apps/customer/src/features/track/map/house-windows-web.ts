import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { NO_WINDOWS, WINDOW_TOLERANCE, windowsKey } from './house-windows';

type Golden = typeof import('@driver/map/golden');
type Windows = typeof import('@driver/map/pieces/windows');
type Light = Parameters<Windows['windowLayers']>[0];

/** Tiles arrive in bursts: the windows are rebuilt once a burst settles. */
const TILES_SETTLE_MS = 250;

/**
 * Web: windows, doors and roof walls on the houses up close. `add` goes in every `style.load` (a new light
 * replaces the style); the pieces are rebuilt when the camera stops and when new houses come in with the tiles.
 * Not on `idle`: the order map's street life keeps the map drawing, so it is never idle.
 */
export function bindHouseWindows(m: MlMap, golden: Golden, win: Windows) {
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
    const houses = win.housesFromFeatures(m.querySourceFeatures(golden.GOLDEN_SOURCE, { sourceLayer: 'buildings' }) as never, centre);
    const key = windowsKey(zoom, centre, houses.length);
    if (key === last) return;
    last = key;
    src.setData(win.houseWindows(houses) as never);
  };
  m.on('moveend', dress);
  m.on('sourcedata', (e) => {
    if (e.sourceId !== golden.GOLDEN_SOURCE || !e.tile || m.getZoom() < win.WINDOW_MINZOOM - 0.3) return;
    clearTimeout(timer);
    timer = setTimeout(dress, TILES_SETTLE_MS);
  });
  m.on('remove', () => clearTimeout(timer));
  return {
    add(light: Light) {
      if (m.getSource(win.WINDOW_SOURCE)) return;
      m.addSource(win.WINDOW_SOURCE, { type: 'geojson', data: NO_WINDOWS, tolerance: WINDOW_TOLERANCE });
      const before = m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined;
      for (const layer of win.windowLayers(light)) m.addLayer(layer as never, before);
      last = '';
      dress();
    },
  };
}
