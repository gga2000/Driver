import type { GoldenPalette } from './palettes.js';

/** Raw RGBA pixels, the shape `map.addImage(id, { width, height, data })` takes on web and native. */
export interface PatternImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Id of the palm-crown fill pattern; register it with `goldenImages()` before the style loads. */
export const PALM_PATTERN = 'golden-palm';

const SIZE = 36;
// Five date palms seen from above: centre x, y and crown radius in pattern pixels.
const PALMS: ReadonlyArray<readonly [number, number, number]> = [
  [9, 10, 5],
  [27, 7, 4.2],
  [19, 25, 5.4],
  [33, 30, 3.6],
  [4, 31, 3.4],
];

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/**
 * The palm-grove texture: seven fronds per crown on the grove colour, drawn without a canvas so the
 * same pixels work in the browser, React Native and tests. Tiles seamlessly (crowns wrap at the edges).
 */
export function palmPattern(p: GoldenPalette): PatternImage {
  const bg = hex(p.palm);
  const ink = hex(p.palmCrown);
  const data = new Uint8Array(SIZE * SIZE * 4);
  const fronds: Array<[number, number, number, number]> = [];
  for (const [cx, cy, r] of PALMS) {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + cx;
      for (const ox of [-SIZE, 0, SIZE]) {
        for (const oy of [-SIZE, 0, SIZE]) {
          fronds.push([cx + ox, cy + oy, cx + ox + Math.cos(a) * r, cy + oy + Math.sin(a) * r + 0.8]);
        }
      }
    }
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let d = Infinity;
      for (const [ax, ay, bx, by] of fronds) d = Math.min(d, distToSegment(x + 0.5, y + 0.5, ax, ay, bx, by));
      const a = Math.max(0, Math.min(1, 1.25 - d)); // 1.5 px stroke, antialiased
      const i = (y * SIZE + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(bg[c]! + (ink[c]! - bg[c]!) * a);
      data[i + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

/** Id of the field-furrow pattern (farmland drawn in rows near town); registered by `goldenImages()`. */
export const FURROW_PATTERN = 'golden-furrows';

/** Ploughed rows: a soft diagonal stripe in the crown colour on transparent pixels, tiling seamlessly. */
export function furrowPattern(p: GoldenPalette): PatternImage {
  const n = 16;
  const [r, g, b] = hex(p.palmCrown);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = (x + y) % 8 < 2 ? 70 : 0;
    }
  }
  return { width: n, height: n, data };
}

/** Id of the lit-house wall pattern (night only); registered by `goldenImages()`. */
export const LIT_WALL_PATTERN = 'golden-lit-walls';

/**
 * The wall of a home with its lights on (Ali picked look B, 2026-10-25): the same dark wall as its neighbours, the
 * upper floor's glass dark and a warm band of larger windows along the ground floor, each in its own shade of warm.
 * Tiles in both directions, so a long wall repeats the shopfront-and-courtyard rhythm.
 */
export function litWallPattern(p: GoldenPalette): PatternImage {
  const W = 64;
  const H = 96;
  const wall = hex(p.roofTones[0]);
  const warm = hex(p.windowGlow ?? '#FFB04A');
  const mix = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [0, 1, 2].map((i) => Math.round(a[i]! * (1 - k) + b[i]! * k)) as [number, number, number];
  const cream = mix(warm, [255, 240, 205], 0.6);
  const amber = mix(warm, [255, 150, 50], 0.5);
  const dark = mix(wall, [0, 0, 0], 0.35);
  // x, y, width, height, colour, halo strength
  const wins: ReadonlyArray<readonly [number, number, number, number, [number, number, number], number]> = [
    [6, 62, 10, 12, cream, 0.3],
    [27, 62, 10, 12, warm, 0.3],
    [48, 62, 10, 12, amber, 0.3],
    [10, 22, 6, 9, dark, 0],
    [44, 22, 6, 9, dark, 0],
  ];
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = wall[0];
    data[i * 4 + 1] = wall[1];
    data[i * 4 + 2] = wall[2];
    data[i * 4 + 3] = 255;
  }
  for (const [x0, y0, w, h, c, halo] of wins) {
    for (let y = y0 - 3; y < y0 + h + 3; y++) {
      for (let x = x0 - 3; x < x0 + w + 3; x++) {
        const inside = x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
        const dist = Math.max(x0 - x, x - (x0 + w - 1), y0 - y, y - (y0 + h - 1), 0);
        const k = inside ? 1 : Math.max(0, halo * (1 - dist / 4));
        const i = (((y + H) % H) * W + ((x + W) % W)) * 4;
        for (let j = 0; j < 3; j++) data[i + j] = Math.round(data[i + j]! * (1 - k) + c[j]! * k);
      }
    }
  }
  return { width: W, height: H, data };
}
