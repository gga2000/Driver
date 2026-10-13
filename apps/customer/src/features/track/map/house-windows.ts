/**
 * Windows, doors and roof walls on the houses up close (`@driver/map/pieces/windows`, Ali 2026-10-12): the
 * customer's maps build them for the houses on screen. Shared by the web and phone maps.
 */

/** The windows are thin (25–40 cm): the source's default simplification would fold them flat. */
export const WINDOW_TOLERANCE = 0.05;
export const NO_WINDOWS: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * When the windows need building again: the camera moved (to about 10 m) or zoomed, or more houses came in
 * with the tiles. Same key → keep what is drawn.
 */
export function windowsKey(zoom: number, centre: readonly [number, number], houses: number): string {
  return `${zoom.toFixed(1)}:${centre[0].toFixed(4)}:${centre[1].toFixed(4)}:${houses}`;
}
