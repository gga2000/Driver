import type { StyleSpecification } from 'maplibre-gl';
import { buildMapStyle, LAYER } from '@driver/map';

/**
 * The customer apps' MapLibre style: the `@driver/map` light style without the Console's garage and
 * live-fleet layers. Light OSM raster (dev) until the PMTiles basemap ships; zones and the background
 * always draw. Shared by the tracking map and the place pin picker so both look the same.
 */
const CONSOLE_ONLY: ReadonlySet<string> = new Set([LAYER.garages, LAYER.tripLines, LAYER.tripStops, LAYER.drivers, LAYER.driverHalo]);
const LIGHT = buildMapStyle({ theme: 'light' });
export const CUSTOMER_MAP_STYLE = { ...LIGHT, layers: LIGHT.layers.filter((l) => !CONSOLE_ONLY.has(l.id)) } as unknown as StyleSpecification;
