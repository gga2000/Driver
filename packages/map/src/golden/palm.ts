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
