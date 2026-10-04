import type { LayerSpecification, SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';
import { MAP_COLORS, MAP_COLORS_LIGHT, TIER_RAMP, TIERS_IN_ORDER } from './colors.js';
import { buildGaragesGeoJSON } from './garages.js';
import { AZIZIYAH_CENTER, AZIZIYAH_DEFAULT_ZOOM, buildZonesGeoJSON } from './zones.js';

/** Source ids the Console updates at runtime (`map.getSource(id).setData(...)`). */
export const SOURCE = {
  osm: 'osm-raster',
  basemap: 'basemap',
  zones: 'zones',
  garages: 'garages',
  trips: 'trips',
  stops: 'trip-stops',
  drivers: 'drivers',
} as const;

/** Layer ids the Console binds clicks and hovers to. */
export const LAYER = {
  background: 'background',
  osm: 'osm-raster',
  zoneFill: 'zones-fill',
  zoneLine: 'zones-line',
  garages: 'garages',
  tripLines: 'trip-lines',
  tripStops: 'trip-stops',
  drivers: 'drivers',
  driverHalo: 'drivers-halo',
} as const;

/** OSM raster fallback (tile.openstreetmap.org: dev and low-volume only, per the OSM tile policy). */
export const OSM_RASTER_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
export const OSM_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Glyphs for vector labels once PMTiles land (Noto stacks carry Arabic). */
export const DEFAULT_GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
/** MapLibre needs the RTL plugin to shape Arabic in vector labels. */
export const RTL_TEXT_PLUGIN_URL = 'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js';

/** Arabic first, then the default name, then English (vector basemap labels). */
export const ARABIC_FIRST_NAME = ['coalesce', ['get', 'name:ar'], ['get', 'name'], ['get', 'name:en']] as const;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface DriverStyleOptions {
  /**
   * `pmtiles://…` URL of the Aziziyah vector extract. Not built yet: when absent the style uses the
   * OSM raster fallback, inverted and desaturated into the dark theme.
   */
  pmtilesUrl?: string;
  glyphs?: string;
  /** Include النهضة (Baghdad) in the garage layer. Default: town garages only. */
  includeOutOfTownGarages?: boolean;
  /**
   * `dark` (default): the Console's dark map. `light`: the customer app's cream map — OSM raster kept
   * light (slightly desaturated) and zones as a faint neighbourhood wash instead of pricing bands.
   */
  theme?: 'dark' | 'light';
  /**
   * How zones are shaded. `categorical` (the dark default): one hue per tier. `wash` (the light
   * default, customer app): a faint neighbourhood wash. `sequential` (the Console, K-09): the tier
   * bands as one ink hue, light → dark outwards (`TIER_RAMP`), split by a paper-coloured hairline.
   */
  zoneShading?: 'categorical' | 'wash' | 'sequential';
}

/** `['match', ['get', 'tier'], 'centre', c1, …, fallback]` for a theme's tier ramp. */
function tierMatch(theme: 'light' | 'dark'): unknown[] {
  const ramp = TIER_RAMP[theme];
  return ['match', ['get', 'tier'], ...TIERS_IN_ORDER.flatMap((tier) => [tier, ramp[tier]]), ramp.mid];
}

const hoverCase = (on: number, off: number) => ['case', ['boolean', ['feature-state', 'hover'], false], on, off];

/**
 * The Driver dark map as code. Dark warm base, amber accent, tier-shaded zones, garages, and empty
 * runtime sources for trips, stops and driver markers that the Console fills by polling.
 */
export function buildMapStyle(opts: DriverStyleOptions = {}): StyleSpecification {
  const vector = Boolean(opts.pmtilesUrl);
  const light = opts.theme === 'light';
  const C = light ? MAP_COLORS_LIGHT : MAP_COLORS;
  const shading = opts.zoneShading ?? (light ? 'wash' : 'categorical');
  const ramp = light ? 'light' : 'dark';
  const sources: Record<string, SourceSpecification> = {
    [SOURCE.osm]: {
      type: 'raster',
      tiles: OSM_RASTER_TILES,
      tileSize: 256,
      maxzoom: 19,
      attribution: OSM_ATTRIBUTION,
    },
    [SOURCE.zones]: { type: 'geojson', data: buildZonesGeoJSON() as never },
    [SOURCE.garages]: { type: 'geojson', data: buildGaragesGeoJSON({ onlyInCity: !opts.includeOutOfTownGarages }) as never },
    [SOURCE.trips]: { type: 'geojson', data: EMPTY as never },
    [SOURCE.stops]: { type: 'geojson', data: EMPTY as never },
    [SOURCE.drivers]: { type: 'geojson', data: EMPTY as never },
  };
  if (vector) {
    sources[SOURCE.basemap] = { type: 'vector', url: opts.pmtilesUrl!, attribution: OSM_ATTRIBUTION };
  }

  const base: LayerSpecification[] = [{ id: LAYER.background, type: 'background', paint: { 'background-color': C.background } }];
  if (vector) {
    base.push(
      { id: 'earth', type: 'fill', source: SOURCE.basemap, 'source-layer': 'earth', paint: { 'fill-color': C.land } },
      { id: 'water', type: 'fill', source: SOURCE.basemap, 'source-layer': 'water', paint: { 'fill-color': C.water } },
      {
        id: 'roads',
        type: 'line',
        source: SOURCE.basemap,
        'source-layer': 'roads',
        paint: { 'line-color': C.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 16, 4] },
      },
    );
  } else {
    // Light OSM tiles inverted (min > max), hue-rotated back and desaturated: a dark base whose
    // street names (Arabic in Iraq's OSM data) stay legible as light text.
    base.push({
      id: LAYER.osm,
      type: 'raster',
      source: SOURCE.osm,
      paint: light
        ? { 'raster-saturation': -0.35, 'raster-contrast': -0.05, 'raster-opacity': 0.95 }
        : {
            'raster-brightness-min': 0.92,
            'raster-brightness-max': 0.08,
            'raster-hue-rotate': 180,
            'raster-saturation': -0.85,
            'raster-contrast': 0.1,
            'raster-opacity': 0.9,
          },
    });
  }

  const overlays: LayerSpecification[] = [
    {
      id: LAYER.zoneFill,
      type: 'fill',
      source: SOURCE.zones,
      paint:
        shading === 'sequential'
          ? { 'fill-color': tierMatch(ramp) as never, 'fill-opacity': hoverCase(1, 0.88) as never }
          : { 'fill-color': ['get', 'color'], 'fill-opacity': shading === 'wash' ? 0.1 : (hoverCase(0.42, 0.22) as never) },
    },
    {
      id: LAYER.zoneLine,
      type: 'line',
      source: SOURCE.zones,
      paint:
        shading === 'sequential'
          ? { 'line-color': TIER_RAMP[ramp].gap, 'line-width': 1.5, 'line-opacity': 1 }
          : { 'line-color': ['get', 'color'], 'line-width': 1.2, 'line-opacity': shading === 'wash' ? 0.4 : 0.85 },
    },
    {
      id: LAYER.tripLines,
      type: 'line',
      source: SOURCE.trips,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['coalesce', ['get', 'color'], C.accent], 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [2, 1.5] },
    },
    {
      id: LAYER.tripStops,
      type: 'circle',
      source: SOURCE.stops,
      paint: {
        'circle-radius': 4,
        'circle-color': C.background,
        'circle-stroke-color': ['coalesce', ['get', 'color'], C.accent],
        'circle-stroke-width': 2,
      },
    },
    {
      id: LAYER.garages,
      type: 'circle',
      source: SOURCE.garages,
      paint: {
        'circle-radius': 7,
        'circle-color': C.background,
        'circle-stroke-color': C.accentStrong,
        'circle-stroke-width': 3,
      },
    },
    {
      id: LAYER.driverHalo,
      type: 'circle',
      source: SOURCE.drivers,
      paint: {
        'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 16, 11],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.25,
      },
    },
    {
      id: LAYER.drivers,
      type: 'circle',
      source: SOURCE.drivers,
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': C.background,
        'circle-stroke-width': 2,
      },
    },
  ];

  const labels: LayerSpecification[] = vector
    ? [
        {
          id: 'place-labels',
          type: 'symbol',
          source: SOURCE.basemap,
          'source-layer': 'places',
          layout: { 'text-field': ARABIC_FIRST_NAME as never, 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
          paint: { 'text-color': C.label, 'text-halo-color': C.labelHalo, 'text-halo-width': 1.2 },
        },
      ]
    : [];

  return {
    version: 8,
    name: light ? 'Driver light' : 'Driver dark',
    metadata: { 'driver:basemap': vector ? 'pmtiles' : 'osm-raster-fallback', 'driver:labels': 'ar-first' },
    center: AZIZIYAH_CENTER,
    zoom: AZIZIYAH_DEFAULT_ZOOM,
    ...(vector ? { glyphs: opts.glyphs ?? DEFAULT_GLYPHS } : {}),
    sources,
    layers: [...base, ...overlays, ...labels],
  };
}
