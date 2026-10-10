import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Polygon, Point } from 'geojson';
import { GOLDEN_PALETTES } from './palettes.js';
import { TYPICAL_SUN, type GoldenLight, type SunPosition } from './sun.js';

/**
 * Restaurants in 3D (Ali, 2026-10-10: "I want them to look state of the art"). Every restaurant on the
 * Golden hour map stands as a model of a real Aziziyah food shop, and each kind has its own body:
 * - grill (كص، مشويات): one storey, open counter on the street, a tall chimney with smoke;
 * - bakery (فرن، صمون): one storey with a clay tannour dome out front and samoon on the rack;
 * - shawarma: narrow and deep, two storeys, the spits glowing in the window;
 * - sweets: two storeys of glass shopfront under a striped awning, cake stands out front;
 * - home food (أكل بيت): a house behind its courtyard wall and a palm, pots steaming by the gate;
 * - tea (چايخانة): a wide low front under a tin canopy, wooden benches and the samovar;
 * - juice: a small kiosk walled in fruit crates;
 * - restaurant: a big two-storey family restaurant.
 * All share the Iraqi street details: a full-width لافتة in the kind's colour, roller-shutter drums, a dark
 * base, a coloured cornice, off-white tanks on stands, AC boxes, white plastic chairs on terrazzo under
 * parasols in the shop's colours, a delivery bike. (Ali, 2026-10-10, "a mix of them": these street shops,
 * with the first look's parasols and bulbs, and light tubes in the shop's colour at night.)
 *
 * Three zoom tiers keep it calm: far away (below z17) a sign pylon in saffron finds the shop among the
 * houses; up close the chairs, bulbs, bike and wares appear. The chosen shop lights up: its interior
 * glows, light tubes trace its edges, a fanous hangs from its sign and a pool of light spreads on the
 * street. At night every shop is lit and traced in its tubes.
 *
 * Models are built in metres in a local frame: x runs along the shop front, y goes back from the street
 * (the front is y = 0, the pavement is y < 0), then turned to face the street (`facing`, the compass
 * bearing from the shop to the road; `faceRoad` works it out from the streets on screen).
 */
export type RestaurantKind = 'grill' | 'bakery' | 'shawarma' | 'sweets' | 'home' | 'cafe' | 'juice' | 'restaurant';
export const RESTAURANT_KINDS: readonly RestaurantKind[] = ['grill', 'bakery', 'shawarma', 'sweets', 'home', 'cafe', 'juice', 'restaurant'];

type LngLat = [number, number];
export interface MapRestaurant {
  id: string;
  /** The shop's own pin: the middle of its street front. */
  at: LngLat;
  /** Compass bearing from the shop to its street; `faceRoad` finds it. Default 180 (street to the south). */
  facing?: number;
  kind?: RestaurantKind;
}
export interface RestaurantSceneOptions {
  light?: GoldenLight;
  /** The sun the map was built for; the shops cast their shadows away from it. */
  sun?: SunPosition;
  selectedId?: string | null;
}

/** Restaurants rise a little after the houses, when a shop front is big enough to read. */
export const RESTAURANT_MINZOOM = 15.6;
/** Below this the pylon stands in for the details; above it the chairs, bulbs, bike and wares appear. */
export const RESTAURANT_DETAIL_ZOOM = 17;
export const RESTAURANT_SOURCES = { solid: 'golden-restaurants', soft: 'golden-restaurants-soft', glow: 'golden-restaurants-glow' } as const;

// ---------------------------------------------------------------------------------------------------------
// Colours

export const RESTAURANT_PARTS = [
  'pave', 'base', 'wall', 'roof', 'wall2', 'accent', 'frame', 'interior', 'lit', 'glassLit', 'door', 'shutter', 'sign',
  'signText', 'awningA', 'awningB', 'window', 'windowDark', 'ac', 'tank', 'dish', 'pole', 'bulb', 'chair',
  'table', 'bench', 'rug', 'canopy', 'steel', 'ember', 'clay', 'bread', 'sack', 'meat', 'kunafa', 'brass',
  'pot', 'plant', 'trunk', 'crate1', 'crate2', 'crate3', 'crate4', 'smoke', 'pylon', 'lanternFrame',
  'lanternGlow', 'bike', 'seat', 'tire', 'deliveryBox', 'neon',
] as const;
export type RestaurantPart = (typeof RESTAURANT_PARTS)[number];
type Part = RestaurantPart;

type KindPart = 'sign' | 'signText' | 'accent' | 'awningA' | 'awningB' | 'neon';
// Each kind has its own saturated sign colour, like the real shop signs: grills red, bakeries wheat,
// shawarma olive, sweets rose, home food date brown, tea dark coffee, juice orange, restaurants saffron.
const KIND_LOOK: Record<RestaurantKind, { sign: string; signText: string }> = {
  grill: { sign: '#B3261E', signText: '#FFE9B8' },
  bakery: { sign: '#C98A2E', signText: '#3A2208' },
  shawarma: { sign: '#4F6B1E', signText: '#FFEFB8' },
  sweets: { sign: '#C2416E', signText: '#FFF0F3' },
  home: { sign: '#8A4A12', signText: '#FFE2A8' },
  cafe: { sign: '#5A3418', signText: '#F6C47A' },
  juice: { sign: '#EF7A12', signText: '#FFF6DC' },
  restaurant: { sign: '#E08A1E', signText: '#2B1A0A' },
};

type Shared = Exclude<Part, KindPart>;
const DAY: Record<Shared, string> = {
  pave: '#EAD7B4', base: '#6E5038', roof: '#F3E2C2', wall: '#E2B77A', wall2: '#EBC690', frame: '#3B2C20', interior: '#5A4030',
  lit: '#FFB547', glassLit: '#FFE2B0', door: '#4A3424', shutter: '#8C8579', window: '#7A6450', windowDark: '#7A6450',
  ac: '#F4F0E6', tank: '#E4DCCB', dish: '#CFC8BC', pole: '#3B2C20', bulb: '#FFE1A0', chair: '#F1EEE6',
  table: '#F1EEE6', bench: '#8A5A34', rug: '#9E2B1F', canopy: '#B9B2A6', steel: '#5A5048', ember: '#E2562A',
  clay: '#B8693A', bread: '#E7B66E', sack: '#EFE6D2', meat: '#A8572A', kunafa: '#E8892E', brass: '#C99A3A',
  pot: '#9A938A', plant: '#6E7A3A', trunk: '#7A5A3C', crate1: '#E8892E', crate2: '#C8352B', crate3: '#7E9A3A',
  crate4: '#F0C23A', smoke: '#D6CCBD', pylon: '#E08A1E', lanternFrame: '#5A3410', lanternGlow: '#FFC65A',
  bike: '#C8352B', seat: '#2E2925', tire: '#2E2925', deliveryBox: '#E08A1E',
};
const GOLDEN: Record<Shared, string> = { ...DAY, roof: '#F1D7AA', pave: '#EACB9C', wall: '#E3AE6C', wall2: '#ECC084', smoke: '#E2CDB0' };
const SUNSET: Record<Shared, string> = { ...GOLDEN, roof: '#E4C3A0', pave: '#E2BE98', wall: '#D69E70', wall2: '#E2B288', smoke: '#D9BDA2' };
// Night: walls stay readable warm brown, every shop is lit from inside, signs and bulbs glow.
const NIGHT: Record<Shared, string> = {
  ...DAY,
  pave: '#4A3A2A', base: '#2E2117', roof: '#3E2F22', wall: '#6A4E36', wall2: '#5E4430', frame: '#1E1611', interior: '#FFB547',
  door: '#2A1E15', shutter: '#4A443C', window: '#F0A048', windowDark: '#3A2C20', ac: '#8A7E6E', tank: '#8A8070',
  dish: '#7A6E60', pole: '#1E1611', bulb: '#FFD57A', chair: '#B8AE9E', table: '#B8AE9E', bench: '#4A3020',
  rug: '#6A2018', canopy: '#5A544C', steel: '#3A342E', ember: '#FF6A2A', clay: '#7A4428', bread: '#B88A50',
  sack: '#9A9080', meat: '#C8642A', kunafa: '#D07A2A', brass: '#B8862E', pot: '#5A544C', plant: '#3E4526',
  trunk: '#3A2A1C', crate1: '#A86420', crate2: '#8A2A20', crate3: '#56682A', crate4: '#A8882A', smoke: '#6A5C4C',
  lanternFrame: '#2A1A0A', lanternGlow: '#FFD06A', bike: '#8A2A20', seat: '#1E1914', tire: '#1E1914',
};
const SHARED: Record<GoldenLight, Record<Shared, string>> = { day: DAY, morning: DAY, golden: GOLDEN, sunset: SUNSET, night: NIGHT };

function lift(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(Math.min(255, v + (255 - v) * k)));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** The colour of one part of one kind's shop in one light. Signs glow brighter at night. */
export function restaurantColour(part: Part, kind: RestaurantKind, light: GoldenLight): string {
  const { sign, signText } = KIND_LOOK[kind];
  const night = light === 'night';
  switch (part) {
    case 'sign':
    case 'accent':
    case 'awningA':
      return night && part === 'sign' ? lift(sign, 0.3) : sign;
    case 'signText':
      return night ? lift(signText, 0.6) : signText;
    case 'awningB':
      return night ? '#B8A890' : '#FBEFE6';
    case 'neon':
      return lift(sign, night ? 0.55 : 0.3);
    default:
      return SHARED[light][part];
  }
}

// ---------------------------------------------------------------------------------------------------------
// Model

/** 0 always, 1 up close only, 2 far only (the pylon). */
type Tier = 0 | 1 | 2;
interface Piece {
  ring: [number, number][];
  base: number;
  top: number;
  part: Part;
  soft?: boolean;
  tier?: Tier;
}

function box(x0: number, x1: number, y0: number, y1: number, base: number, top: number, part: Part): Piece {
  return { ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], base, top, part };
}
function cyl(cx: number, cy: number, r: number, base: number, top: number, part: Part, n = 10): Piece {
  const ring: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((i % n) / n) * 2 * Math.PI + Math.PI / n;
    ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return { ring, base, top, part };
}
const soft = (p: Piece): Piece => ({ ...p, soft: true });
const near = (ps: Piece[]): Piece[] => ps.map((p) => ({ ...p, tier: 1 }));
const moved = (ps: Piece[], dx: number, dy: number): Piece[] =>
  ps.map((p) => ({ ...p, ring: p.ring.map(([x, y]) => [x + dx, y + dy] as [number, number]) }));

function rng(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Each kind's building: front width, depth, roof height, and how far the building sits back (home's courtyard). */
interface Body {
  w: number;
  d: number;
  h: number;
  back: number;
}
const BODY: Record<RestaurantKind, Body> = {
  grill: { w: 10, d: 10, h: 5.0, back: 0 },
  bakery: { w: 9, d: 10, h: 4.6, back: 0 },
  shawarma: { w: 6, d: 12, h: 7.4, back: 0 },
  sweets: { w: 9, d: 10, h: 7.6, back: 0 },
  home: { w: 10, d: 11, h: 7.2, back: 3.2 },
  cafe: { w: 11, d: 9, h: 4.4, back: 0 },
  juice: { w: 6, d: 8, h: 4.2, back: 0 },
  restaurant: { w: 12, d: 12, h: 7.6, back: 0 },
};

interface Ctx {
  b: Body;
  lit: boolean;
  night: boolean;
  r: () => number;
}

/** Walls, dark base, coloured cornice, parapet, tanks on their stand, a dish and AC boxes on the side. */
function building({ b, night, r }: Ctx, open: { depth: number; top: number; windows?: boolean } = { depth: 0, top: 0.5 }): Piece[] {
  const p: Piece[] = [];
  const hw = b.w / 2, y0 = b.back, y1 = b.back + b.d, H = b.h;
  // the ground floor is open at the front (the shop seen inside), the floors above sit on the street line
  p.push(box(-hw, hw, y0, y1, 0, 0.5, 'base'));
  p.push(box(-hw, hw, y0 + open.depth, y1, 0.5, open.top, 'wall'), box(-hw, hw, y0 + 0.02, y1, open.top, H, 'wall'));
  // the coloured cornice runs round the top as a band (a solid slab would paint the whole roof)
  const cb = (x0: number, x1: number, ya: number, yb: number) => p.push(box(x0, x1, ya, yb, H - 0.3, H, 'accent'));
  cb(-hw - 0.12, hw + 0.12, y0 - 0.15, y0 + 0.3);
  cb(-hw - 0.12, hw + 0.12, y1 - 0.3, y1 + 0.12);
  cb(-hw - 0.12, -hw + 0.3, y0 - 0.15, y1 + 0.12);
  cb(hw - 0.3, hw + 0.12, y0 - 0.15, y1 + 0.12);
  p.push(box(-hw + 0.3, hw - 0.3, y0 + 0.3, y1 - 0.3, H - 0.3, H + 0.04, 'roof'));
  p.push(box(-hw, hw, y0, y0 + 0.2, H, H + 0.9, 'wall2'), box(-hw, hw, y1 - 0.2, y1, H, H + 0.9, 'wall2'));
  p.push(box(-hw, -hw + 0.2, y0, y1, H, H + 0.9, 'wall2'), box(hw - 0.2, hw, y0, y1, H, H + 0.9, 'wall2'));
  const tx = -hw + 1.6, ty = y1 - 1.6;
  p.push(box(tx - 1.2, tx + 1.2, ty - 0.55, ty + 0.55, H, H + 0.5, 'steel'));
  p.push(cyl(tx - 0.6, ty, 0.55, H + 0.5, H + 1.6, 'tank', 12), cyl(tx + 0.6, ty, 0.55, H + 0.5, H + 1.6, 'tank', 12));
  p.push(cyl(hw - 1.4, y0 + b.d / 2, 0.05, H, H + 0.8, 'steel', 6), cyl(hw - 1.4, y0 + b.d / 2, 0.45, H + 0.8, H + 0.88, 'dish', 12));
  // AC boxes on the side walls, one per storey
  for (let z = 1.6; z < H - 1; z += 3.4) {
    p.push(box(hw, hw + 0.5, y0 + 2 + r() * 2, y0 + 2.8 + r() * 2, z, z + 0.55, 'ac'));
    if (b.d > 9) p.push(box(-hw - 0.5, -hw, y1 - 3.6, y1 - 2.8, z + 0.3, z + 0.85, 'ac'));
  }
  // upstairs windows on the front for two-storey buildings, some dark at night
  if (H > 6 && open.windows !== false) {
    const n = Math.max(1, Math.floor(b.w / 3));
    for (let i = 0; i < n; i++) {
      const x = -hw + (b.w / n) * (i + 0.5);
      p.push(box(x - 0.7, x + 0.7, y0 - 0.06, y0, 4.9, 6.5, night && r() < 0.35 ? 'windowDark' : 'window'));
      p.push(box(x - 0.85, x + 0.85, y0 - 0.2, y0, 4.78, 4.9, 'wall2'));
      if (i === n - 1) p.push(box(x + 0.9, x + 1.6, y0 - 0.5, y0, 5.4, 5.95, 'ac'));
    }
  }
  return p;
}

/**
 * The shop front: piers, the interior seen through the open front (lit when chosen or at night), the rolled
 * shutter drum above it and the full-width لافتة with a bold emblem and name block.
 */
function shopFront({ b, lit, r }: Ctx, opts: { glassTo?: number } = {}): Piece[] {
  const p: Piece[] = [];
  const hw = b.w / 2;
  const top = opts.glassTo ?? 2.9;
  p.push(box(-hw, -hw + 0.45, -0.05, 2.2, 0.5, top + 0.3, 'wall'), box(hw - 0.45, hw, -0.05, 2.2, 0.5, top + 0.3, 'wall'));
  if (opts.glassTo) {
    p.push(box(-hw + 0.45, hw - 0.45, 0.05, 0.3, 0.5, top, 'glassLit'));
    // the glazing grid: mullions and transoms, and the glass shelves of sweets behind them
    for (let x = -hw + 0.45; x <= hw - 0.4; x += (b.w - 0.9) / 4) p.push(box(x - 0.05, x + 0.05, -0.02, 0.05, 0.5, top, 'frame'));
    for (const z of [2.6, 4.3]) p.push(box(-hw + 0.45, hw - 0.45, -0.02, 0.05, z - 0.06, z + 0.06, 'frame'));
    for (const z of [1.2, 1.9, 3.3, 3.9, 5.0]) p.push(box(-hw + 0.6, hw - 0.6, 0.06, 0.14, z - 0.03, z + 0.03, 'kunafa'));
  }
  else p.push(box(-hw + 0.45, hw - 0.45, 0.3, 2.2, 0.5, top, lit ? 'lit' : 'interior'));
  p.push(box(-hw + 0.45, hw - 0.45, -0.12, 0.25, top, top + 0.3, 'shutter'));
  p.push(box(-hw + 0.45, -hw + 0.55, -0.12, 0.0, 0.5, top, 'shutter'), box(hw - 0.55, hw - 0.45, -0.12, 0.0, 0.5, top, 'shutter'));
  const s0 = Math.max(3.2, top + 0.3);
  p.push(box(-hw - 0.05, hw + 0.05, -0.34, 0.0, s0 - 0.08, s0, 'frame'), box(-hw - 0.05, hw + 0.05, -0.34, 0.0, s0 + 1.3, s0 + 1.38, 'frame'));
  p.push(box(-hw - 0.05, hw + 0.05, -0.3, 0.0, s0, s0 + 1.3, 'sign'));
  // the emblem on the right (Arabic reads from the right), then the name as one bold block
  p.push(box(hw - 1.35, hw - 0.35, -0.4, -0.3, s0 + 0.2, s0 + 1.1, 'signText'));
  // the name: two or three bold words, each with one tall stroke rising out of it, read as Arabic lettering
  let x = hw - 1.8;
  const end = -hw + 0.6;
  for (let i = 0; i < 3 && x - 0.8 > end; i++) {
    const w = Math.min(x - end, 1.0 + r() * (b.w / 4));
    p.push(box(x - w, x, -0.4, -0.3, s0 + 0.38, s0 + 0.78, 'signText'));
    const sx = x - w * (0.2 + r() * 0.6);
    p.push(box(sx - 0.09, sx + 0.09, -0.4, -0.3, s0 + 0.78, s0 + 1.08, 'signText'));
    x -= w + 0.35;
  }
  return p;
}

/** Plastic tables and chairs on the pavement, on terrazzo squares, under parasols in the shop's colours (up close only). */
function seating(xs: number[], y = -3.4, parasols = true): Piece[] {
  const p: Piece[] = [];
  for (const tx of xs) {
    for (const [dx, dy] of [[-1.1, -1.1], [0, 0], [-1.1, 0], [0, -1.1]] as const) {
      if ((dx === 0) !== (dy === 0)) continue;
      p.push(box(tx + dx, tx + dx + 1.1, y + dy, y + dy + 1.1, 0.12, 0.13, 'wall2'));
    }
    if (parasols) {
      p.push(cyl(tx, y, 0.04, 0.7, 2.35, 'steel', 6));
      p.push(cyl(tx, y, 1.15, 2.2, 2.3, 'awningA', 12), cyl(tx, y, 0.75, 2.3, 2.42, 'awningB', 12), cyl(tx, y, 0.3, 2.42, 2.52, 'awningA', 10));
    }
    p.push(box(tx - 0.42, tx + 0.42, y - 0.42, y + 0.42, 0.62, 0.7, 'table'), box(tx - 0.36, tx + 0.36, y - 0.36, y + 0.36, 0.12, 0.62, 'table'));
    for (const [dx, dy] of [[0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75]] as const) {
      const cx = tx + dx, cy = y + dy;
      p.push(box(cx - 0.21, cx + 0.21, cy - 0.21, cy + 0.21, 0.12, 0.46, 'chair'));
      const ox = Math.sign(dx) * 0.19, oy = Math.sign(dy) * 0.19;
      if (dx) p.push(box(cx + ox - 0.04, cx + ox + 0.04, cy - 0.21, cy + 0.21, 0.46, 0.9, 'chair'));
      else p.push(box(cx - 0.21, cx + 0.21, cy + oy - 0.04, cy + oy + 0.04, 0.46, 0.9, 'chair'));
    }
  }
  return near(p);
}

/** A string of bulbs on two poles at the kerb, sagging between them and up to the sign (up close only). */
function bulbs(hw: number, signZ: number): Piece[] {
  const p: Piece[] = [];
  const pl: [number, number] = [-hw + 0.3, -5.0], pr: [number, number] = [hw - 0.3, -5.0];
  for (const q of [pl, pr]) p.push(box(q[0] - 0.06, q[0] + 0.06, q[1] - 0.06, q[1] + 0.06, 0.12, 3.3, 'pole'));
  const string = (a: [number, number, number], c: [number, number, number], sag: number, count: number) => {
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const x = a[0] + (c[0] - a[0]) * t, y = a[1] + (c[1] - a[1]) * t;
      const z = a[2] + (c[2] - a[2]) * t - sag * 4 * t * (1 - t);
      p.push(box(x - 0.09, x + 0.09, y - 0.09, y + 0.09, z - 0.18, z, 'bulb'));
    }
  };
  string([pl[0], pl[1], 3.25], [pr[0], pr[1], 3.25], 0.5, Math.round(hw * 3));
  string([pl[0], pl[1], 3.25], [-hw + 0.5, -0.4, signZ], 0.25, 7);
  string([pr[0], pr[1], 3.25], [hw - 0.5, -0.4, signZ], 0.25, 7);
  return near(p);
}

/** A delivery bike with its saffron box along the kerb (up close only). */
function bike(x: number): Piece[] {
  return near(moved([
    box(-0.95, -0.6, -0.05, 0.05, 0.12, 0.55, 'tire'), box(0.6, 0.95, -0.05, 0.05, 0.12, 0.55, 'tire'),
    box(-0.85, 0.85, -0.16, 0.16, 0.4, 0.78, 'bike'), box(-0.55, 0.2, -0.17, 0.17, 0.78, 0.88, 'seat'),
    box(0.68, 0.78, -0.05, 0.05, 0.78, 1.1, 'steel'), box(0.66, 0.8, -0.38, 0.38, 1.05, 1.11, 'steel'),
    box(-1.15, -0.45, -0.3, 0.3, 0.88, 1.5, 'deliveryBox'),
  ], x, -5.9));
}

/** The far sign: a pole and a saffron head with the kind's colour in it, so the shop shows among the houses. */
function pylon(hw: number): Piece[] {
  const x = hw + 0.4, y = -0.8;
  return [
    box(x - 0.18, x + 0.18, y - 0.18, y + 0.18, 0, 9.0, 'frame'),
    box(x - 1.0, x + 1.0, y - 0.25, y + 0.25, 9.0, 10.6, 'pylon'),
    box(x - 0.7, x + 0.7, y - 0.3, y + 0.3, 9.25, 10.35, 'sign'),
  ].map((q) => ({ ...q, tier: 2 as Tier }));
}

/** The fanous that hangs from the chosen shop's sign corner. */
function lantern(hw: number, signZ: number): Piece[] {
  const x = hw + 0.45, y = -0.7, z = signZ;
  return [
    box(hw - 0.1, x + 0.05, y - 0.05, 0.05, z, z + 0.1, 'frame'),
    box(x - 0.02, x + 0.02, y - 0.02, y + 0.02, z - 0.45, z, 'frame'),
    cyl(x, y, 0.36, z - 1.4, z - 1.3, 'lanternFrame', 8),
    cyl(x, y, 0.3, z - 1.3, z - 0.65, 'lanternGlow', 8),
    cyl(x, y, 0.38, z - 0.65, z - 0.55, 'lanternFrame', 8),
    cyl(x, y, 0.22, z - 0.55, z - 0.45, 'lanternFrame', 8),
  ];
}

const OPEN = { depth: 2.2, top: 3.2 };

function apron(hw: number): Piece {
  return box(-hw - 0.4, hw + 0.4, -5.4, 0.1, 0, 0.12, 'pave');
}

function grill(c: Ctx): Piece[] {
  const hw = c.b.w / 2;
  const p = [apron(hw), ...building(c, OPEN), ...shopFront(c)];
  // the charcoal grill on the street under a steel hood, skewers on the coals
  p.push(box(-hw + 0.7, -0.6, -1.1, -0.25, 0.12, 0.95, 'steel'), box(-hw + 0.8, -0.7, -1.0, -0.35, 0.95, 1.02, 'ember'));
  p.push(...near(Array.from({ length: 9 }, (_, i) => box(-hw + 1.0 + i * 0.36 - 0.05, -hw + 1.0 + i * 0.36 + 0.05, -0.95, -0.4, 1.02, 1.1, 'meat'))));
  p.push(box(-hw + 0.6, -0.5, -1.25, -0.1, 2.5, 2.7, 'steel'));
  // a tall square chimney and a column of smoke
  const cx = -hw + 1.1, cy = 1.0;
  p.push(box(cx - 0.3, cx + 0.3, cy - 0.3, cy + 0.3, 2.7, c.b.h + 4.2, 'steel'), box(cx - 0.4, cx + 0.4, cy - 0.4, cy + 0.4, c.b.h + 4.2, c.b.h + 4.45, 'frame'));
  p.push(soft(cyl(cx + 0.1, cy + 0.2, 0.45, c.b.h + 4.8, c.b.h + 5.6, 'smoke', 12)));
  p.push(soft(cyl(cx + 0.5, cy + 0.8, 0.75, c.b.h + 6.0, c.b.h + 7.0, 'smoke', 12)));
  p.push(soft(cyl(cx + 1.1, cy + 1.6, 1.05, c.b.h + 7.4, c.b.h + 8.4, 'smoke', 14)));
  return [...p, ...seating([1.2, 3.4], -3.4, false), ...bulbs(hw, 4.4), ...bike(-hw + 1.6)];
}

function bakery(c: Ctx): Piece[] {
  const hw = c.b.w / 2;
  const p = [apron(hw), ...building(c, OPEN), ...shopFront(c)];
  // the clay tannour dome with its fire mouth and a short flue
  const [tx, ty] = [-hw + 1.6, -1.8];
  const rings: [number, number, number][] = [[1.1, 0.12, 0.7], [1.04, 0.7, 1.05], [0.94, 1.05, 1.35], [0.78, 1.35, 1.6], [0.56, 1.6, 1.78], [0.3, 1.78, 1.88]];
  for (const [r, b, t] of rings) p.push(cyl(tx, ty, r, b, t, 'clay', 18));
  p.push(box(tx - 0.32, tx + 0.32, ty - 1.12, ty - 0.9, 0.5, 1.0, 'ember'));
  p.push(cyl(tx + 0.35, ty + 0.35, 0.12, 1.6, 2.5, 'clay', 8), soft(cyl(tx + 0.5, ty + 0.6, 0.5, 2.9, 3.4, 'smoke', 12)));
  // samoon cooling on the rack and flour sacks by the door
  p.push(box(-0.2, 2.6, -1.4, -0.5, 0.12, 0.85, 'bench'));
  p.push(...near(Array.from({ length: 12 }, (_, i) => cyl(0.1 + (i % 6) * 0.44, -1.18 + Math.floor(i / 6) * 0.42, 0.16, 0.85, 0.93, 'bread', 10))));
  p.push(...near([box(hw - 1.4, hw - 0.6, -1.1, -0.4, 0.12, 0.7, 'sack'), box(hw - 1.3, hw - 0.7, -1.0, -0.5, 0.7, 1.15, 'sack')]));
  return [...p, ...seating([1.6], -3.6), ...bike(hw - 2.2)];
}

function shawarma(c: Ctx): Piece[] {
  const hw = c.b.w / 2;
  const p = [apron(hw), ...building(c, OPEN), ...shopFront(c)];
  // the counter and two spits right at the front, glowing like the window behind them
  p.push(box(-hw + 0.5, hw - 0.5, -0.9, -0.1, 0.12, 0.95, 'steel'));
  for (const x of [-1.0, 0.6]) {
    p.push(cyl(x, -0.5, 0.3, 0.95, 1.02, 'steel', 10));
    p.push(cyl(x, -0.5, 0.36, 1.02, 1.5, 'meat', 14), cyl(x, -0.5, 0.31, 1.5, 1.95, 'meat', 14), cyl(x, -0.5, 0.25, 1.95, 2.35, 'meat', 14));
    p.push(cyl(x, -0.5, 0.06, 2.35, 2.75, 'steel', 6));
  }
  return [...p, ...seating([0], -3.4), ...bike(-hw + 0.4)];
}

function sweets(c: Ctx): Piece[] {
  const hw = c.b.w / 2;
  const p = [apron(hw), ...building(c, { depth: 0.3, top: 6.2, windows: false }), ...shopFront(c, { glassTo: 5.9 })];
  // the only striped awning: three steps and a scalloped valance under the sign
  const sw = 0.6, n = Math.floor((c.b.w - 0.4) / sw), x0 = -(n * sw) / 2;
  const tiers: [number, number, number, number][] = [[0, -0.75, 3.05, 3.17], [-0.75, -1.5, 2.9, 3.02], [-1.5, -2.2, 2.75, 2.87]];
  for (let i = 0; i < n; i++) {
    const part: Part = i % 2 ? 'awningB' : 'awningA';
    const xa = x0 + i * sw, xb = xa + sw;
    for (const [ya, yb, b, t] of tiers) p.push(box(xa, xb, yb, ya, b, t, part));
    p.push(box(xa, xb, -2.26, -2.2, 2.55, 2.87, part), box(xa + 0.15, xb - 0.15, -2.26, -2.2, 2.42, 2.55, part));
  }
  // cake stands in three tiers on a display table
  p.push(box(-hw + 0.6, -0.4, -1.4, -0.5, 0.12, 0.9, 'frame'));
  for (const x of [-hw + 1.3, -hw + 2.7]) {
    p.push(cyl(x, -0.95, 0.05, 0.9, 1.75, 'brass', 6));
    p.push(cyl(x, -0.95, 0.42, 1.0, 1.08, 'kunafa', 14), cyl(x, -0.95, 0.32, 1.3, 1.38, 'kunafa', 14), cyl(x, -0.95, 0.22, 1.6, 1.68, 'kunafa', 12));
  }
  return [...p, ...seating([2.4], -3.6), ...bike(-hw + 1.4)];
}

function home(c: Ctx): Piece[] {
  const hw = c.b.w / 2;
  const p = [apron(hw), ...building(c)];
  // the courtyard wall with a gate, a small sign over it, and a palm inside
  p.push(box(-hw, -0.4, 0, 0.3, 0, 1.9, 'wall2'), box(1.6, hw, 0, 0.3, 0, 1.9, 'wall2'));
  p.push(box(-hw, -hw + 0.3, 0, c.b.back, 0, 1.9, 'wall2'), box(hw - 0.3, hw, 0, c.b.back, 0, 1.9, 'wall2'));
  p.push(box(-0.4, 1.6, 0.1, 0.2, 0.12, 2.2, 'door'), box(-0.55, 1.75, -0.05, 0.3, 2.2, 2.35, 'accent'));
  p.push(box(-hw + 0.4, -0.8, -0.24, 0.0, 2.0, 2.9, 'sign'), box(-hw + 0.7, -1.3, -0.3, -0.24, 2.25, 2.65, 'signText'));
  p.push(box(-1.0, 1.0, c.b.back - 0.06, c.b.back, 0.5, 2.6, c.lit ? 'lit' : 'interior'));
  p.push(box(-2.6, 0.6, c.b.back - 1.0, c.b.back, 3.5, 3.68, 'wall2'), box(-2.6, 0.6, c.b.back - 1.0, c.b.back - 0.92, 4.4, 4.48, 'frame'));
  for (let x = -2.55; x <= 0.56; x += 0.32) p.push(box(x - 0.025, x + 0.025, c.b.back - 0.98, c.b.back - 0.93, 3.68, 4.4, 'frame'));
  p.push(box(-1.6, -0.4, c.b.back - 0.08, c.b.back, 3.7, 5.6, c.lit ? 'lit' : 'door'));
  const [px, py] = [hw - 1.6, 1.6];
  p.push(cyl(px, py, 0.2, 0, 6.2, 'trunk', 8));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    p.push(cyl(px + Math.cos(a) * 1.0, py + Math.sin(a) * 1.0, 0.8, 5.9 - (i % 2) * 0.3, 6.2 - (i % 2) * 0.3, 'plant', 8));
  }
  p.push(cyl(px, py, 0.6, 6.1, 6.6, 'plant', 10));
  // the day's pots on a table by the gate, steaming
  p.push(box(-hw + 0.6, -1.0, -1.3, -0.5, 0.12, 0.65, 'bench'));
  for (const x of [-hw + 1.3, -hw + 2.5]) {
    p.push(cyl(x, -0.9, 0.42, 0.65, 1.25, 'pot', 14), cyl(x, -0.9, 0.46, 1.25, 1.32, 'steel', 14));
    p.push(soft(cyl(x, -0.9, 0.3, 1.6, 2.0, 'smoke', 10)));
  }
  return [...p, ...bike(hw - 2.0)];
}

function cafe(c: Ctx): Piece[] {
  const hw = c.b.w / 2;
  const p = [apron(hw), ...building(c, OPEN), ...shopFront(c)];
  // a tin canopy over the pavement on thin posts, wooden benches with red rugs, the brass samovar
  p.push(box(-hw - 0.2, hw + 0.2, -4.4, 0, 2.95, 3.05, 'canopy'));
  for (const x of [-hw + 0.1, 0, hw - 0.1]) p.push(box(x - 0.06, x + 0.06, -4.36, -4.24, 0.12, 2.95, 'pole'));
  for (const [x0, x1] of [[-hw + 0.6, -0.6], [0.6, hw - 0.6]] as const) {
    p.push(box(x0, x1, -3.9, -3.3, 0.12, 0.5, 'bench'), box(x0, x1, -3.85, -3.35, 0.5, 0.56, 'rug'));
    p.push(box(x0, x1, -2.3, -1.7, 0.12, 0.5, 'bench'), box(x0, x1, -2.25, -1.75, 0.5, 0.56, 'rug'));
    p.push(...near([box(x0 + 0.4, x1 - 0.4, -3.0, -2.6, 0.12, 0.55, 'bench')]));
  }
  p.push(box(-hw + 0.6, -hw + 2.2, -1.1, -0.4, 0.12, 0.95, 'bench'));
  p.push(cyl(-hw + 1.4, -0.75, 0.26, 0.95, 1.55, 'brass', 12), cyl(-hw + 1.4, -0.75, 0.16, 1.55, 1.78, 'brass', 10));
  p.push(soft(cyl(-hw + 1.5, -0.7, 0.24, 2.0, 2.3, 'smoke', 8)));
  // bulbs hanging along the canopy's edge
  p.push(...near(Array.from({ length: Math.round(c.b.w / 0.7) }, (_, i) => {
    const x = -hw + 0.3 + i * 0.7;
    return box(x - 0.09, x + 0.09, -4.35, -4.17, 2.7 - (i % 2) * 0.1, 2.88 - (i % 2) * 0.1, 'bulb');
  })));
  return [...p, ...bike(hw - 1.6)];
}

function juice(c: Ctx): Piece[] {
  const hw = c.b.w / 2;
  const p = [apron(hw), ...building(c, OPEN), ...shopFront(c)];
  // the counter walled in fruit crates, the press on top
  const cols: Part[] = ['crate1', 'crate2', 'crate3', 'crate4'];
  for (let i = 0; i < 9; i++) for (let j = 0; j < 3; j++) {
    const x = -hw + 0.4 + i * 0.58;
    if (x + 0.52 > hw - 0.3) continue;
    p.push(box(x, x + 0.52, -1.2, -0.4, 0.12 + j * 0.34, 0.44 + j * 0.34, cols[(i + j * 3) % 4]!));
  }
  p.push(cyl(0, -0.8, 0.3, 1.14, 1.7, 'steel', 12), cyl(0, -0.8, 0.22, 1.7, 1.9, 'crate1', 10));
  return [...p, ...seating([1.2], -3.4), ...bike(-hw + 1.0)];
}

function restaurant(c: Ctx): Piece[] {
  const hw = c.b.w / 2;
  const p = [apron(hw), ...building(c, OPEN), ...shopFront(c)];
  // a balcony over the door and planters either side
  p.push(box(-2.0, 2.0, -1.2, 0, 4.55, 4.72, 'wall2'), box(-2.0, 2.0, -1.2, -1.12, 5.5, 5.58, 'frame'));
  for (let x = -1.95; x <= 1.96; x += 0.33) p.push(box(x - 0.025, x + 0.025, -1.18, -1.13, 4.72, 5.5, 'frame'));
  for (const x of [-hw + 0.5, hw - 0.5]) p.push(cyl(x, -0.8, 0.32, 0.12, 0.65, 'pot', 10), cyl(x, -0.8, 0.45, 0.65, 1.3, 'plant', 10));
  return [...p, ...seating([-2.6, 0.4, 3.4]), ...bulbs(hw, 4.4), ...bike(-hw + 1.8)];
}

const KIND_MODEL: Record<RestaurantKind, (c: Ctx) => Piece[]> = { grill, bakery, shawarma, sweets, home, cafe, juice, restaurant };

/** Light tubes in the shop's colour along the roof edges, the corners and round the sign: at night, and on the chosen shop. */
function neon(b: Body, s0: number): Piece[] {
  const hw = b.w / 2, y0 = b.back, y1 = b.back + b.d, z = b.h + 0.9, t = 0.09;
  const p = [
    box(-hw - t, hw + t, y0 - t, y0 + t, z, z + 0.12, 'neon'),
    box(-hw - t, -hw + t, y0, y1, z, z + 0.12, 'neon'),
    box(hw - t, hw + t, y0, y1, z, z + 0.12, 'neon'),
    box(-hw - t, -hw + t, y0 - t, y0 + t, 0.5, z, 'neon'),
    box(hw - t, hw + t, y0 - t, y0 + t, 0.5, z, 'neon'),
  ];
  if (s0 > 0) p.push(box(-hw - 0.1, hw + 0.1, -0.42, -0.34, s0 - 0.12, s0 - 0.02, 'neon'), box(-hw - 0.1, hw + 0.1, -0.42, -0.34, s0 + 1.4, s0 + 1.5, 'neon'));
  return p;
}

/** Every piece of one restaurant's model, in local metres. */
export function restaurantModel(kind: RestaurantKind, opts: { selected?: boolean; night?: boolean; seed?: number } = {}): Piece[] {
  const b = BODY[kind];
  const c: Ctx = { b, lit: Boolean(opts.selected || opts.night), night: Boolean(opts.night), r: rng(opts.seed ?? 1) };
  const signZ = kind === 'home' ? 2.9 : kind === 'sweets' ? 7.9 : 4.58;
  const s0 = kind === 'home' ? 0 : kind === 'sweets' ? 6.2 : 3.2;
  return [...KIND_MODEL[kind](c), ...pylon(b.w / 2), ...(opts.selected ? lantern(b.w / 2, signZ) : []), ...(opts.night || opts.selected ? neon(b, s0) : [])];
}

// ---------------------------------------------------------------------------------------------------------
// Placing on the map

const M_PER_DEG_LAT = 110540;
const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

// Drawn a little larger than life (×1.45), like the landmarks, so a shop front reads among the houses.
const SCALE = 1.45;

function place(piece: Piece, at: LngLat, facing: number): Polygon {
  const b = (facing * Math.PI) / 180;
  // local −y points to the street (the facing bearing); local +x is 90° clockwise from it
  const yx = -Math.sin(b), yy = -Math.cos(b);
  const xx = Math.sin(b + Math.PI / 2), xy = Math.cos(b + Math.PI / 2);
  const kx = mPerDegLng(at[1]);
  return {
    type: 'Polygon',
    coordinates: [piece.ring.map(([x, y]) => [at[0] + ((x * xx + y * yx) * SCALE) / kx, at[1] + ((x * xy + y * yy) * SCALE) / M_PER_DEG_LAT])],
  };
}

function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
    up.push(q);
  }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  return [...h, h[0]!];
}

/** The building's shadow on the ground: its footprint swept away from the sun (flat roofs make it exact). */
function shadow(at: LngLat, facing: number, sun: SunPosition, b: Body): Polygon {
  const alt = Math.max(sun.alt, 8) * (Math.PI / 180);
  const len = Math.min(((b.h + 0.9) * SCALE) / Math.tan(alt), 14); // kept short: a grounding shade, not a wedge across the street
  const away = (sun.az + 180) * (Math.PI / 180);
  const kx = mPerDegLng(at[1]);
  const foot = place({ ring: [[-b.w / 2, b.back], [b.w / 2, b.back], [b.w / 2, b.back + b.d], [-b.w / 2, b.back + b.d]], base: 0, top: 0, part: 'pave' }, at, facing).coordinates[0]!;
  const pts: [number, number][] = [];
  for (const c of foot) {
    pts.push([c[0]!, c[1]!]);
    pts.push([c[0]! + (Math.sin(away) * len) / kx, c[1]! + (Math.cos(away) * len) / M_PER_DEG_LAT]);
  }
  return { type: 'Polygon', coordinates: [hull(pts)] };
}

export interface RestaurantScene {
  solid: FeatureCollection<Polygon>;
  soft: FeatureCollection<Polygon>;
  glow: FeatureCollection<Point>;
}

/**
 * GeoJSON for the restaurants' sources (`RESTAURANT_SOURCES`): the models, their smoke and steam, and the
 * pools of light. The pin `at` is the middle of the shop front, so the building stands behind it.
 */
export function restaurantScene(list: readonly MapRestaurant[], opts: RestaurantSceneOptions = {}): RestaurantScene {
  const light = opts.light ?? 'golden';
  const night = light === 'night';
  const sun = opts.sun ?? TYPICAL_SUN[light];
  const solid: Feature<Polygon>[] = [];
  const softs: Feature<Polygon>[] = [];
  const glow: Feature<Point>[] = [];
  for (const shop of list) {
    const kind = shop.kind ?? 'restaurant';
    const selected = shop.id === opts.selectedId;
    const facing = shop.facing ?? 180;
    for (const piece of restaurantModel(kind, { selected, night, seed: hash(shop.id) })) {
      const f: Feature<Polygon> = {
        type: 'Feature',
        properties: { id: shop.id, c: restaurantColour(piece.part, kind, light), h: piece.top * SCALE, b: piece.base * SCALE, t: piece.tier ?? 0 },
        geometry: place(piece, shop.at, facing),
      };
      (piece.soft ? softs : solid).push(f);
    }
    if (!night) softs.push({ type: 'Feature', properties: { id: shop.id, sh: 1 }, geometry: shadow(shop.at, facing, sun, BODY[kind]) });
    // the light pool sits on the pavement in front of the shop
    const g = place({ ring: [[0, -2.6]], base: 0, top: 0, part: 'pave' }, shop.at, facing).coordinates[0]![0]!;
    glow.push({ type: 'Feature', properties: { id: shop.id, s: selected ? 1 : 0 }, geometry: { type: 'Point', coordinates: g } });
  }
  return {
    solid: { type: 'FeatureCollection', features: solid },
    soft: { type: 'FeatureCollection', features: softs },
    glow: { type: 'FeatureCollection', features: glow },
  };
}

/** The layers that draw `restaurantScene` (add the three GeoJSON sources first, then these, under the labels). */
export function restaurantLayers(light: GoldenLight = 'golden'): LayerSpecification[] {
  const night = light === 'night';
  const pal = GOLDEN_PALETTES[light];
  const ext = {
    'fill-extrusion-color': ['get', 'c'],
    'fill-extrusion-height': ['get', 'h'],
    'fill-extrusion-base': ['get', 'b'],
  } as { 'fill-extrusion-color': ExpressionSpecification; 'fill-extrusion-height': ExpressionSpecification; 'fill-extrusion-base': ExpressionSpecification };
  return [
    {
      id: 'golden-restaurant-shadow', type: 'fill', source: RESTAURANT_SOURCES.soft, minzoom: RESTAURANT_MINZOOM, filter: ['==', ['get', 'sh'], 1],
      paint: { 'fill-color': pal.shadow, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], RESTAURANT_MINZOOM, 0, RESTAURANT_MINZOOM + 0.4, pal.shadowOpacity] },
    } as LayerSpecification,
    {
      id: 'golden-restaurant-glow', type: 'circle', source: RESTAURANT_SOURCES.glow, minzoom: RESTAURANT_MINZOOM - 0.6,
      paint: {
        'circle-color': night ? '#FFB04A' : '#F6A23A', 'circle-blur': 1, 'circle-pitch-alignment': 'map',
        'circle-opacity': ['case', ['==', ['get', 's'], 1], night ? 0.75 : 0.5, night ? 0.45 : 0.18],
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 15, ['case', ['==', ['get', 's'], 1], 10, 5], 19, ['case', ['==', ['get', 's'], 1], 170, 80]],
      },
    } as LayerSpecification,
    {
      id: 'golden-restaurants-3d', type: 'fill-extrusion', source: RESTAURANT_SOURCES.solid, minzoom: RESTAURANT_MINZOOM, filter: ['==', ['get', 't'], 0],
      paint: { ...ext, 'fill-extrusion-vertical-gradient': true, 'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], RESTAURANT_MINZOOM, 0, RESTAURANT_MINZOOM + 0.4, 1] },
    } as LayerSpecification,
    {
      id: 'golden-restaurants-pylon', type: 'fill-extrusion', source: RESTAURANT_SOURCES.solid, minzoom: RESTAURANT_MINZOOM, maxzoom: RESTAURANT_DETAIL_ZOOM, filter: ['==', ['get', 't'], 2],
      paint: { ...ext, 'fill-extrusion-vertical-gradient': false, 'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], RESTAURANT_MINZOOM, 0, RESTAURANT_MINZOOM + 0.4, 1] },
    } as LayerSpecification,
    {
      id: 'golden-restaurants-detail', type: 'fill-extrusion', source: RESTAURANT_SOURCES.solid, minzoom: RESTAURANT_DETAIL_ZOOM, filter: ['==', ['get', 't'], 1],
      paint: { ...ext, 'fill-extrusion-vertical-gradient': true },
    } as LayerSpecification,
    {
      id: 'golden-restaurants-soft', type: 'fill-extrusion', source: RESTAURANT_SOURCES.soft, minzoom: RESTAURANT_MINZOOM + 0.8, filter: ['!=', ['get', 'sh'], 1],
      paint: { ...ext, 'fill-extrusion-vertical-gradient': false, 'fill-extrusion-opacity': night ? 0.35 : 0.5 },
    } as LayerSpecification,
  ];
}

/**
 * The bearing from a shop to its nearest street, from the streets on screen
 * (`map.querySourceFeatures(GOLDEN_SOURCE, { sourceLayer: 'roads' })`). Alleys count last.
 */
export function faceRoad(at: LngLat, roads: readonly { cls: string; coords: LngLat[] }[]): number {
  const kx = mPerDegLng(at[1]);
  let best = Infinity, bearing = 180;
  for (const road of roads) {
    const penalty = road.cls === 'alley' ? 25 : 0;
    for (let i = 1; i < road.coords.length; i++) {
      const a = road.coords[i - 1]!, b = road.coords[i]!;
      const ax = (a[0] - at[0]) * kx, ay = (a[1] - at[1]) * M_PER_DEG_LAT;
      const bx = (b[0] - at[0]) * kx, by = (b[1] - at[1]) * M_PER_DEG_LAT;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const px = ax + dx * t, py = ay + dy * t;
      const d = Math.hypot(px, py) + penalty;
      if (d < best) {
        best = d;
        bearing = ((Math.atan2(px, py) * 180) / Math.PI + 360) % 360;
      }
    }
  }
  return Math.round(bearing);
}

/** Picks the model from the shop's food tags (Arabic or English), e.g. «مشويات» → grill. */
export function restaurantKindOf(tags: readonly string[]): RestaurantKind {
  const t = tags.join(' ').toLowerCase();
  const words = new Set(t.split(/[^\p{L}\p{N}]+/u));
  // Arabic by stem (it takes «ال» and joined letters), English only as whole words («rice» is not «ice»).
  const has = (...w: string[]) => w.some((x) => (/^[a-z ]+$/.test(x) ? words.has(x) : t.includes(x)));
  if (has('مشويات', 'كباب', 'تكة', 'كص', 'grill', 'kebab')) return 'grill';
  if (has('شاورما', 'فلافل', 'shawarma', 'falafel')) return 'shawarma';
  if (has('فرن', 'صمون', 'خبز', 'معجنات', 'bakery', 'bread')) return 'bakery';
  if (has('حلويات', 'كنافة', 'بقلاوة', 'آيس', 'sweets', 'dessert', 'ice')) return 'sweets';
  if (has('عصير', 'juice')) return 'juice';
  if (has('قهوة', 'شاي', 'كافيه', 'coffee', 'tea', 'cafe')) return 'cafe';
  if (has('أكل بيت', 'تمن', 'مرق', 'باچة', 'باجة', 'home')) return 'home';
  return 'restaurant';
}

/** The house layers a restaurant replaces (the 3D blocks and what sits on them). */
export const RESTAURANT_HIDES_HOUSE_LAYERS = [
  'golden-houses-3d', 'golden-roof-huts', 'golden-roof-tanks', 'golden-wall-foot', 'golden-window-glow',
] as const;

/**
 * Filter to add (with `all`) to the house layers in `RESTAURANT_HIDES_HOUSE_LAYERS`: no house under a shop,
 * and, while a shop is chosen, the houses across the street from it lie flat so the camera sees its front.
 */
export function restaurantHouseFilter(list: readonly MapRestaurant[], selectedId?: string | null): ExpressionSpecification {
  const under: ExpressionSpecification = ['>', ['distance', { type: 'MultiPoint', coordinates: list.map((s) => s.at) }], 3];
  const sel = list.find((s) => s.id === selectedId);
  if (!sel) return under;
  const view = place({ ring: [[0, -16]], base: 0, top: 0, part: 'pave' }, sel.at, sel.facing ?? 180).coordinates[0]![0]!;
  return ['all', under, ['>', ['distance', { type: 'Point', coordinates: view }], 26]];
}
