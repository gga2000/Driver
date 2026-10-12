import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import { M_PER_DEG_LAT, mPerDegLng, type LngLat } from './metres.js';
import type { GoldenLight } from './sun.js';

/**
 * Food carts (عربانات) on the Golden hour map (the carts thread, 2026-10-11): each cart stands at its kerb as a wooden
 * push cart on two wheels, with handles, a glass case, four thin poles, a striped awning, a bulb under it and a gas
 * bottle, and on top what it sells: a coal tray, skewers and smoke for liver; a fryer pot and glass case for falafel; a
 * brass teapot, glasses and three stools for tea; a corn grill; two pots for bagilla. Open carts glow on the street
 * (stronger when chosen), closed ones stand grey and unlit. Carts are small, so they are drawn about 3.2× life to read
 * among the houses. Same pattern as `restaurantScene`: add the three sources (`CART_SOURCES`), then `cartLayers`.
 *
 * Models are in metres in a local frame: x runs along the cart, −y points to the street where people stand (the
 * `facing` bearing), handles at −x.
 */
export type CartKind = 'liver' | 'falafel' | 'tea' | 'corn' | 'bagilla' | 'cart';
export const CART_KINDS: readonly CartKind[] = ['liver', 'falafel', 'tea', 'corn', 'bagilla', 'cart'];

export interface MapCart {
  id: string;
  kind: CartKind;
  /** Where the cart stands (at the kerb). */
  at: LngLat;
  /** Compass bearing from the cart to the street, the side people buy from. Default 180. */
  facing?: number;
  open: boolean;
}
export interface CartSceneOptions {
  light?: GoldenLight;
  selectedId?: string | null;
}

/** The awning stripes. Kept here as constants so the pink can be swapped in one place. */
export const CART_AWNING = { night: '#F25CC0', day: '#D9409F', cream: '#FFF1DE' } as const;
/** A closed cart: every part this one grey, no light, no smoke. */
export const CART_CLOSED = '#6E6258';
/** Carts appear once a 3 m model reads among the houses. */
export const CART_MINZOOM = 15.8;
export const CART_SOURCES = { solid: 'golden-carts', soft: 'golden-carts-soft', glow: 'golden-carts-glow' } as const;
/** Drawn larger than life so a cart reads among the houses. */
const SCALE = 3.2;

type Part = 'wood' | 'woodDark' | 'steel' | 'glass' | 'awnA' | 'awnB' | 'pole' | 'tire' | 'ember' | 'smoke' | 'bulb' | 'gas' | 'brass' | 'pot' | 'corn' | 'food' | 'tray' | 'stool';
interface Piece { ring: [number, number][]; base: number; top: number; part: Part; soft?: boolean }

const NIGHT: Record<Part, string> = {
  wood: '#8A5A34', woodDark: '#4A3020', steel: '#9A9288', glass: '#FFD89A', awnA: CART_AWNING.night, awnB: CART_AWNING.cream, pole: '#2A1E15',
  tire: '#1E1914', ember: '#FF6A2A', smoke: '#7A6A5A', bulb: '#FFE6A8', gas: '#C8352B', brass: '#E0A83E', pot: '#8A847A',
  corn: '#F2C14A', food: '#C8642A', tray: '#3A342E', stool: '#C9BFAE',
};
const DAY: Record<Part, string> = { ...NIGHT, wood: '#B07A48', woodDark: '#6E4A2C', glass: '#F6E7C8', smoke: '#E6DCCD', pole: '#3B2C20', bulb: '#FFE1A0', tray: '#5A5048', awnA: CART_AWNING.day };

/** A cart part's colour in a light (golden and day share the daylight colours). */
export function cartColour(part: Part, light: GoldenLight, open = true): string {
  if (!open) return CART_CLOSED;
  return (light === 'night' ? NIGHT : DAY)[part];
}

const box = (x0: number, x1: number, y0: number, y1: number, base: number, top: number, part: Part): Piece => ({ ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], base, top, part });
function cyl(cx: number, cy: number, r: number, base: number, top: number, part: Part, n = 12): Piece {
  const ring: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * 2 * Math.PI;
    ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return { ring, base, top, part };
}
const soft = (p: Piece): Piece => ({ ...p, soft: true });

/** The cart's pieces (metres, life size). `lit`: the bulb burns (an open cart at night); `open`: smoke rises. */
export function cartModel(kind: CartKind, opts: { open: boolean; lit: boolean }): Piece[] {
  const p: Piece[] = [];
  // body: a wooden push cart on two big wheels, handles to the back, a steel lip round the top
  p.push(box(-1.1, 1.1, -0.55, 0.55, 0.55, 1.0, 'wood'));
  p.push(box(-1.12, 1.12, -0.57, 0.57, 1.0, 1.06, 'steel'));
  for (const y of [-0.62, 0.62]) p.push(box(-0.35, 0.35, y - 0.06, y + 0.06, 0, 0.7, 'tire'));
  p.push(box(-1.6, -1.1, -0.45, -0.38, 0.85, 0.92, 'woodDark'), box(-1.6, -1.1, 0.38, 0.45, 0.85, 0.92, 'woodDark'));
  p.push(box(1.0, 1.08, -0.5, 0.5, 0, 0.55, 'woodDark'));
  // four thin poles, the striped awning with its front valance, the bulb under it
  for (const [x, y] of [[-1.05, -0.5], [1.05, -0.5], [-1.05, 0.5], [1.05, 0.5]] as const) p.push(box(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 1.06, 2.25, 'pole'));
  const n = 7, w = 2.5 / n;
  for (let i = 0; i < n; i++) {
    const x0 = -1.25 + i * w, part = i % 2 ? 'awnB' : 'awnA';
    p.push(box(x0, x0 + w, -0.75, 0.75, 2.25, 2.36, part), box(x0, x0 + w, -0.8, -0.74, 2.0, 2.36, part));
  }
  p.push(box(-0.08, 0.08, -0.08, 0.08, 1.9, 2.05, 'bulb'));
  if (opts.lit) p.push(box(-0.12, 0.12, -0.12, 0.12, 1.86, 1.95, 'bulb'));
  const smoke = (...s: Piece[]) => { if (opts.open) p.push(...s.map(soft)); };
  // what it sells, on top
  if (kind === 'liver') {
    p.push(box(-0.9, 0.4, -0.4, 0.4, 1.06, 1.2, 'tray'), box(-0.85, 0.35, -0.35, 0.35, 1.2, 1.24, 'ember'));
    for (let i = 0; i < 6; i++) p.push(box(-0.8 + i * 0.2, -0.72 + i * 0.2, -0.38, 0.38, 1.24, 1.3, 'food'));
    p.push(box(0.5, 1.05, -0.45, 0.45, 1.06, 1.55, 'glass'));
    smoke(cyl(-0.3, 0, 0.35, 1.5, 1.9, 'smoke', 8), cyl(-0.1, 0.1, 0.28, 2.5, 2.9, 'smoke', 8));
  } else if (kind === 'falafel') {
    p.push(cyl(-0.5, 0, 0.36, 1.06, 1.4, 'pot', 14), cyl(-0.5, 0, 0.3, 1.4, 1.43, 'ember', 14));
    p.push(box(0, 1.05, -0.45, 0.45, 1.06, 1.6, 'glass'));
    smoke(cyl(-0.5, 0, 0.3, 1.6, 2.0, 'smoke', 8));
  } else if (kind === 'tea') {
    p.push(cyl(-0.4, 0, 0.26, 1.06, 1.7, 'brass', 12), cyl(-0.4, 0, 0.16, 1.7, 1.9, 'brass', 10));
    p.push(box(0.2, 0.9, -0.35, 0.35, 1.06, 1.12, 'tray'));
    for (let i = 0; i < 4; i++) p.push(cyl(0.3 + i * 0.17, 0, 0.05, 1.12, 1.24, 'glass', 6));
    smoke(cyl(-0.35, 0.05, 0.2, 2.0, 2.2, 'smoke', 8));
    for (const [x, y] of [[0.4, -1.5], [-0.7, -1.6], [1.4, -1.2]] as const) p.push(cyl(x, y, 0.18, 0, 0.45, 'stool', 8));
  } else if (kind === 'corn') {
    p.push(box(-0.9, 0.9, -0.4, 0.4, 1.06, 1.2, 'tray'), box(-0.85, 0.85, -0.35, 0.35, 1.2, 1.22, 'ember'));
    for (let i = 0; i < 7; i++) p.push(box(-0.8 + i * 0.24, -0.66 + i * 0.24, -0.3, 0.3, 1.22, 1.34, 'corn'));
    smoke(cyl(0, 0, 0.35, 1.6, 2.0, 'smoke', 8));
  } else if (kind === 'bagilla') {
    p.push(cyl(-0.4, 0, 0.42, 1.06, 1.5, 'pot', 14), cyl(0.5, 0, 0.3, 1.06, 1.3, 'pot', 12));
    smoke(cyl(-0.4, 0, 0.35, 1.7, 2.1, 'smoke', 8));
  } else {
    // any other cart: a long glass case of its wares
    p.push(box(-0.95, 0.95, -0.42, 0.42, 1.06, 1.55, 'glass'));
  }
  p.push(cyl(-1.5, 0.75, 0.16, 0, 0.6, 'gas', 10));
  return p;
}

function place(ring: [number, number][], at: LngLat, facing: number): Polygon {
  const b = (facing * Math.PI) / 180;
  // local −y points to the street (the facing bearing); local +x is 90° clockwise from it
  const yx = -Math.sin(b), yy = -Math.cos(b);
  const xx = Math.sin(b + Math.PI / 2), xy = Math.cos(b + Math.PI / 2);
  const kx = mPerDegLng(at[1]);
  return { type: 'Polygon', coordinates: [ring.map(([x, y]) => [at[0] + ((x * xx + y * yx) * SCALE) / kx, at[1] + ((x * xy + y * yy) * SCALE) / M_PER_DEG_LAT])] };
}

export interface CartScene {
  solid: FeatureCollection<Polygon>;
  soft: FeatureCollection<Polygon>;
  glow: FeatureCollection<Point>;
}

/** GeoJSON for the carts' sources (`CART_SOURCES`): the models, their smoke, and the light on the street. */
export function cartScene(list: readonly MapCart[], opts: CartSceneOptions = {}): CartScene {
  const light = opts.light ?? 'golden';
  const night = light === 'night';
  const solid: Feature<Polygon>[] = [], softs: Feature<Polygon>[] = [], glow: Feature<Point>[] = [];
  for (const c of list) {
    const facing = c.facing ?? 180;
    for (const piece of cartModel(c.kind, { open: c.open, lit: night && c.open })) {
      const f: Feature<Polygon> = {
        type: 'Feature',
        properties: { id: c.id, c: cartColour(piece.part, light, c.open), h: piece.top * SCALE, b: piece.base * SCALE },
        geometry: place(piece.ring, c.at, facing),
      };
      (piece.soft ? softs : solid).push(f);
    }
    if (c.open) glow.push({ type: 'Feature', properties: { id: c.id, s: c.id === opts.selectedId ? 1 : 0 }, geometry: { type: 'Point', coordinates: c.at } });
  }
  return {
    solid: { type: 'FeatureCollection', features: solid },
    soft: { type: 'FeatureCollection', features: softs },
    glow: { type: 'FeatureCollection', features: glow },
  };
}

/** The layers that draw `cartScene` (add the three GeoJSON sources first, then these, under the labels). */
export function cartLayers(light: GoldenLight = 'golden'): LayerSpecification[] {
  const night = light === 'night';
  const ext = { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'] } as {
    'fill-extrusion-color': ExpressionSpecification; 'fill-extrusion-height': ExpressionSpecification; 'fill-extrusion-base': ExpressionSpecification;
  };
  const fadeIn = ['interpolate', ['linear'], ['zoom'], CART_MINZOOM, 0, CART_MINZOOM + 0.4, 1] as ExpressionSpecification;
  return [
    {
      id: 'golden-cart-glow', type: 'circle', source: CART_SOURCES.glow, minzoom: CART_MINZOOM - 0.6,
      paint: {
        'circle-color': night ? '#FFB04A' : '#F6A23A', 'circle-blur': 1, 'circle-pitch-alignment': 'map',
        'circle-opacity': ['case', ['==', ['get', 's'], 1], night ? 0.8 : 0.45, night ? 0.55 : 0.25],
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 15, 6, 19, ['case', ['==', ['get', 's'], 1], 190, 120]],
      },
    } as LayerSpecification,
    { id: 'golden-carts-3d', type: 'fill-extrusion', source: CART_SOURCES.solid, minzoom: CART_MINZOOM, paint: { ...ext, 'fill-extrusion-vertical-gradient': true, 'fill-extrusion-opacity': fadeIn } } as LayerSpecification,
    { id: 'golden-carts-soft', type: 'fill-extrusion', source: CART_SOURCES.soft, minzoom: CART_MINZOOM + 0.8, paint: { ...ext, 'fill-extrusion-vertical-gradient': false, 'fill-extrusion-opacity': 0.4 } } as LayerSpecification,
  ];
}
