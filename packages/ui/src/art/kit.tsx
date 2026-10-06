import { Circle, G, Path } from 'react-native-svg';
import { art } from '@driver/design-tokens';

/**
 * The "Aziziyah sketchbook" kit (joy J4, design-system report S2-08 / Direction A): flat gouache fills,
 * one date-brown ink line that sits a little off its fill (a hand-inked print, slightly misregistered),
 * arch-topped frames like shanasheel windows, and fixed pigments that look the same by day and by night.
 *
 * `art.*` (design tokens) holds every pigment: the food, and the scene paints (kashi tiles, saffron light,
 * palm green, the green Iraqi door, the Tigris). Illustration only: nothing in the UI reads them as roles,
 * and no text ever sits on them.
 */
export const SKETCH = art;

/** Where the ink line sits relative to its fill: a little up and to one side. */
const INK_OFFSET = 'translate(1.6 -1.3)';

/** The ink outline of a shape, drawn off its fill. `w` is the line width in the drawing's own units. */
export function Ink({ d, w, opacity }: { d: string; w: number; opacity?: number }) {
  return <Path d={d} fill="none" stroke={SKETCH.line} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" transform={INK_OFFSET} opacity={opacity} />;
}

/** A filled shape with its ink outline: the basic stroke of the kit (2 elements). */
export function Shape({ d, fill, w, ink = true, opacity }: { d: string; fill: string; w: number; ink?: boolean; opacity?: number }) {
  return (
    <G>
      <Path d={d} fill={fill} opacity={opacity} />
      {ink ? <Ink d={d} w={w} /> : null}
    </G>
  );
}

/** An ellipse as a path, so it can take the off-register ink like any other shape. */
export function ellipseD(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
}

/** A circle as a path. */
export function circleD(cx: number, cy: number, r: number): string {
  return ellipseD(cx, cy, r, r);
}

/**
 * The shanasheel arch: straight sides and a softly pointed top whose rise is `rise` × width. The shape
 * signature of the set: every scene sits in one, every dish has a faint one behind it.
 */
export function archPath(x: number, y: number, w: number, h: number, rise = 0.42): string {
  const r = w * rise;
  const mid = x + w / 2;
  return [
    `M${x} ${y + h}`,
    `L${x} ${y + r}`,
    `C${x} ${y + r * 0.42} ${x + w * 0.28} ${y + r * 0.1} ${mid} ${y}`,
    `C${x + w * 0.72} ${y + r * 0.1} ${x + w} ${y + r * 0.42} ${x + w} ${y + r}`,
    `L${x + w} ${y + h}Z`,
  ].join('');
}

/** Two soft S-curves of steam rising from (x, y). Static: animation, when any, moves the layer. */
export function Steam({ x, y, h = 36, w = 3 }: { x: number; y: number; h?: number; w?: number }) {
  const q = h / 4;
  return (
    <G>
      <Path d={`M${x} ${y}q${q * 0.7} ${-q} 0 ${-q * 2}q${-q * 0.7} ${-q} 0 ${-q * 2}`} stroke={SKETCH.steam} strokeWidth={w} fill="none" strokeLinecap="round" />
      <Path d={`M${x + q * 1.4} ${y - q * 0.6}q${q * 0.6} ${-q * 0.8} 0 ${-q * 1.6}q${-q * 0.6} ${-q * 0.8} 0 ${-q * 1.6}`} stroke={SKETCH.steam} strokeWidth={w * 0.8} fill="none" strokeLinecap="round" opacity={0.7} />
    </G>
  );
}

/**
 * Paper grain: a fixed scatter of tiny dots (one static layer, spec §6 performance). The positions come
 * from a fixed sequence, so every phone and every render draws the same paper.
 */
export function Grain({ w, h, n = 14, r = 1.1 }: { w: number; h: number; n?: number; r?: number }) {
  return (
    <G opacity={0.1}>
      {Array.from({ length: n }, (_, i) => (
        <Circle key={i} cx={((i * 73 + 17) % 97) * (w / 97)} cy={((i * 41 + 29) % 89) * (h / 89)} r={r} fill={SKETCH.char} />
      ))}
    </G>
  );
}

/** A soft cast shadow under an object (no ink). */
export function Shadow({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return <Path d={ellipseD(cx, cy, rx, ry)} fill={SKETCH.rim} opacity={0.8} />;
}
