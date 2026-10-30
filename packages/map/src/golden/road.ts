import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { services } from '@driver/design-tokens';
import { GOLDEN_FONTS } from './fonts.js';
import { nearestOnSegment, pathMetres, slicePath, type LngLat } from './metres.js';
import { ROAD_PATHS } from './road-data.js';
import type { GoldenLight } from './sun.js';

/**
 * "The road" (N13, for the الرجعة trip screens): the real road from an Aziziyah garage to Baghdad or Kut, the part the
 * car has driven in gold and the part ahead in cream, and the towns on the way with the one coming next. The roads are
 * real (`road-data.ts`, made by `tools/map-tiles/roads.py`); town names are place names, the km words come from the app.
 * `roadProgress` answers "where are we": km driven, km left and the next town with its km.
 */

export type RoadGarage = 'bab1' | 'bab2' | 'souq';
export type RoadCity = 'baghdad' | 'kut';
/** As the trips API says it: `from_aziziyah` is garage → city, `to_aziziyah` the way back. */
export type RoadDirection = 'from_aziziyah' | 'to_aziziyah';

export interface RoadTown {
  nameAr: string;
  /** `city` is the end of the road, `landmark` a place everyone names on the way (جسر ديالى). */
  kind: 'town' | 'landmark' | 'city';
  at: LngLat;
  /** Metres along the road from where it starts. */
  m: number;
}

export interface IntercityRoad {
  garage: RoadGarage;
  city: RoadCity;
  direction: RoadDirection;
  /** From where the car starts to where it ends. */
  path: readonly LngLat[];
  totalM: number;
  /** In the order the car passes them; the last is the end of the road. */
  towns: readonly RoadTown[];
}

/** The end of the way back, whichever garage the car parks at. */
const HOME_AR = 'العزيزية';

/** The places on each road (Overture divisions, checked against the road). A place counts when the road passes it within this. */
const NEAR_M = 2500;
const TOWNS: Record<RoadCity, readonly { nameAr: string; kind: RoadTown['kind']; at: LngLat }[]> = {
  baghdad: [
    { nameAr: 'الحفرية', kind: 'town', at: [44.8329, 32.9912] },
    { nameAr: 'الوحدة', kind: 'town', at: [44.6882, 33.1246] },
    { nameAr: 'بسماية', kind: 'town', at: [44.6207, 33.193] },
    { nameAr: 'جسر ديالى', kind: 'landmark', at: [44.528, 33.2285] },
    { nameAr: 'الزعفرانية', kind: 'town', at: [44.4849, 33.2618] },
    { nameAr: 'بغداد', kind: 'city', at: [44.4165, 33.3344] },
  ],
  kut: [
    { nameAr: 'الدبوني', kind: 'town', at: [45.3052, 32.7455] },
    { nameAr: 'الكوت', kind: 'city', at: [45.8189, 32.5126] },
  ],
};

/** Where `p` sits on the path: metres along it and metres off it. */
function project(path: readonly LngLat[], cum: readonly number[], p: LngLat): { m: number; off: number } {
  let best = { m: 0, off: Infinity };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const hit = nearestOnSegment(p, a, b);
    if (hit.m < best.off) {
      const along = Math.hypot((hit.at[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (hit.at[1] - a[1]) * 110540);
      best = { m: cum[i - 1]! + along, off: hit.m };
    }
  }
  return best;
}

/** The road from `garage` to `city` (or back), with its towns in passing order. */
export function intercityRoad(garage: RoadGarage, city: RoadCity, direction: RoadDirection = 'from_aziziyah'): IntercityRoad {
  const out = ROAD_PATHS[`${garage}-${city}`]!;
  const path = direction === 'from_aziziyah' ? out : [...out].reverse();
  const cum = pathMetres(path);
  const totalM = cum[cum.length - 1]!;
  const places = direction === 'from_aziziyah'
    ? TOWNS[city]
    : [...TOWNS[city].filter((t) => t.kind !== 'city'), { nameAr: HOME_AR, kind: 'city' as const, at: out[0]! }];
  const towns: RoadTown[] = [];
  for (const t of places) {
    if (t.kind === 'city') { towns.push({ ...t, m: totalM }); continue; }
    const hit = project(path, cum, t.at);
    if (hit.off <= NEAR_M) towns.push({ ...t, m: hit.m });
  }
  towns.sort((a, b) => a.m - b.m);
  return { garage, city, direction, path, totalM, towns };
}

export interface RoadProgress {
  /** Metres driven along the road. */
  m: number;
  leftM: number;
  /** The next town ahead and how far it is; null once the car is at the end. */
  next: { town: RoadTown; inM: number } | null;
  /** The towns already behind. */
  passed: readonly RoadTown[];
}

/** Within this of a town the car is "at" it, so the next one shows instead. */
const AT_TOWN_M = 300;

/** Where the car is on the road, from its position (projected onto the road) or from metres driven. */
export function roadProgress(road: IntercityRoad, at: LngLat | { m: number }): RoadProgress {
  const raw = Array.isArray(at) ? project(road.path, pathMetres(road.path), at as LngLat).m : (at as { m: number }).m;
  const m = Math.max(0, Math.min(road.totalM, raw));
  const ahead = road.towns.filter((t) => t.m - m > AT_TOWN_M);
  const nextTown = ahead[0];
  return {
    m,
    leftM: road.totalM - m,
    next: nextTown ? { town: nextTown, inM: nextTown.m - m } : null,
    passed: road.towns.filter((t) => !ahead.includes(t)),
  };
}

/** Whole km for the screen: at least 1 while anything is left, so it never says 0 before arriving. */
export function roadKm(metres: number): number {
  return metres <= 0 ? 0 : Math.max(1, Math.round(metres / 1000));
}

/**
 * The road as GeoJSON: the part driven (`part: 'driven'`), the part ahead (`'ahead'`), each town (`'town'`, with
 * `name`, `kind`, `passed` and, for the next one, `next: true` and `label` from `labelOf`), the start (`'start'`) and
 * the car (`'car'`) when `m` is above 0.
 */
export function roadGeoJSON(road: IntercityRoad, opts: { m?: number; labelOf?: (town: RoadTown, inM: number) => string } = {}) {
  const p = roadProgress(road, { m: opts.m ?? 0 });
  type F = { type: 'Feature'; properties: Record<string, string | number | boolean>; geometry: { type: 'LineString'; coordinates: LngLat[] } | { type: 'Point'; coordinates: LngLat } };
  const features: F[] = [];
  const driven = slicePath(road.path, 0, p.m);
  const ahead = slicePath(road.path, p.m, road.totalM);
  if (driven.length >= 2) features.push({ type: 'Feature', properties: { part: 'driven' }, geometry: { type: 'LineString', coordinates: driven } });
  if (ahead.length >= 2) features.push({ type: 'Feature', properties: { part: 'ahead' }, geometry: { type: 'LineString', coordinates: ahead } });
  features.push({ type: 'Feature', properties: { part: 'start' }, geometry: { type: 'Point', coordinates: road.path[0]! } });
  for (const t of road.towns) {
    const isNext = p.next?.town === t;
    const props: Record<string, string | number | boolean> = { part: 'town', name: t.nameAr, kind: t.kind, passed: p.passed.includes(t), next: isNext };
    props.label = isNext && opts.labelOf ? opts.labelOf(t, p.next!.inM) : t.nameAr;
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: t.kind === 'city' ? road.path[road.path.length - 1]! : t.at } });
  }
  if (p.m > 0) {
    const at = driven[driven.length - 1] ?? road.path[0]!;
    features.push({ type: 'Feature', properties: { part: 'car' }, geometry: { type: 'Point', coordinates: at } });
  }
  return { type: 'FeatureCollection' as const, features };
}

/** Bounds of the whole road, for fitting the camera: [[west, south], [east, north]]. */
export function roadBounds(road: IntercityRoad): [LngLat, LngLat] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of road.path) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}

/**
 * The road's layers, before `GOLDEN_FIRST_LABEL`: a date-brown road, gold where the car has been and a cream dash
 * ahead; towns are dots (gold once passed), the next town's label is bold with its km and always shows, the city end
 * is a bigger ring (the map names the city itself until it is the next stop). At night the road is the lighter brown.
 * The car itself is the app's own marker; `car` is only a soft gold halo under it. Nothing moves.
 */
export function roadLayers(opts: { source: string; light: GoldenLight; id?: string }): LayerSpecification[] {
  const id = opts.id ?? 'road';
  const night = opts.light === 'night';
  const t = night ? services.dark.trips : services.light.trips;
  // at night the date brown would sink into the dark land, so the road is drawn in its lighter brown
  const brown = night ? t.light : t.fill;
  const gold = t.pattern;
  const cream = night ? '#F3E4D3' : '#FFF3E2';
  const ink = night ? '#FFF3E2' : '#2A170C';
  const passedInk = night ? '#B89A7C' : '#7A5A3E';
  const label = (size: number, font: readonly string[], always: boolean) => ({
    'text-field': ['get', 'label'] as never,
    'text-font': [...font],
    'text-size': size,
    'text-offset': [0, -1.4] as [number, number],
    'text-anchor': 'bottom' as const,
    'text-max-width': 14,
    'text-allow-overlap': always,
  });
  const paint = (color: string | never) => ({ 'text-color': color, 'text-halo-color': night ? '#120D09' : '#FFFCF6', 'text-halo-width': 2 });
  const width = (lo: number, hi: number) => ['interpolate', ['exponential', 1.4], ['zoom'], 7, lo, 15, hi] as never;
  const is = (part: string) => ['==', ['get', 'part'], part] as never;
  const line = ['any', is('driven'), is('ahead')] as never;
  return [
    { id: `${id}-casing`, type: 'line', source: opts.source, filter: line, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': brown, 'line-width': width(5, 14) } },
    { id: `${id}-driven`, type: 'line', source: opts.source, filter: is('driven'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': gold, 'line-width': width(2.6, 8) } },
    { id: `${id}-ahead`, type: 'line', source: opts.source, filter: is('ahead'), layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': cream, 'line-width': width(1.4, 4), 'line-dasharray': [1.6, 1.4] } },
    { id: `${id}-car`, type: 'circle', source: opts.source, filter: is('car'), paint: { 'circle-radius': width(9, 20), 'circle-color': gold, 'circle-opacity': 0.35, 'circle-blur': 0.4 } },
    { id: `${id}-start`, type: 'circle', source: opts.source, filter: is('start'), paint: { 'circle-radius': width(4, 7), 'circle-color': gold, 'circle-stroke-color': brown, 'circle-stroke-width': 2.5 } },
    {
      id: `${id}-town`, type: 'circle', source: opts.source, filter: is('town'),
      paint: {
        'circle-radius': ['case', ['==', ['get', 'kind'], 'city'], 8, ['get', 'next'], 6.5, 4.5] as never,
        'circle-color': ['case', ['get', 'passed'], gold, cream] as never,
        'circle-stroke-color': brown,
        'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'city'], 3.5, 2.5] as never,
      },
    },
    // the next town (or the end) always shows its name and km, over the map's own labels
    { id: `${id}-next-label`, type: 'symbol', source: opts.source, filter: ['all', is('town'), ['get', 'next']] as never, layout: label(15, GOLDEN_FONTS.bold, true), paint: paint(ink) },
    // the other towns on the way, when there is room; the end city is already named by the map itself
    {
      id: `${id}-town-label`, type: 'symbol', source: opts.source,
      filter: ['all', is('town'), ['!', ['get', 'next']], ['!=', ['get', 'kind'], 'city']] as never,
      layout: label(12.5, GOLDEN_FONTS.medium, false),
      paint: paint(['case', ['get', 'passed'], passedInk, ink] as never),
    },
  ];
}
