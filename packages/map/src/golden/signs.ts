import type { PatternImage } from './palm.js';

/**
 * Signposts for the places people give directions by (Ali picked "C Signposts", 2026-10-12): a standing pin in the
 * place's colour with the map's own line icon in cream, for mosques and حسينيات, schools, hospitals and clinics,
 * pharmacies, bakeries and fuel stations. The tiles mark such a place with `icon` in the `places` layer; the style
 * draws it from `SIGN_MINZOOM` with the image `signImageId(icon)` that `goldenImages()` registers.
 *
 * Drawn without a canvas (like the palm texture), at 2× so they stay sharp on phones; the style halves `icon-size`.
 */
export type SignKind = 'mosque' | 'school' | 'health' | 'pharmacy' | 'bakery' | 'fuel';
export const SIGN_KINDS: readonly SignKind[] = ['mosque', 'school', 'health', 'pharmacy', 'bakery', 'fuel'];
export const SIGN_MINZOOM = 14.6;
export const signImageId = (kind: SignKind) => `golden-sign-${kind}`;
/** Food signs stand as pins; every other kind is a quiet mark on the ground (Ali, 2026-10-13: food first, the rest calm). */
export const FOOD_SIGNS: readonly SignKind[] = ['bakery'];
export const markImageId = (kind: SignKind) => `golden-mark-${kind}`;

/** Each kind's colour: warm and earthy, readable under cream glyphs, never blue or teal. */
export const SIGN_COLOURS: Record<SignKind, string> = {
  mosque: '#4F5C24',
  school: '#8A5A12',
  health: '#8C3522',
  pharmacy: '#2F6A32',
  bakery: '#7A4A22',
  fuel: '#4E4238',
};

// 24×24 line glyphs in the app's icon style (1.9 px round strokes).
const GLYPHS: Record<SignKind, string[]> = {
  mosque: ['M3.5 20.5h17', 'M6 20.5v-5c0-3.3 2.7-6 6-6s6 2.7 6 6v5', 'M12 9V7', 'M12 4.2v.1', 'M10.6 20.5v-2.2c0-1.9 2.8-1.9 2.8 0v2.2'],
  school: ['M12 6.6C10 5.1 7 4.6 4 5.1v13.2c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5.1c-3-.5-6 0-8 1.5z', 'M12 6.6v13.2'],
  health: ['M4.5 4.5h15v15h-15z', 'M9 8v8', 'M15 8v8', 'M9 12h6'],
  pharmacy: ['M9.5 4.5h5v5h5v5h-5v5h-5v-5h-5v-5h5z'],
  bakery: ['M3 18.5c0-6.6 4-10.5 9-10.5s9 3.9 9 10.5z', 'M7.6 12.6l1.6 2.4', 'M11.2 10.9l1.6 2.6', 'M14.8 12.6l1.6 2.4'],
  fuel: ['M5.5 20V4.5h9V20', 'M4 20h12', 'M8 8h5', 'M14.5 11h3v5.5c0 1.7 2.6 1.7 2.6 0V9l-2.4-2.4'],
}

type Pt = [number, number];

/** An SVG path (M L H V C S Z, absolute or relative) as polylines. */
export function flattenPath(d: string): Pt[][] {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const out: Pt[][] = [];
  let line: Pt[] = [];
  let i = 0;
  let cmd = '';
  let x = 0, y = 0, sx = 0, sy = 0, cx2 = 0, cy2 = 0;
  const num = () => Number(toks[i++]);
  const push = (px: number, py: number) => { x = px; y = py; line.push([x, y]); };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i]!)) cmd = toks[i++]!;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        if (line.length > 1) out.push(line);
        line = [];
        push(ox + num(), oy + num());
        sx = x; sy = y;
        cmd = rel ? 'l' : 'L';
        break;
      case 'L': push(ox + num(), oy + num()); break;
      case 'H': push(ox + num(), y); break;
      case 'V': push(x, oy + num()); break;
      case 'C':
      case 'S': {
        // S mirrors the last control point (only after a curve, as the glyphs use it)
        const [x1, y1] = cmd.toUpperCase() === 'S' ? [2 * x - cx2, 2 * y - cy2] : [ox + num(), oy + num()];
        const [x2, y2, ex, ey] = [ox + num(), oy + num(), ox + num(), oy + num()];
        const [x0, y0] = [x, y];
        for (let k = 1; k <= 12; k++) {
          const t = k / 12, u = 1 - t;
          push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
        }
        cx2 = x2; cy2 = y2;
        break;
      }
      case 'Z':
        push(sx, sy);
        break;
      default:
        i++;
    }
  }
  if (line.length > 1) out.push(line);
  return out;
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

// how much of a glyph stroke (1.9 px on the 24-grid) covers the point (gx, gy), the grid scaled by gs × SCALE
function glyphAlpha(kind: SignKind, gx: number, gy: number, px: number): number {
  let gd = Infinity;
  for (const l of glyphLines(kind)) for (let k = 1; k < l.length; k++) gd = Math.min(gd, segDist(gx, gy, l[k - 1]!, l[k]!));
  return Math.max(0, Math.min(1, (0.95 - gd) * px + 0.5));
}
const lines = new Map<SignKind, Pt[][]>();
const glyphLines = (kind: SignKind) => lines.get(kind) ?? lines.set(kind, GLYPHS[kind].flatMap(flattenPath)).get(kind)!;

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];

// The pin, in 1× pixels: a round head on a short point, its tip at the bottom middle (the place's spot).
const W = 36, H = 46, R = 15, CX = W / 2, CY = R + 2, TIP = H - 2;
const SCALE = 2;

/** One signpost image: the pin in the kind's colour, a cream rim and glyph, a soft shadow at the tip. */
export function signImage(kind: SignKind, night = false): PatternImage {
  const w = W * SCALE, h = H * SCALE;
  const data = new Uint8Array(w * h * 4);
  const body = hex(SIGN_COLOURS[kind]);
  const cream = hex(night ? '#F2DDBE' : '#FFF6E6');
  const shade = hex('#3C220A');
  const gs = (R * 1.2) / 24; // glyph scale in 1× px
  // the point: tangent lines from the tip to the head circle
  const half = Math.asin(R / (TIP - CY));
  const tA: Pt = [CX - R * Math.cos(half), CY + R * Math.sin(half)], tB: Pt = [CX + R * Math.cos(half), CY + R * Math.sin(half)], tip: Pt = [CX, TIP];
  const side = (p: Pt, a: Pt, b: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = (px + 0.5) / SCALE, y = (py + 0.5) / SCALE, q: Pt = [x, y];
      // signed distance to the pin (negative inside): the head circle joined with the point's triangle
      const dc = Math.hypot(x - CX, y - CY) - R;
      const s1 = side(q, tA, tip), s2 = side(q, tip, tB), s3 = side(q, tB, tA);
      const inTri = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
      const dTri = Math.min(segDist(x, y, tA, tip), segDist(x, y, tip, tB), segDist(x, y, tB, tA));
      const sd = Math.min(dc, inTri ? -dTri : dTri);
      const aShape = Math.max(0, Math.min(1, 0.5 - sd * SCALE));
      const inner = Math.max(0, Math.min(1, 0.5 - (sd + 1.6) * SCALE)); // inside the 1.6 px cream rim
      const aGlyph = dc < -1 ? glyphAlpha(kind, (x - CX) / gs + 12, (y - CY) / gs + 12, gs * SCALE) : 0;
      // a little shadow under the tip so the sign stands on the street
      const sh = Math.max(0, 1 - Math.hypot((x - CX) / 6, (y - TIP) / 1.6)) * 0.35;
      const c = (k: 0 | 1 | 2) => {
        let v = cream[k] + (body[k] - cream[k]) * inner;
        v += (cream[k] - v) * aGlyph * inner;
        return v + (shade[k] - v) * (aShape < 1 ? 1 - aShape : 0);
      };
      const i = (py * w + px) * 4;
      data[i] = Math.round(c(0)); data[i + 1] = Math.round(c(1)); data[i + 2] = Math.round(c(2));
      data[i + 3] = Math.round(Math.max(aShape, sh * (1 - aShape)) * 255);
    }
  }
  return { width: w, height: h, data };
}

const MW = 22; // a quiet mark, in 1× px: the glyph alone on a faint cream disc, laid flat on the ground

/** One quiet mark: the kind's glyph in a softened colour on a faint disc, so the place is there without calling out. */
export function markImage(kind: SignKind, night = false): PatternImage {
  const w = MW * SCALE, h = MW * SCALE, c0 = MW / 2, r = MW / 2 - 1;
  const data = new Uint8Array(w * h * 4);
  const ink = hex(SIGN_COLOURS[kind]);
  const disc = hex(night ? '#2A1F17' : '#FFF6E6');
  const gs = (r * 1.25) / 24;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = (px + 0.5) / SCALE, y = (py + 0.5) / SCALE;
      const aDisc = Math.max(0, Math.min(1, 0.5 - (Math.hypot(x - c0, y - c0) - r) * SCALE)) * 0.55;
      const aGlyph = glyphAlpha(kind, (x - c0) / gs + 12, (y - c0) / gs + 12, gs * SCALE);
      const a = aGlyph + aDisc * (1 - aGlyph);
      const i = (py * w + px) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = Math.round(a ? (ink[k]! * aGlyph + disc[k]! * aDisc * (1 - aGlyph)) / a : 0);
      data[i + 3] = Math.round(a * 255);
    }
  }
  return { width: w, height: h, data };
}

const cache = new Map<string, Record<string, PatternImage>>();
/** Every signpost image for a light (night has warmer, dimmer cream), memoised: drawing them costs a few ms. */
export function signImages(night: boolean): Record<string, PatternImage> {
  const key = night ? 'n' : 'd';
  let imgs = cache.get(key);
  if (!imgs) {
    imgs = Object.fromEntries([
      ...FOOD_SIGNS.map((k) => [signImageId(k), signImage(k, night)] as const),
      ...SIGN_KINDS.filter((k) => !FOOD_SIGNS.includes(k)).map((k) => [markImageId(k), markImage(k, night)] as const),
    ]);
    cache.set(key, imgs);
  }
  return imgs;
}
