import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { AZIZIYAH_CENTER, AZIZIYAH_DEFAULT_ZOOM } from '../zones.js';
import { GOLDEN_PALETTES, type GoldenPalette } from './palettes.js';
import { FURROW_PATTERN, furrowPattern, PALM_PATTERN, palmPattern, type PatternImage } from './palm.js';
import { lightFor, sunAt, TYPICAL_SUN, type GoldenLight, type SunPosition } from './sun.js';

/**
 * Where the map is shown, which decides how much it draws:
 * - `customer` — flat camera; soft shadows and houses rising into 3D only when zoomed right in.
 * - `courier` — the tilted heading-up view while driving: 3D from z15.4 and a warm sky at the horizon.
 * - `console` — staff screens: flat, no shadows or 3D, so live dots and zones read first.
 * - `lite` — cheap phones: the same colours without patterns, shadows, glints or 3D.
 */
export type GoldenMode = 'customer' | 'courier' | 'console' | 'lite';

export interface GoldenStyleOptions {
  /** `pmtiles://https://…/wasit.pmtiles` (built by `tools/map-tiles`, hosted by platform as MAP_TILES_URL). */
  pmtilesUrl: string;
  /** `…/fonts/{fontstack}/{range}.pbf` with the IBM Plex Sans Arabic stacks (MAP_GLYPHS_URL). */
  glyphs: string;
  /** A fixed light, or `auto` (default) to follow the real sun over Aziziyah at `now`. */
  light?: GoldenLight | 'auto';
  now?: Date;
  mode?: GoldenMode;
  /** Zoom where houses start rising into 3D (customer/courier only); the order map uses TRACKING_RISE_ZOOM. */
  riseAt?: number;
}

/** The vector source id and the font stacks `tools/map-tiles/glyphs.py` writes. */
export const GOLDEN_SOURCE = 'golden';
export const GOLDEN_FONTS = {
  regular: ['IBM Plex Sans Arabic Regular'],
  medium: ['IBM Plex Sans Arabic Medium'],
  bold: ['IBM Plex Sans Arabic Bold'],
} as const;
export const GOLDEN_ATTRIBUTION = '© OpenStreetMap contributors, Overture Maps Foundation';

/**
 * Insert app layers (routes, zones, pins drawn as layers) before this id, so street and place names
 * stay readable on top of them: `map.addLayer(route, GOLDEN_FIRST_LABEL)`.
 */
export const GOLDEN_FIRST_LABEL = 'golden-street-names';

/** The light and sun a style was built for: the light drives the palette, the sun the shadows. */
export function resolveLight(opts: Pick<GoldenStyleOptions, 'light' | 'now'> = {}): { light: GoldenLight; sun: SunPosition } {
  if (opts.light && opts.light !== 'auto') return { light: opts.light, sun: TYPICAL_SUN[opts.light] };
  const sun = sunAt(opts.now ?? new Date());
  return { light: lightFor(sun), sun };
}

/** Images the style uses; add each with `map.addImage(id, image)` (or on `styleimagemissing`). */
export function goldenImages(light: GoldenLight): Record<string, PatternImage> {
  return { [PALM_PATTERN]: palmPattern(GOLDEN_PALETTES[light]), [FURROW_PATTERN]: furrowPattern(GOLDEN_PALETTES[light]) };
}

type Stops = number[];
const zoom = (...stops: Stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops] as never;
const fade = (...stops: Stops) => ['interpolate', ['linear'], ['zoom'], ...stops] as never;
const isCls = (cls: string) => ['==', ['get', 'cls'], cls] as never;
const kindIn = (...kinds: string[]) => ['in', ['get', 'kind'], ['literal', kinds]] as never;
const ROUND = { 'line-cap': 'round', 'line-join': 'round' } as const;

// Street widths in px per zoom; a casing adds a little each side, more once streets are wide.
const WIDTH = {
  alley: [15, 0.4, 16, 1.5, 18, 6],
  minor: [12, 0.3, 14, 0.8, 15, 1.4, 16, 3, 18, 10],
  mid: [12, 0.8, 14, 2.6, 15, 5, 16, 9, 18, 28],
  major: [11, 1, 13, 2.6, 14, 4.8, 15, 8, 16, 13, 18, 40],
  highway: [8, 0.9, 11, 2.2, 13, 4, 16, 14, 18, 40],
  bridge: [11, 1.6, 13, 3, 14, 5, 16, 14, 18, 44],
} satisfies Record<string, Stops>;
const cased = (w: Stops, add: number): Stops => w.map((v, i) => (i % 2 === 1 ? v + add * (1 + Math.max(0, w[i - 1]! - 15) * 0.5) : v));

/**
 * Shadow offset in screen px at zoom 16 and 20 for a house of `heightM`, cast away from the sun.
 * Flat-roofed Iraqi houses make clean rectangles, so the footprint shifted along the shadow reads as
 * real sunlight at a fraction of the cost of computing shadow shapes.
 */
export function shadowOffset(sun: SunPosition, heightM: number, z: number): [number, number] {
  const alt = Math.max(sun.alt, 8) * (Math.PI / 180); // never longer than ~7× the height, even at maghrib
  const lengthM = heightM / Math.tan(alt);
  const metresPerPx = (78271.517 * Math.cos(AZIZIYAH_CENTER[1] * (Math.PI / 180))) / 2 ** z;
  const away = (sun.az + 180) * (Math.PI / 180);
  const px = lengthM / metresPerPx;
  return [Math.round(Math.sin(away) * px * 10) / 10, Math.round(-Math.cos(away) * px * 10) / 10];
}

function baseLayers(p: GoldenPalette, mode: GoldenMode, sun: SunPosition, riseAt?: number): LayerSpecification[] {
  const rich = mode === 'customer' || mode === 'courier';
  const src = { source: GOLDEN_SOURCE } as const;
  const L: LayerSpecification[] = [
    { id: 'golden-land', type: 'background', paint: { 'background-color': p.land } },
    { id: 'golden-farm', type: 'fill', ...src, 'source-layer': 'landuse', filter: kindIn('farm2'), paint: { 'fill-color': p.farm, 'fill-opacity': fade(7, 0.8, 12, 0.7, 14, 0.35, 16, 0) } },
    { id: 'golden-urban', type: 'fill', ...src, 'source-layer': 'landuse', filter: kindIn('urban'), paint: { 'fill-color': p.urban } },
    { id: 'golden-palms', type: 'fill', ...src, 'source-layer': 'palms', paint: { 'fill-color': p.palm } },
    // the ground says what it is: school yards sandy, parks and pitches green
    { id: 'golden-yard', type: 'fill', ...src, 'source-layer': 'landuse', filter: kindIn('school'), minzoom: 13, paint: { 'fill-color': p.yard, 'fill-outline-color': p.wall } },
    { id: 'golden-green', type: 'fill', ...src, 'source-layer': 'landuse', filter: kindIn('green'), minzoom: 13, paint: { 'fill-color': p.green } },
  ];
  if (rich) {
    // fields drawn in rows around town; they fade before the streets get close, where the rows would read as noise
    L.push({ id: 'golden-furrows', type: 'fill', ...src, 'source-layer': 'landuse', filter: kindIn('farm2'), minzoom: 12.5, maxzoom: 15.3, paint: { 'fill-pattern': FURROW_PATTERN, 'fill-opacity': fade(12.5, 0, 13, 0.7, 14.8, 0.7, 15.3, 0) } });
    L.push({ id: 'golden-palm-crowns', type: 'fill', ...src, 'source-layer': 'palms', minzoom: 14.2, paint: { 'fill-pattern': PALM_PATTERN, 'fill-opacity': fade(14.2, 0, 15, 1) } });
  }
  if (rich && p.shadowOpacity > 0) {
    // One layer per storey class (the tiles carry 3.6 / 6.8 / 10 m), each shifted by its own shadow length.
    for (const [id, lo, hi, h] of [['low', 0, 5, 3.6], ['mid', 5, 8.5, 6.8], ['high', 8.5, 99, 10]] as const) {
      const [x16, y16] = shadowOffset(sun, h, 16);
      const [x20, y20] = shadowOffset(sun, h, 20);
      L.push({
        id: `golden-shadow-${id}`, type: 'fill', ...src, 'source-layer': 'buildings', minzoom: 15.6,
        filter: ['all', kindIn('house', 'mosque'), ['>=', ['get', 'hm'], lo], ['<', ['get', 'hm'], hi]] as never,
        paint: {
          'fill-color': p.shadow,
          'fill-opacity': fade(15.6, 0, 16.2, p.shadowOpacity),
          'fill-translate': ['interpolate', ['exponential', 2], ['zoom'], 16, ['literal', [x16, y16]], 20, ['literal', [x20, y20]]] as never,
          'fill-translate-anchor': 'map',
        },
      });
    }
  }
  L.push(
    // a mud bank along the Tigris, under the water's own edge
    { id: 'golden-bank', type: 'line', ...src, 'source-layer': 'water', filter: kindIn('river'), minzoom: 12, paint: { 'line-color': p.bank, 'line-width': zoom(12, 2, 15, 6, 18, 22), 'line-blur': fade(12, 1, 18, 8), 'line-opacity': 0.8 } },
    { id: 'golden-water', type: 'fill', ...src, 'source-layer': 'water', filter: kindIn('river'), paint: { 'fill-color': p.water } },
    { id: 'golden-water-edge', type: 'line', ...src, 'source-layer': 'water', filter: kindIn('river'), paint: { 'line-color': p.waterEdge, 'line-width': zoom(10, 0.6, 15, 1.4, 18, 3) } },
    { id: 'golden-river-line', type: 'line', ...src, 'source-layer': 'water', filter: kindIn('centre'), maxzoom: 13, layout: ROUND, paint: { 'line-color': p.water, 'line-width': zoom(7, 3.5, 11, 5, 13, 2) } },
    { id: 'golden-canal', type: 'line', ...src, 'source-layer': 'water', filter: kindIn('canal'), layout: ROUND, paint: { 'line-color': p.canal, 'line-width': zoom(10, 0.5, 14, 1, 16, 2.4, 18, 6), 'line-opacity': fade(9, 0.35, 12, 0.7, 14, 1) } },
  );
  if (rich) {
    // Light on the Tigris: three broken lines either side of the centre, only when zoomed in.
    for (const [n, off, dash, op] of [[1, -0.24, [0.1, 9], 1], [2, -0.05, [0.1, 13], 0.75], [3, 0.18, [0.1, 17], 0.55]] as const) {
      L.push({
        id: `golden-glint-${n}`, type: 'line', ...src, 'source-layer': 'water', filter: kindIn('centre'), minzoom: 15.5, layout: { 'line-cap': 'round' },
        paint: {
          'line-color': p.glint, 'line-opacity': p.glintOpacity * op * 0.8, 'line-width': zoom(13, 1.2, 16, 3, 18, 6),
          'line-offset': zoom(12.5, 10 * off, 15, 60 * off, 16, 120 * off, 17, 240 * off, 18, 480 * off), 'line-dasharray': [...dash],
        },
      });
    }
  }
  const road = { ...src, 'source-layer': 'roads' } as const;
  if (p.lampGlow && mode !== 'lite') {
    L.push({ id: 'golden-lamp-glow', type: 'line', ...road, filter: ['in', ['get', 'cls'], ['literal', ['major', 'highway', 'bridge']]] as never, layout: ROUND, paint: { 'line-color': p.lampGlow, 'line-opacity': 0.08, 'line-width': zoom(11, 6, 16, 34, 18, 90), 'line-blur': zoom(11, 4, 16, 22, 18, 50) } });
  }
  L.push(
    { id: 'golden-minor-case', type: 'line', ...road, filter: isCls('minor'), minzoom: 15.5, layout: ROUND, paint: { 'line-color': p.minorCase, 'line-width': zoom(...cased(WIDTH.minor, 0.8)), 'line-opacity': 0.45 } },
    { id: 'golden-mid-case', type: 'line', ...road, filter: isCls('mid'), minzoom: 12, layout: ROUND, paint: { 'line-color': p.majorCase, 'line-width': zoom(...cased(WIDTH.mid, 1.4)), 'line-opacity': 0.8 } },
    { id: 'golden-major-case', type: 'line', ...road, filter: isCls('major'), layout: ROUND, paint: { 'line-color': p.majorCase, 'line-width': zoom(...cased(WIDTH.major, 2)), 'line-opacity': fade(15.5, 1, 16.5, 0.5) } },
    { id: 'golden-highway-case', type: 'line', ...road, filter: isCls('highway'), layout: ROUND, paint: { 'line-color': p.highwayCase, 'line-width': zoom(...cased(WIDTH.highway, 2)) } },
    { id: 'golden-alley', type: 'line', ...road, filter: isCls('alley'), minzoom: 15, layout: ROUND, paint: { 'line-color': p.alley, 'line-width': zoom(...WIDTH.alley) } },
    { id: 'golden-minor', type: 'line', ...road, filter: isCls('minor'), minzoom: 12, layout: ROUND, paint: { 'line-color': p.minor, 'line-width': zoom(...WIDTH.minor), 'line-opacity': fade(12, 0.45, 13, 0.55, 16, 1) } },
    { id: 'golden-mid', type: 'line', ...road, filter: isCls('mid'), minzoom: 12, layout: ROUND, paint: { 'line-color': p.major, 'line-width': zoom(...WIDTH.mid) } },
    { id: 'golden-major', type: 'line', ...road, filter: isCls('major'), layout: ROUND, paint: { 'line-color': p.major, 'line-width': zoom(...WIDTH.major) } },
    { id: 'golden-highway', type: 'line', ...road, filter: isCls('highway'), layout: ROUND, paint: { 'line-color': p.highway, 'line-width': zoom(...WIDTH.highway) } },
    // Bridges: a pale deck over the water with a dark rail either side.
    { id: 'golden-bridge-case', type: 'line', ...road, filter: isCls('bridge'), layout: { 'line-cap': 'butt' }, paint: { 'line-color': p.deckCase, 'line-width': zoom(...cased(WIDTH.bridge, 4)) } },
    { id: 'golden-bridge', type: 'line', ...road, filter: isCls('bridge'), layout: { 'line-cap': 'butt' }, paint: { 'line-color': p.deck, 'line-width': zoom(...WIDTH.bridge) } },
  );
  if (rich) {
    // built streets up close: a pale kerb along main roads and a dashed centre line
    const kerb = (cls: 'major' | 'mid', w: number): LayerSpecification => ({
      id: `golden-kerb-${cls}`, type: 'line', ...road, filter: isCls(cls), minzoom: 15.5, layout: ROUND,
      paint: { 'line-color': p.kerb, 'line-gap-width': zoom(...WIDTH[cls]), 'line-width': zoom(15.5, w * 0.2, 18, w) },
    });
    L.push(kerb('major', 3.2), kerb('mid', 2.4), {
      id: 'golden-centre-line', type: 'line', ...road, filter: ['in', ['get', 'cls'], ['literal', ['major', 'highway']]] as never, minzoom: 16.8,
      paint: { 'line-color': p.marking, 'line-width': zoom(16.8, 0.6, 18, 1.8), 'line-dasharray': [3, 4], 'line-opacity': fade(16.8, 0, 17.3, 0.9) },
    });
  }
  const bld = { ...src, 'source-layer': 'buildings' } as const;
  // each house wears one of six real roof finishes; at night a share of them have their lights on
  const t = p.roofTones;
  const finish = ['match', ['%', ['coalesce', ['get', 'tone'], 0], 6], 0, t[0], 1, t[1], 2, t[2], 3, t[3], 4, t[4], t[5]];
  const house = p.litRoof ? ['case', ['==', ['get', 'lit'], 1], p.litRoof, finish] : finish;
  const roofColor = ['match', ['get', 'kind'], 'mosque', p.mosque, 'tankW', p.tankWhite, 'tankB', p.tankBlack, 'dish', p.tankWhite, 'hut', t[0], house] as never;
  L.push({
    id: 'golden-roofs', type: 'fill', ...bld, minzoom: 14.4, filter: kindIn('house', 'mosque'),
    paint: { 'fill-color': roofColor, 'fill-opacity': fade(14.4, 0, 15, 0.55, 16, 1), 'fill-outline-color': ['step', ['zoom'], p.wall, 16, p.roof] as never },
  });
  if (rich) {
    const rise = riseAt ?? (mode === 'courier' ? 15.4 : 16.4);
    // a soft dark line where walls meet the ground, so houses sit on the street instead of floating
    L.push({
      id: 'golden-wall-foot', type: 'line', ...bld, minzoom: rise, filter: kindIn('house'),
      paint: { 'line-color': p.shadow, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15.5, 0.6, 18, 4] as never, 'line-blur': ['interpolate', ['exponential', 2], ['zoom'], 15.5, 0.5, 18, 3] as never, 'line-opacity': fade(rise, 0, rise + 0.6, p.litRoof ? 0.6 : 0.32) },
    });
    if (p.windowGlow) {
      // lit houses spill warm light onto the street around them
      L.push({
        id: 'golden-window-glow', type: 'circle', ...src, 'source-layer': 'lights', minzoom: 14.5,
        paint: { 'circle-color': p.windowGlow, 'circle-opacity': 0.32, 'circle-blur': 1, 'circle-pitch-alignment': 'map', 'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 15, 5, 18, 34] as never },
      });
    }
    L.push({
      id: 'golden-houses-3d', type: 'fill-extrusion', ...bld, minzoom: rise, filter: kindIn('house', 'mosque'),
      paint: {
        'fill-extrusion-color': roofColor,
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], rise, 0, rise + 0.6, ['get', 'hm']] as never,
        'fill-extrusion-base': ['coalesce', ['get', 'base'], 0] as never,
        'fill-extrusion-vertical-gradient': true,
      },
    });
    // river bridges stand on piers, the deck a storey above the water with a dark rail each side
    L.push({
      id: 'golden-bridge-3d', type: 'fill-extrusion', ...bld, minzoom: rise, filter: kindIn('deck', 'rail', 'pier'),
      paint: {
        'fill-extrusion-color': ['match', ['get', 'kind'], 'rail', p.deckCase, 'pier', p.wall, p.deck] as never,
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], rise, 0, rise + 0.6, ['get', 'hm']] as never,
        'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], rise, 0, rise + 0.6, ['get', 'base']] as never,
      },
    });
    // the stair hut (بيت الدرج) on two- and three-storey roofs: big enough to read as soon as the houses stand up
    L.push({
      id: 'golden-roof-huts', type: 'fill-extrusion', ...bld, minzoom: rise + 0.6, filter: kindIn('hut'),
      paint: { 'fill-extrusion-color': roofColor, 'fill-extrusion-height': ['get', 'hm'] as never, 'fill-extrusion-base': ['get', 'base'] as never, 'fill-extrusion-vertical-gradient': true, 'fill-extrusion-opacity': fade(rise + 0.6, 0, rise + 1, 1) },
    });
    L.push({
      id: 'golden-roof-tanks', type: 'fill-extrusion', ...bld, minzoom: 17.5, filter: kindIn('tankW', 'tankB', 'dish'),
      paint: { 'fill-extrusion-color': roofColor, 'fill-extrusion-height': ['get', 'hm'] as never, 'fill-extrusion-base': ['get', 'base'] as never, 'fill-extrusion-opacity': fade(17.5, 0, 17.9, 0.85) },
    });
  }
  return L;
}

function labelLayers(p: GoldenPalette): LayerSpecification[] {
  const halo = { 'text-halo-color': p.labelHalo, 'text-halo-width': 1.4, 'text-halo-blur': 0.4 };
  const src = { source: GOLDEN_SOURCE } as const;
  return [
    {
      id: GOLDEN_FIRST_LABEL, type: 'symbol', ...src, 'source-layer': 'roads', minzoom: 14,
      filter: ['all', ['has', 'name'], ['any', ['in', ['get', 'cls'], ['literal', ['major', 'mid', 'highway']]], ['>=', ['zoom'], 15.5]]] as never,
      layout: {
        'symbol-placement': 'line', 'text-field': ['get', 'name'] as never, 'text-font': [...GOLDEN_FONTS.medium],
        'text-size': fade(14, 11, 17, 14), 'text-max-angle': 30, 'symbol-spacing': 320, 'text-padding': 4,
      },
      paint: { 'text-color': p.label, ...halo },
    },
    {
      id: 'golden-river-names', type: 'symbol', ...src, 'source-layer': 'water', minzoom: 11,
      filter: ['all', kindIn('centre', 'canal'), ['has', 'name']] as never,
      layout: {
        'symbol-placement': 'line', 'text-field': ['get', 'name'] as never, 'text-font': [...GOLDEN_FONTS.bold],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, ['match', ['get', 'kind'], 'centre', 13, 10], 15, ['match', ['get', 'kind'], 'centre', 16, 12]] as never,
        'symbol-spacing': 420, 'text-max-angle': 25,
      },
      paint: { 'text-color': p.river, 'text-halo-color': p.riverHalo, 'text-halo-width': 1.6 },
    },
    {
      id: 'golden-places', type: 'symbol', ...src, 'source-layer': 'places', minzoom: 15.5,
      filter: ['any', ['==', ['get', 'rank'], 1], ['>=', ['zoom'], 16.5]] as never,
      layout: { 'text-field': ['get', 'name'] as never, 'text-font': [...GOLDEN_FONTS.regular], 'text-size': 11.5, 'text-max-width': 8, 'text-padding': 6, 'symbol-sort-key': ['get', 'rank'] as never },
      paint: { 'text-color': p.area, ...halo },
    },
    {
      id: 'golden-localities', type: 'symbol', ...src, 'source-layer': 'localities',
      filter: kindIn('city', 'town', 'village', 'hamlet'),
      layout: {
        'text-field': ['get', 'name'] as never, 'text-font': [...GOLDEN_FONTS.bold], 'symbol-sort-key': ['get', 'rank'] as never, 'text-padding': 8,
        'text-size': ['match', ['get', 'kind'], 'city', 16, 'town', 15, 12] as never,
      },
      // The town's own name fades as its streets take over.
      paint: { 'text-color': p.area, ...halo, 'text-opacity': fade(14.5, 1, 15.5, 0) },
    },
  ];
}

/**
 * The Golden hour (عصرية) basemap as code: the real Aziziyah from our own PMTiles, coloured by the
 * light of the hour, with Arabic labels in the brand font. Apps add their own route and pin layers
 * on top (before `GOLDEN_FIRST_LABEL`) and register `goldenImages()` and the PMTiles protocol.
 * See docs/specs/2026-10-09-map-golden-hour-design.md.
 */
export function buildGoldenStyle(opts: GoldenStyleOptions): StyleSpecification {
  const mode = opts.mode ?? 'customer';
  const { light, sun } = resolveLight(opts);
  const p = GOLDEN_PALETTES[light];
  const style: StyleSpecification = {
    version: 8,
    name: `Driver Golden hour · ${light}`,
    metadata: { 'driver:basemap': 'golden-hour', 'driver:light': light, 'driver:mode': mode },
    center: AZIZIYAH_CENTER,
    zoom: AZIZIYAH_DEFAULT_ZOOM,
    glyphs: opts.glyphs,
    sources: {
      [GOLDEN_SOURCE]: { type: 'vector', url: opts.pmtilesUrl, attribution: GOLDEN_ATTRIBUTION },
    },
    layers: [...baseLayers(p, mode, sun, opts.riseAt), ...labelLayers(p)],
    light: {
      anchor: 'map',
      color: p.light.color,
      intensity: p.light.intensity,
      position: [1.15, sun.az, Math.min(75, Math.max(30, 90 - sun.alt))],
    },
  };
  if (mode === 'courier' || mode === 'customer') {
    // a warm sky over every tilted view, and far streets fading into haze so the near street stays sharp
    style.sky = {
      'sky-color': p.sky.sky, 'horizon-color': p.sky.horizon, 'fog-color': p.sky.fog,
      'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.8, 'fog-ground-blend': mode === 'courier' ? 0.55 : 0.62, 'atmosphere-blend': 0,
    };
  }
  return style;
}
