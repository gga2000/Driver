import { memo, type ReactElement } from 'react';
import { Circle, G, Line, Path } from 'react-native-svg';
import { archPath, circleD, ellipseD, Ink, Shadow, Shape, SKETCH as K, Steam } from './kit';

/**
 * The dish set of the Aziziyah sketchbook (joy J4, food-funnel S-3, design-system S2-07): one drawing per
 * kind of dish, each with its own silhouette so a menu reads at a glance at 64 px. Drawings, never photos:
 * they must not pretend to be a restaurant's real food (J-D3), and a merchant photo always replaces them.
 */
export const DISH_KINDS = [
  'kebab',
  'tikka',
  'liver',
  'chicken',
  'shawarma',
  'falafel',
  'wrap',
  'plate',
  'tray',
  'rice',
  'okra',
  'beans',
  'soup',
  'pacha',
  'dolma',
  'fish',
  'kubba',
  'bread',
  'salad',
  'pickles',
  'hummus',
  'sweet',
  'tea',
  'laban',
  'water',
  'can',
  'juice',
  'coffee',
  'icecream',
  // Food doors, idea o4 (2026-10-07): the sweets, coffee and cold drinks people pick by picture.
  'baklava',
  'zalabia',
  'kleicha',
  'cake',
  'dallah',
  'iced',
  'pomegranate',
  'lemonade',
  'bananamilk',
  'cocktail',
] as const;
export type DishKind = (typeof DISH_KINDS)[number];

/** How many looks each dish has (plate tint, garnish); the caller picks the tilt (`tilt`). */
export const DISH_LOOKS = 3;

interface Pen {
  plate: string;
  garnish: boolean;
  /** Ink width in the 200-unit box. */
  w: number;
}

/* ───────────────────────── shared pieces ───────────────────────── */

function Plate({ p, cx = 100, cy = 130, rx = 82, ry = 42 }: { p: Pen; cx?: number; cy?: number; rx?: number; ry?: number }) {
  return (
    <G>
      <Shadow cx={cx + 4} cy={cy + 8} rx={rx} ry={ry} />
      <Shape d={ellipseD(cx, cy, rx, ry)} fill={p.plate} w={p.w} />
      <Path d={ellipseD(cx, cy + 2, rx * 0.78, ry * 0.7)} fill="none" stroke={K.rim} strokeWidth={p.w * 0.7} />
    </G>
  );
}

/** A side-view bowl whose contents show as the top ellipse; `band` adds the kashi glaze stripe. */
function Bowl({ p, cx = 100, top = 104, rx = 62, depth = 58, fill, band }: { p: Pen; cx?: number; top?: number; rx?: number; depth?: number; fill: string; band?: boolean }) {
  const body = `M${cx - rx} ${top}C${cx - rx} ${top + depth * 1.25} ${cx + rx} ${top + depth * 1.25} ${cx + rx} ${top}Z`;
  return (
    <G>
      <Shadow cx={cx + 4} cy={top + depth + 6} rx={rx * 0.8} ry={9} />
      <Shape d={body} fill={p.plate} w={p.w} />
      {band ? <Path d={`M${cx - rx * 0.92} ${top + depth * 0.32}C${cx - rx * 0.6} ${top + depth * 0.62} ${cx + rx * 0.6} ${top + depth * 0.62} ${cx + rx * 0.92} ${top + depth * 0.32}`} stroke={K.kashi} strokeWidth={p.w * 1.4} fill="none" strokeLinecap="round" /> : null}
      <Shape d={ellipseD(cx, top, rx, rx * 0.24)} fill={fill} w={p.w * 0.8} />
    </G>
  );
}

/** A lumpy minced-meat kebab log from (x, y − t/2) along +x. */
function logD(x: number, y: number, len: number, t: number): string {
  const r = t / 2;
  const n = Math.max(2, Math.round(len / 26));
  const seg = len / n;
  let d = `M${x} ${y - r}`;
  for (let i = 0; i < n; i++) d += `q${seg / 2} -4 ${seg} 0`;
  d += `a${r} ${r} 0 0 1 0 ${t}`;
  for (let i = 0; i < n; i++) d += `q${-seg / 2} 4 ${-seg} 0`;
  d += `a${r} ${r} 0 0 1 0 ${-t}Z`;
  return d;
}

/** Grill marks across a log: short diagonal char strokes. */
function marks(x: number, y: number, len: number, t: number): string {
  let d = '';
  for (let mx = x + 12; mx < x + len - 6; mx += 22) d += `M${mx} ${y - t / 2 + 3}l7 ${t - 6}`;
  return d;
}

function Log({ p, x, y, len, t = 20, fill = K.meat }: { p: Pen; x: number; y: number; len: number; t?: number; fill?: string }) {
  return (
    <G>
      <Shape d={logD(x, y, len, t)} fill={fill} w={p.w} />
      <Path d={marks(x, y, len, t)} stroke={K.char} strokeWidth={p.w * 0.8} strokeLinecap="round" opacity={0.6} />
    </G>
  );
}

/** A sprig of parsley: three leaves and a stem (only on garnished looks). */
function Herb({ p, x, y, s = 1, always }: { p: Pen; x: number; y: number; s?: number; always?: boolean }) {
  if (!p.garnish && !always) return null;
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Path d="M0 0c-6-5-13-3-15 3c6 3 11 2 15-3ZM0 0c2-8-1-14-8-16c-1 7 2 12 8 16ZM0 0c7-4 14-1 15 5c-6 2-12 0-15-5Z" fill={K.herb} />
      <Path d="M0 0l4 10" stroke={K.palmDeep} strokeWidth={2.2} strokeLinecap="round" />
    </G>
  );
}

/** A lemon wedge, flat side up. */
function Lemon({ p, x, y, r = 14, rot = 0 }: { p: Pen; x: number; y: number; r?: number; rot?: number }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${rot})`}>
      <Shape d={`M${-r} 0A${r} ${r} 0 0 0 ${r} 0Z`} fill={K.lemon} w={p.w * 0.8} />
      <Path d={`M${-r + 4} 2A${r - 4} ${r - 4} 0 0 0 ${r - 4} 2Z`} fill={K.onion} />
    </G>
  );
}

function Tomato({ p, x, y, r = 12 }: { p: Pen; x: number; y: number; r?: number }) {
  return (
    <G>
      <Shape d={circleD(x, y, r)} fill={K.tomato} w={p.w * 0.8} />
      <Path d={`M${x - r * 0.5} ${y - r * 0.2}q${r * 0.5} ${-r * 0.5} ${r} 0`} stroke={K.char} strokeWidth={p.w * 0.6} fill="none" strokeLinecap="round" opacity={0.55} />
    </G>
  );
}

function OnionRing({ p, x, y, rx = 13, ry = 8 }: { p: Pen; x: number; y: number; rx?: number; ry?: number }) {
  return <Path d={ellipseD(x, y, rx, ry)} fill="none" stroke={K.onion} strokeWidth={p.w * 1.3} />;
}

/**
 * A dome of تمن from x0 to x1 standing on `base`, its top at `top`: pale grains with the brown
 * vermicelli flecks Iraqi rice has, so it never reads as a plain white half-disc.
 */
function Rice({ p, x0, x1, base, top }: { p: Pen; x0: number; x1: number; base: number; top: number }) {
  const cx = (x0 + x1) / 2;
  const rx = (x1 - x0) / 2;
  const h = base - top;
  const n = 7;
  // A heap, not a smooth dome: the outline bumps out between points on the arc, like piled grains.
  let d = `M${x0} ${base}`;
  for (let i = 1; i <= n; i++) {
    const t0 = (Math.PI * (i - 1)) / n;
    const t1 = (Math.PI * i) / n;
    const tm = (t0 + t1) / 2;
    const bulge = 1.12;
    const qx = cx - rx * bulge * Math.cos(tm);
    const qy = base - h * bulge * Math.sin(tm);
    d += `Q${qx.toFixed(1)} ${qy.toFixed(1)} ${(cx - rx * Math.cos(t1)).toFixed(1)} ${(base - h * Math.sin(t1)).toFixed(1)}`;
  }
  d += 'Z';
  let flecks = '';
  let grains = '';
  for (let i = 0; i < 12; i++) {
    const fx = x0 + (x1 - x0) * (0.16 + ((i * 37) % 68) / 100);
    const fy = base - h * (0.1 + ((i * 23) % 64) / 100);
    if (i % 3 === 0) flecks += `M${fx.toFixed(1)} ${fy.toFixed(1)}l6 -2`;
    else grains += `M${fx.toFixed(1)} ${fy.toFixed(1)}l4 1.5`;
  }
  return (
    <G>
      <Shape d={d} fill={K.rice} w={p.w} />
      <Path d={grains} stroke={K.bread} strokeWidth={p.w * 0.9} strokeLinecap="round" />
      <Path d={flecks} stroke={K.fried} strokeWidth={p.w} strokeLinecap="round" />
    </G>
  );
}

/** A stew bowl (باميا, فاصوليا) with the kashi glaze band; the contents are drawn by the caller. */
function Stew({ p, stew, children }: { p: Pen; stew: string; children: ReactElement }) {
  return (
    <G>
      <Bowl p={p} cx={96} top={106} rx={70} depth={58} fill={stew} band />
      {children}
      <Steam x={88} y={86} h={34} w={p.w * 0.8} />
      <Steam x={120} y={84} h={28} w={p.w * 0.8} />
    </G>
  );
}

/** A side-view glass, wider at the top. */
function glassD(cx: number, top: number, bottom: number, wTop: number, wBottom: number): string {
  return `M${cx - wTop / 2} ${top}L${cx + wTop / 2} ${top}L${cx + wBottom / 2} ${bottom - 4}Q${cx + wBottom / 2} ${bottom} ${cx + wBottom / 2 - 4} ${bottom}L${cx - wBottom / 2 + 4} ${bottom}Q${cx - wBottom / 2} ${bottom} ${cx - wBottom / 2} ${bottom - 4}Z`;
}

/** The part of a `glassD` glass between heights y1 and y2 (its sides taper the same way): a drink's layer. */
function bandD(cx: number, top: number, bottom: number, wTop: number, wBottom: number, y1: number, y2: number): string {
  const half = (y: number) => (wTop + ((wBottom - wTop) * (y - top)) / (bottom - top)) / 2;
  const a = half(y1) - 3;
  const b = half(y2) - 3;
  return `M${cx - a} ${y1}L${cx + a} ${y1}L${cx + b} ${y2}L${cx - b} ${y2}Z`;
}

/** An ice cube seen a little from above (translucent, inked). */
function Cube({ p, x, y, s = 14, rot = 0 }: { p: Pen; x: number; y: number; s?: number; rot?: number }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${rot})`}>
      <Shape d={`M${-s / 2} ${-s / 2}h${s}v${s}h${-s}Z`} fill={K.white} w={p.w * 0.6} opacity={0.75} />
      <Path d={`M${-s / 2 + 3} ${-s / 2 + 3}l${s * 0.35} 0`} stroke={K.water} strokeWidth={p.w * 0.6} strokeLinecap="round" />
    </G>
  );
}

/** A mint sprig on a drink. */
function Mint({ p, x, y, s = 1 }: { p: Pen; x: number; y: number; s?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Shape d="M0 0q-18-6-20-20q16-2 20 20Z" fill={K.herb} w={p.w * 0.6} />
      <Shape d="M0 0q4-20 18-24q4 16-18 24Z" fill={K.palm} w={p.w * 0.6} />
      <Path d="M0 0l2 12" stroke={K.palmDeep} strokeWidth={p.w * 0.8} strokeLinecap="round" />
    </G>
  );
}

/* ───────────────────────── the dishes ───────────────────────── */

function drawDish(kind: DishKind, p: Pen): ReactElement {
  switch (kind) {
    case 'kebab':
      return (
        <G>
          <Plate p={p} />
          <G transform="rotate(-10 100 126)">
            <Line x1={20} y1={112} x2={180} y2={112} stroke={K.metal} strokeWidth={p.w} strokeLinecap="round" />
            <Log p={p} x={40} y={112} len={116} t={22} />
            <Line x1={26} y1={142} x2={176} y2={142} stroke={K.metal} strokeWidth={p.w} strokeLinecap="round" />
            <Log p={p} x={50} y={142} len={100} t={20} />
          </G>
          <Tomato p={p} x={156} y={152} r={13} />
          <OnionRing p={p} x={50} y={158} />
          <Herb p={p} x={92} y={168} s={0.9} />
        </G>
      );
    case 'tikka':
      return (
        <G>
          <Plate p={p} />
          <G transform="rotate(-18 100 126)">
            <Line x1={14} y1={124} x2={186} y2={124} stroke={K.metal} strokeWidth={p.w} strokeLinecap="round" />
            {[K.meat, K.onion, K.meat, K.tomato, K.meat, K.onion].map((c, k) => {
              const x = 30 + k * 24;
              return <Shape key={k} d={`M${x + 4} 112h14q4 0 4 4v16q0 4-4 4h-14q-4 0-4-4v-16q0-4 4-4Z`} fill={c} w={p.w * 0.8} />;
            })}
            <Path d="M34 115h14M82 115h14M130 115h14" stroke={K.char} strokeWidth={p.w * 1.1} strokeLinecap="round" opacity={0.7} />
          </G>
          <Lemon p={p} x={54} y={156} rot={-12} />
          <Herb p={p} x={150} y={160} />
        </G>
      );
    case 'liver': {
      const cubes: ReadonlyArray<readonly [number, number, number]> = [
        [66, 112, -14],
        [90, 104, 10],
        [114, 108, -6],
        [138, 116, 18],
        [76, 132, 22],
        [102, 128, -20],
        [126, 136, 6],
        [96, 148, 12],
      ];
      return (
        <G>
          <Plate p={p} />
          {cubes.map(([x, y, r], i) => (
            <G key={i} transform={`rotate(${r} ${x} ${y})`}>
              <Shape d={`M${x - 10} ${y - 8}q10-3 20 0q3 8 0 16q-10 3-20 0q-3-8 0-16Z`} fill={i % 3 === 1 ? K.meat : K.char} w={p.w * 0.75} />
            </G>
          ))}
          <Lemon p={p} x={156} y={144} r={13} rot={-20} />
          <OnionRing p={p} x={46} y={146} rx={11} ry={7} />
          <Herb p={p} x={142} y={98} s={0.8} />
        </G>
      );
    }
    case 'chicken':
      return (
        <G>
          <Plate p={p} />
          {[110, 142].map((y, row) => (
            <G key={y} transform={`rotate(-8 100 ${y})`}>
              <Line x1={20 + row * 10} y1={y} x2={180 - row * 6} y2={y} stroke={K.metal} strokeWidth={p.w} strokeLinecap="round" />
              {[0, 1, 2, 3].map((k) => (
                <Shape key={k} d={`M${44 + row * 8 + k * 30} ${y - 11}q14-2 15 11q-1 13-15 11q-14 2-13-11q-1-13 13-11Z`} fill={K.chicken} w={p.w * 0.75} />
              ))}
              <Path d={`M${46 + row * 8} ${y - 4}l6 8M${76 + row * 8} ${y - 4}l6 8M${106 + row * 8} ${y - 4}l6 8M${136 + row * 8} ${y - 4}l6 8`} stroke={K.meat} strokeWidth={p.w * 0.8} strokeLinecap="round" />
            </G>
          ))}
          <Tomato p={p} x={160} y={162} r={10} />
          <Herb p={p} x={48} y={166} s={0.85} />
        </G>
      );
    case 'shawarma':
      return (
        <G>
          <Shadow cx={104} cy={178} rx={46} ry={8} />
          <G transform="rotate(-10 100 110)">
            <Shape d="M62 118L62 70Q100 34 138 70L138 118Z" fill={K.bread} w={p.w} />
            <Path d="M70 66q8-12 18-2q10-12 22-2q10-10 20 2" stroke={K.meat} strokeWidth={p.w * 3} strokeLinecap="round" fill="none" />
            <Path d="M74 58l4-6M100 50l3-7M122 58l5-5" stroke={K.char} strokeWidth={p.w * 0.9} strokeLinecap="round" />
            <Path d={ellipseD(84, 74, 7, 4)} fill={K.cucumber} />
            <Path d={ellipseD(116, 72, 7, 4)} fill={K.tomato} />
            <Shape d="M60 120L60 86Q100 104 140 86L140 120Z" fill={K.bread} w={p.w} />
            <Shape d="M56 112L144 112L134 184L66 184Z" fill={K.white} w={p.w} />
            <Path d="M70 140L130 140M100 112L96 184" stroke={K.rim} strokeWidth={p.w * 0.8} />
          </G>
        </G>
      );
    case 'falafel':
      return (
        <G>
          <Shadow cx={104} cy={150} rx={78} ry={12} />
          <Shape d="M22 124Q100 66 178 124Q100 166 22 124Z" fill={K.bread} w={p.w} />
          <Path d="M40 120Q100 92 160 120Q100 108 40 120Z" fill={K.char} opacity={0.8} />
          {[
            [70, 106, 13],
            [98, 98, 14],
            [126, 104, 13],
          ].map(([x, y, r]) => (
            <Shape key={x} d={circleD(x!, y!, r!)} fill={K.fried} w={p.w * 0.8} />
          ))}
          <Shape d={circleD(152, 150, 14)} fill={K.fried} w={p.w * 0.8} />
          <Path d={circleD(152, 150, 9)} fill={K.herb} />
          <Path d="M84 96q-6-14 4-20M112 94q6-12 16-10" stroke={K.herb} strokeWidth={p.w * 1.4} strokeLinecap="round" fill="none" />
          <Path d={ellipseD(140, 112, 8, 4)} fill={K.tomato} />
          <Path d="M48 134q52 18 104 0" stroke={K.fried} strokeWidth={p.w} fill="none" strokeLinecap="round" opacity={0.6} />
        </G>
      );
    case 'wrap':
      return (
        <G>
          <Shadow cx={104} cy={152} rx={76} ry={12} />
          <G transform="rotate(-24 100 112)">
            <Shape d="M40 92h116a20 20 0 0 1 0 40h-116a20 20 0 0 1 0-40Z" fill={K.bread} w={p.w} />
            <Path d="M70 100l3 3M98 120l4 2M122 98l3 3M56 122l3 2" stroke={K.fried} strokeWidth={p.w * 1.2} strokeLinecap="round" />
            <Shape d={ellipseD(158, 112, 11, 20)} fill={K.onion} w={p.w * 0.8} />
            <Path d={ellipseD(158, 112, 7, 13)} fill={K.meat} />
            <Path d="M162 96q10-6 16 2" stroke={K.herb} strokeWidth={p.w * 1.5} strokeLinecap="round" fill="none" />
            <Shape d="M26 90L74 90L74 134L26 134Z" fill={K.white} w={p.w} />
            <Path d="M50 90L46 134" stroke={K.rim} strokeWidth={p.w * 0.8} />
          </G>
        </G>
      );
    case 'plate':
      return (
        <G>
          <Plate p={p} />
          <Rice p={p} x0={28} x1={110} base={134} top={78} />
          <G transform="rotate(-22 140 120)">
            <Log p={p} x={104} y={120} len={70} t={18} />
          </G>
          <Tomato p={p} x={118} y={152} r={10} />
          <Shape d={circleD(140, 156, 9)} fill={K.cucumber} w={p.w * 0.7} />
          <Herb p={p} x={160} y={146} s={0.8} always />
        </G>
      );
    case 'tray':
      return (
        <G>
          <Shadow cx={104} cy={140} rx={92} ry={50} />
          <Shape d={ellipseD(100, 126, 92, 52)} fill={K.metal} w={p.w} />
          <Path d={ellipseD(100, 126, 84, 45)} fill={K.rim} />
          <Shape d="M28 124q8-34 40-38q30-10 64 0q34 6 42 38q-8 32-42 38q-34 8-64 0q-32-6-40-38Z" fill={K.bread} w={p.w * 0.8} />
          <G transform="rotate(-14 100 124)">
            {[100, 116, 132, 148].map((y, i) => (
              <Log key={y} p={p} x={44 + (i % 2) * 8} y={y} len={104 - (i % 2) * 10} t={15} />
            ))}
          </G>
          <Tomato p={p} x={40} y={112} r={10} />
          <Tomato p={p} x={162} y={142} r={10} />
          <OnionRing p={p} x={150} y={98} rx={11} ry={7} />
        </G>
      );
    case 'rice':
      return (
        <G>
          <Plate p={p} cx={92} rx={78} />
          <Rice p={p} x0={24} x1={118} base={136} top={72} />
          <Bowl p={p} cx={148} top={124} rx={34} depth={34} fill={K.tomato} band />
          <Path d={circleD(140, 123, 5)} fill={K.meat} />
          <Steam x={146} y={106} h={30} w={p.w * 0.8} />
        </G>
      );
    case 'okra':
      return (
        <Stew p={p} stew={K.tomato}>
          <G>
            {[
              [60, 104, -30],
              [84, 100, 15],
              [108, 106, -10],
              [128, 102, 35],
            ].map(([x, y, r]) => (
              <G key={x} transform={`rotate(${r} ${x} ${y})`}>
                <Shape d={`M${x! - 12} ${y}q12-9 24 0q-12 9-24 0Z`} fill={K.herb} w={p.w * 0.6} />
              </G>
            ))}
            <Shape d={circleD(96, 116, 6)} fill={K.cucumber} w={p.w * 0.6} />
            <Path d={circleD(96, 116, 2.4)} fill={K.onion} />
          </G>
        </Stew>
      );
    case 'beans':
      return (
        <Stew p={p} stew={K.juice}>
          <G>
            {[
              [60, 104],
              [78, 98],
              [96, 106],
              [114, 100],
              [130, 108],
              [86, 116],
              [108, 116],
            ].map(([x, y], i) => (
              <Shape key={i} d={ellipseD(x!, y!, 7, 4.5)} fill={K.white} w={p.w * 0.5} />
            ))}
          </G>
        </Stew>
      );
    case 'soup':
      return (
        <G>
          <Bowl p={p} cx={96} top={102} rx={78} depth={50} fill={K.lentil} />
          <Path d="M66 98h3M96 106h3M118 96h3M82 112h3" stroke={K.char} strokeWidth={p.w} strokeLinecap="round" opacity={0.6} />
          <Path d="M70 100q26 10 52 0" stroke={K.saffron} strokeWidth={p.w * 0.8} fill="none" opacity={0.8} />
          <Lemon p={p} x={162} y={100} r={15} rot={-25} />
          <Steam x={80} y={86} h={34} w={p.w * 0.8} />
          <Steam x={112} y={82} h={30} w={p.w * 0.8} />
        </G>
      );
    case 'pacha':
      return (
        <G>
          <Shadow cx={104} cy={170} rx={62} ry={10} />
          <Shape d="M50 84L150 84L144 160Q100 176 56 160Z" fill={K.metal} w={p.w} />
          <Path d="M53 108L147 108" stroke={K.rim} strokeWidth={p.w * 1.5} />
          <Path d="M50 92q-14 0-14 12M150 92q14 0 14 12" stroke={K.line} strokeWidth={p.w} fill="none" strokeLinecap="round" />
          <Path d={ellipseD(100, 84, 50, 10)} fill={K.char} />
          <G transform="rotate(-14 130 70)">
            <Shape d={ellipseD(112, 72, 50, 9)} fill={K.metal} w={p.w} />
            <Shape d={circleD(112, 60, 6)} fill={K.char} w={p.w * 0.7} />
          </G>
          <Steam x={72} y={80} h={36} w={p.w * 0.8} />
          <Shape d="M28 172Q24 132 46 128Q66 132 62 172Z" fill={K.bread} w={p.w * 0.9} />
          <Path d="M38 146l3 2M48 156l3 1" stroke={K.fried} strokeWidth={p.w} strokeLinecap="round" />
        </G>
      );
    case 'dolma': {
      const rolls: ReadonlyArray<readonly [number, number, number]> = [
        [62, 112, -20],
        [88, 104, 10],
        [116, 104, -8],
        [142, 114, 22],
        [60, 140, 18],
        [140, 142, -16],
      ];
      return (
        <G>
          <Shadow cx={104} cy={136} rx={88} ry={50} />
          <Shape d={ellipseD(100, 126, 88, 50)} fill={K.char} w={p.w} />
          <Path d={ellipseD(100, 126, 80, 43)} fill={K.meat} />
          {rolls.map(([x, y, r], i) => (
            <G key={i} transform={`rotate(${r} ${x} ${y})`}>
              <Shape d={`M${x - 14} ${y - 8}h28a8 8 0 0 1 0 16h-28a8 8 0 0 1 0-16Z`} fill={K.herb} w={p.w * 0.6} />
              <Path d={`M${x - 10} ${y}h20`} stroke={K.palmDeep} strokeWidth={p.w * 0.5} />
            </G>
          ))}
          <Shape d={circleD(88, 136, 13)} fill={K.onion} w={p.w * 0.7} />
          <Path d={circleD(88, 136, 6)} fill="none" stroke={K.bread} strokeWidth={p.w * 0.7} />
          <Shape d={circleD(114, 138, 12)} fill={K.tomato} w={p.w * 0.7} />
          <Path d="M114 126q2-6 6-7" stroke={K.palmDeep} strokeWidth={p.w} strokeLinecap="round" fill="none" />
        </G>
      );
    }
    case 'fish':
      return (
        <G>
          <Shadow cx={104} cy={140} rx={88} ry={44} />
          <Shape d="M18 128q10-40 82-44q72 4 82 44q-10 38-82 42q-72-4-82-42Z" fill={K.bread} w={p.w * 0.8} />
          <G transform="rotate(-6 100 124)">
            <Shape d="M28 124C52 84 132 84 158 124C132 164 52 164 28 124Z" fill={K.fried} w={p.w} />
            <Shape d="M156 124L186 104L180 124L186 144Z" fill={K.fried} w={p.w} />
            <Path d="M40 124L152 124" stroke={K.char} strokeWidth={p.w * 0.9} strokeLinecap="round" />
            <Path d="M62 100l-8 14M84 96l-8 16M106 96l-8 16M128 100l-8 14M62 148l-8-14M84 152l-8-16M106 152l-8-16M128 148l-8-14" stroke={K.char} strokeWidth={p.w * 0.9} strokeLinecap="round" opacity={0.65} />
            <Circle cx={42} cy={118} r={3.4} fill={K.line} />
          </G>
          <Lemon p={p} x={52} y={168} r={13} rot={-10} />
          <OnionRing p={p} x={150} y={164} rx={10} ry={6} />
          <Herb p={p} x={100} y={176} s={0.8} />
        </G>
      );
    case 'kubba': {
      const spindle = 'M-30 0C-16-18 16-18 30 0C16 18-16 18-30 0Z';
      return (
        <G>
          <Plate p={p} />
          {[
            [64, 116, -18],
            [122, 108, 12],
          ].map(([x, y, r]) => (
            <G key={x} transform={`translate(${x} ${y}) rotate(${r})`}>
              <Shape d={spindle} fill={K.fried} w={p.w} />
              <Path d="M-18-6q18-8 36 0" stroke={K.bread} strokeWidth={p.w * 0.8} fill="none" strokeLinecap="round" opacity={0.8} />
            </G>
          ))}
          <G transform="translate(100 146) rotate(-6)">
            <Shape d={spindle} fill={K.fried} w={p.w} />
            <Path d="M-20 0C-10-10 10-10 20 0C10 10-10 10-20 0Z" fill={K.meat} />
            <Path d="M-8-2h3M4 2h3M-2 4h3" stroke={K.herb} strokeWidth={p.w} strokeLinecap="round" />
          </G>
          <Lemon p={p} x={158} y={146} r={13} rot={-24} />
        </G>
      );
    }
    case 'bread': {
      const samoon = 'M-62 0Q-32-26 0-28Q32-26 62 0Q32 26 0 28Q-32 26-62 0Z';
      return (
        <G>
          <Shadow cx={104} cy={150} rx={80} ry={14} />
          {[
            [94, 128, 10],
            [108, 100, -14],
          ].map(([x, y, r]) => (
            <G key={x} transform={`translate(${x} ${y}) rotate(${r})`}>
              <Shape d={samoon} fill={K.bread} w={p.w} />
              <Path d="M-50-4Q-26-22 0-24Q26-22 50-4Q24-14 0-14Q-24-14-50-4Z" fill={K.fried} opacity={0.55} />
              <Path d="M-34 0Q0-8 34 0" stroke={K.char} strokeWidth={p.w * 0.9} fill="none" strokeLinecap="round" />
            </G>
          ))}
        </G>
      );
    }
    case 'salad':
      return (
        <G>
          <Bowl p={p} cx={100} top={110} rx={70} depth={50} fill={K.herb} band />
          <Path d="M44 108q10-26 30-18q14-20 34-8q22-14 34 6q14 2 14 18Z" fill={K.herb} />
          {[
            [60, 96],
            [104, 86],
            [134, 100],
          ].map(([x, y]) => (
            <Shape key={x} d={`M${x} ${y}h12v11h-12Z`} fill={K.tomato} w={p.w * 0.6} />
          ))}
          {[
            [84, 96],
            [122, 90],
          ].map(([x, y]) => (
            <G key={x}>
              <Shape d={circleD(x!, y!, 8)} fill={K.cucumber} w={p.w * 0.6} />
              <Path d={circleD(x!, y!, 4)} fill={K.onion} />
            </G>
          ))}
          <Path d="M70 104h6M96 100h5M146 106h5" stroke={K.onion} strokeWidth={p.w * 1.2} strokeLinecap="round" />
        </G>
      );
    case 'pickles':
      return (
        <G>
          <Shadow cx={104} cy={176} rx={50} ry={8} />
          <Shape d="M60 64Q60 54 70 54L130 54Q140 54 140 64L144 162Q144 176 130 176L70 176Q56 176 56 162Z" fill={K.turnip} w={p.w} opacity={0.55} />
          {[
            [82, 92, -20],
            [114, 104, 14],
            [86, 132, 8],
            [118, 146, -12],
          ].map(([x, y, r]) => (
            <G key={y} transform={`rotate(${r} ${x} ${y})`}>
              <Path d={`M${x! - 14} ${y}A14 14 0 0 1 ${x! + 14} ${y}Z`} fill={K.turnip} />
              <Path d={`M${x! - 9} ${y}A9 9 0 0 1 ${x! + 9} ${y}`} stroke={K.white} strokeWidth={1.6} fill="none" opacity={0.7} />
            </G>
          ))}
          <Path d="M104 72q-10 30 4 60M128 80q6 26-4 44" stroke={K.herb} strokeWidth={p.w * 1.8} strokeLinecap="round" fill="none" />
          <Path d="M70 70L72 160" stroke={K.white} strokeWidth={p.w * 1.2} strokeLinecap="round" opacity={0.6} />
          <Shape d="M64 38h72q4 0 4 4v14q0 4-4 4h-72q-4 0-4-4v-14q0-4 4-4Z" fill={K.tomato} w={p.w} />
        </G>
      );
    case 'hummus':
      return (
        <G>
          <Plate p={p} cy={128} rx={84} ry={46} />
          <Shape d={ellipseD(100, 124, 64, 32)} fill={K.hummus} w={p.w * 0.8} />
          <Path d="M58 124q6-20 42-20q36 0 40 18q-4 14-40 14q-26 0-26-10q2-10 26-10q16 0 18 6" stroke={K.bread} strokeWidth={p.w} fill="none" strokeLinecap="round" />
          <Path d={ellipseD(100, 124, 18, 8)} fill={K.saffron} opacity={0.75} />
          {[
            [92, 122],
            [104, 126],
            [110, 120],
          ].map(([x, y]) => (
            <Shape key={x} d={circleD(x!, y!, 4)} fill={K.bread} w={p.w * 0.45} />
          ))}
          <Path d="M66 136h2M134 116h2M128 138h2M72 112h2" stroke={K.tomato} strokeWidth={p.w * 1.2} strokeLinecap="round" />
          <Herb p={p} x={150} y={150} s={0.8} />
        </G>
      );
    case 'sweet':
      return (
        <G>
          <Shadow cx={104} cy={136} rx={86} ry={44} />
          <Shape d={ellipseD(100, 124, 86, 44)} fill={K.metal} w={p.w} />
          <Shape d="M100 124L178 124A78 38 0 1 1 159.8 99.6Z" fill={K.juice} w={p.w} />
          <Path d="M50 116l8 4M70 140l8-3M90 104l8 3M128 146l7-2M56 136l7 2" stroke={K.char} strokeWidth={p.w * 0.7} strokeLinecap="round" opacity={0.4} />
          <Path d="M80 120h4M96 112h4M88 130h4M106 132h4" stroke={K.herb} strokeWidth={p.w * 1.4} strokeLinecap="round" />
          <G transform="translate(150 158) rotate(-8)">
            <Shape d="M-24 4L24 -4L8 -26Z" fill={K.juice} w={p.w * 0.9} />
            <Path d="M-22 6L24 -2L24 4L-22 12Z" fill={K.white} />
            <Ink d="M-22 6L24 -2L24 4L-22 12Z" w={p.w * 0.6} />
          </G>
        </G>
      );
    case 'tea':
      return (
        <G>
          <Shadow cx={104} cy={170} rx={64} ry={12} />
          <Shape d={ellipseD(100, 160, 64, 15)} fill={p.plate} w={p.w} />
          <Path d={ellipseD(100, 158, 30, 6)} fill="none" stroke={K.saffron} strokeWidth={p.w * 0.7} />
          <Shape d="M70 62Q64 100 82 112Q64 126 74 158L126 158Q136 126 118 112Q136 100 130 62Z" fill={K.white} w={p.w} opacity={0.9} />
          <Path d="M74 80Q70 102 85 112Q69 126 78 154L122 154Q131 126 115 112Q130 102 126 80Z" fill={K.tea} />
          <Path d="M70 62L130 62" stroke={K.saffron} strokeWidth={p.w * 0.9} strokeLinecap="round" />
          <Path d="M84 90Q80 104 90 112" stroke={K.white} strokeWidth={p.w * 0.9} fill="none" strokeLinecap="round" opacity={0.55} />
          <Path d="M138 162L168 146" stroke={K.metal} strokeWidth={p.w * 1.2} strokeLinecap="round" />
          <Path d={ellipseD(140, 162, 6, 3)} fill={K.metal} />
          <Steam x={98} y={54} h={36} w={p.w * 0.8} />
        </G>
      );
    case 'laban':
      return (
        <G>
          <Shadow cx={104} cy={176} rx={42} ry={8} />
          <Shape d={glassD(100, 46, 172, 72, 56)} fill={K.white} w={p.w} />
          <Path d={`M66 64Q83 56 100 64Q117 72 134 64`} stroke={K.rim} strokeWidth={p.w * 1.1} fill="none" strokeLinecap="round" />
          <Path d="M76 80L82 160" stroke={K.rim} strokeWidth={p.w * 1.3} strokeLinecap="round" />
          {p.garnish ? (
            <G>
              <Shape d="M120 44q16-14 26 0q-14 10-26 0Z" fill={K.herb} w={p.w * 0.6} />
              <Shape d="M118 48q-4-18 10-24q6 14-10 24Z" fill={K.herb} w={p.w * 0.6} />
            </G>
          ) : null}
        </G>
      );
    case 'water':
      return (
        <G>
          <Shadow cx={102} cy={178} rx={36} ry={7} />
          <Shape d="M86 30h28v16h-28Z" fill={K.kashi} w={p.w} />
          <Shape d="M88 50Q88 46 92 46L108 46Q112 46 112 50L114 64Q132 74 132 96L132 166Q132 176 122 176L78 176Q68 176 68 166L68 96Q68 74 86 64Z" fill={K.water} w={p.w} opacity={0.6} />
          <Path d="M70 110h60M70 152h60" stroke={K.white} strokeWidth={p.w * 0.8} opacity={0.7} />
          <Shape d="M68 118h64v26h-64Z" fill={K.white} w={p.w * 0.7} />
          <Path d="M78 131q8-6 16 0q8 6 16 0q8-6 14 0" stroke={K.kashi} strokeWidth={p.w * 0.9} fill="none" strokeLinecap="round" />
          <Path d="M80 80L80 102" stroke={K.white} strokeWidth={p.w} strokeLinecap="round" opacity={0.7} />
        </G>
      );
    case 'can':
      return (
        <G>
          <Shadow cx={104} cy={174} rx={40} ry={8} />
          <Shape d="M70 52Q70 44 78 44L122 44Q130 44 130 52L130 162Q130 170 122 170L78 170Q70 170 70 162Z" fill={K.can} w={p.w} />
          <Path d="M70 92Q100 80 130 92L130 120Q100 108 70 120Z" fill={K.white} />
          <Path d="M76 108q12-8 24 0q12 8 24 0" stroke={K.saffron} strokeWidth={p.w * 1.2} fill="none" strokeLinecap="round" />
          <Shape d={ellipseD(100, 46, 28, 6)} fill={K.metal} w={p.w * 0.8} />
          <Path d={ellipseD(108, 45, 7, 2.5)} fill="none" stroke={K.line} strokeWidth={p.w * 0.5} />
          <Path d="M80 60L80 150" stroke={K.white} strokeWidth={p.w} strokeLinecap="round" opacity={0.35} />
        </G>
      );
    case 'juice':
      return (
        <G>
          <Shadow cx={104} cy={176} rx={42} ry={8} />
          <Line x1={118} y1={22} x2={106} y2={120} stroke={K.tomato} strokeWidth={p.w * 1.8} strokeLinecap="round" />
          <Shape d={glassD(100, 52, 172, 72, 56)} fill={K.juice} w={p.w} />
          <Path d="M76 80L82 160" stroke={K.white} strokeWidth={p.w * 1.2} strokeLinecap="round" opacity={0.45} />
          <G transform="translate(134 56) rotate(20)">
            <Shape d={circleD(0, 0, 15)} fill={K.juice} w={p.w * 0.8} />
            <Path d={circleD(0, 0, 10)} fill={K.saffron} />
            <Path d="M0-10L0 10M-10 0L10 0M-7-7L7 7M-7 7L7-7" stroke={K.juice} strokeWidth={1.4} />
          </G>
          {p.garnish ? <Herb p={p} x={74} y={52} s={0.7} /> : null}
        </G>
      );
    case 'coffee':
      // A café cup on its saucer (not the tea glass): crema with a heart, a curl of steam; two dates when garnished.
      return (
        <G>
          <Shadow cx={104} cy={170} rx={70} ry={13} />
          <Shape d={ellipseD(100, 160, 70, 16)} fill={p.plate} w={p.w} />
          <Path d={ellipseD(100, 158, 36, 7)} fill="none" stroke={K.rim} strokeWidth={p.w * 0.8} />
          <Shape d="M138 106Q166 104 164 126Q162 146 134 144" fill="none" w={p.w * 1.6} />
          <Shape d="M56 96L144 96Q142 156 100 158Q58 156 56 96Z" fill={K.white} w={p.w} />
          <Path d="M62 120Q100 132 138 120" stroke={K.kashi} strokeWidth={p.w * 1.2} fill="none" strokeLinecap="round" />
          <Shape d={ellipseD(100, 96, 44, 11)} fill={K.char} w={p.w * 0.8} />
          <Path d="M100 102Q86 94 92 89Q97 86 100 91Q103 86 108 89Q114 94 100 102Z" fill={K.bread} />
          <Steam x={92} y={78} h={34} w={p.w * 0.8} />
          {p.garnish ? (
            <G>
              <Shape d={ellipseD(46, 158, 9, 5)} fill={K.wood} w={p.w * 0.6} />
              <Shape d={ellipseD(156, 160, 9, 5)} fill={K.wood} w={p.w * 0.6} />
            </G>
          ) : null}
        </G>
      );
    case 'icecream':
      // A waffle cone with two scoops (qaimar under strawberry), one drip; pistachio crumbs when garnished.
      return (
        <G>
          <Shadow cx={104} cy={182} rx={22} ry={5} />
          <Shape d="M70 104L130 104L102 182Q100 186 98 182Z" fill={K.chicken} w={p.w} />
          <Path d="M78 116L116 154M92 108L124 140M74 128L106 172M110 108L84 160M124 112L96 176M100 106L80 140" stroke={K.fried} strokeWidth={p.w * 0.7} strokeLinecap="round" opacity={0.7} />
          <Shape d="M64 104Q60 72 100 70Q140 72 136 104Q130 112 118 106Q112 116 104 108Q94 116 86 106Q74 114 64 104Z" fill={K.rice} w={p.w} />
          <Shape d={circleD(100, 56, 28)} fill={K.turnip} w={p.w} />
          <Path d="M116 76Q120 90 118 94Q114 98 112 92Q111 84 108 80Z" fill={K.turnip} />
          <Path d="M84 46Q90 38 98 38" stroke={K.white} strokeWidth={p.w * 1.1} fill="none" strokeLinecap="round" opacity={0.7} />
          {p.garnish ? <Path d="M90 32h4M104 30h4M114 40h4M82 58h4M110 62h4" stroke={K.cucumber} strokeWidth={p.w * 1.6} strokeLinecap="round" /> : null}
        </G>
      );
    case 'baklava': {
      // A round tray cut in diamonds: golden layers, a pistachio on each.
      const rows: Array<[number, number[]]> = [
        [102, [62, 92, 122]],
        [118, [48, 78, 108, 138]],
        [134, [62, 92, 122, 152]],
        [150, [78, 108, 138]],
      ];
      const cells = rows.flatMap(([cy, xs]) => xs.map((cx): [number, number] => [cx, cy]));
      return (
        <G>
          <Shadow cx={104} cy={136} rx={86} ry={44} />
          <Shape d={ellipseD(100, 126, 86, 44)} fill={K.metal} w={p.w} />
          <Path d={ellipseD(100, 124, 76, 37)} fill={K.fried} />
          {/* All diamonds, cuts and pistachios as one path each: one drawing stays light to render. */}
          <Shape d={cells.map(([cx, cy]) => `M${cx - 15} ${cy}L${cx} ${cy - 8}L${cx + 15} ${cy}L${cx} ${cy + 8}Z`).join('')} fill={K.bread} w={p.w * 0.6} />
          <Path d={cells.map(([cx, cy]) => `M${cx - 8} ${cy + 2}L${cx + 8} ${cy - 2}`).join('')} stroke={K.fried} strokeWidth={p.w * 0.5} strokeLinecap="round" opacity={0.6} />
          <Path d={cells.map(([cx, cy]) => ellipseD(cx, cy - 1, 3.2, 2.2)).join('')} fill={K.cucumber} />
        </G>
      );
    }
    case 'zalabia':
      // Three crisp lattice rings glazed in syrup, piled on a plate.
      return (
        <G>
          <Plate p={p} cy={140} />
          {[
            [76, 128],
            [124, 130],
            [100, 106],
          ].map(([cx, cy]) => (
            <G key={`${cx}`}>
              <Path d={ellipseD(cx!, cy!, 26, 16)} fill="none" stroke={K.juice} strokeWidth={11} />
              <Path d={ellipseD(cx!, cy!, 26, 16)} fill="none" stroke={K.fried} strokeWidth={3} strokeDasharray="5 7" />
              <Ink d={ellipseD(cx!, cy!, 32, 21)} w={p.w * 0.7} />
              <Ink d={ellipseD(cx!, cy!, 20, 11)} w={p.w * 0.6} />
              <Path d={`M${cx! - 8} ${cy! - 2}q8 -8 16 0`} stroke={K.fried} strokeWidth={p.w * 0.8} fill="none" strokeLinecap="round" />
            </G>
          ))}
          <Path d="M58 116l3 2M138 118l3-2M96 92l3 1" stroke={K.white} strokeWidth={p.w * 0.9} strokeLinecap="round" opacity={0.7} />
        </G>
      );
    case 'kleicha':
      // Round stamped date cookies, one broken open to show the date filling.
      return (
        <G>
          <Plate p={p} cy={138} />
          {[
            [68, 124],
            [104, 112],
            [138, 128],
          ].map(([cx, cy]) => (
            <G key={`${cx}`}>
              <Shape d={ellipseD(cx!, cy!, 24, 14)} fill={K.bread} w={p.w * 0.8} />
              <Path d={ellipseD(cx!, cy!, 15, 8)} fill="none" stroke={K.fried} strokeWidth={p.w * 0.7} />
              <Path d={`M${cx! - 9} ${cy!}h18M${cx!} ${cy! - 6}v12M${cx! - 6} ${cy! - 4}l12 8M${cx! + 6} ${cy! - 4}l-12 8`} stroke={K.fried} strokeWidth={p.w * 0.55} strokeLinecap="round" />
            </G>
          ))}
          <G transform="translate(102 148)">
            <Shape d={ellipseD(0, 0, 22, 13)} fill={K.bread} w={p.w * 0.8} />
            <Path d="M0 0m-12 0a12 7 0 1 0 24 0a12 7 0 1 0 -24 0" fill="none" stroke={K.wood} strokeWidth={4.5} />
            <Path d={ellipseD(0, 0, 4, 2.4)} fill={K.wood} />
          </G>
          {p.garnish ? <Path d="M60 116h2M76 130h2M98 104h2M112 118h2M132 122h2M146 132h2" stroke={K.white} strokeWidth={p.w * 0.9} strokeLinecap="round" /> : null}
        </G>
      );
    case 'cake':
      // A slice of chocolate cake: two sponge layers with cream between and on top, a strawberry.
      return (
        <G>
          <Shadow cx={104} cy={160} rx={70} ry={14} />
          <Shape d={ellipseD(100, 152, 72, 18)} fill={p.plate} w={p.w} />
          <Shape d="M52 96L148 112L148 150L52 134Z" fill={K.char} w={p.w} />
          <Path d="M52 112L148 128" stroke={K.white} strokeWidth={8} />
          <Shape d="M52 96L96 70L176 84L148 112Z" fill={K.white} w={p.w} />
          <Shape d="M148 112L176 84L176 122L148 150Z" fill={K.char} w={p.w} opacity={0.85} />
          <Path d="M148 128L176 102" stroke={K.white} strokeWidth={7} />
          <Path d="M64 100q8 6 16 2q8 6 16 2q8 6 16 2q8 6 16 2" stroke={K.rim} strokeWidth={p.w * 0.7} fill="none" strokeLinecap="round" />
          <G transform="translate(118 74)">
            <Shape d="M-12 0Q-12 -16 0 -18Q12 -16 12 0Q6 12 0 14Q-6 12 -12 0Z" fill={K.tomato} w={p.w * 0.8} />
            <Path d="M-5 -16l5 -6l5 6" stroke={K.herb} strokeWidth={p.w} fill="none" strokeLinecap="round" />
            <Path d="M-4 -4h1M4 -2h1M0 4h1" stroke={K.onion} strokeWidth={p.w * 0.8} strokeLinecap="round" />
          </G>
        </G>
      );
    case 'dallah':
      // Arabic coffee: the brass dallah with its beak spout and a small finjan beside it.
      return (
        <G>
          <Shadow cx={100} cy={176} rx={76} ry={10} />
          <Shape d="M74 172Q70 150 82 132Q76 112 88 98L112 98Q124 112 118 132Q130 150 126 172Z" fill={K.saffron} w={p.w} />
          <Shape d="M88 98L84 84Q100 76 116 84L112 98Z" fill={K.bread} w={p.w} />
          <Shape d="M96 78Q100 62 104 78Z" fill={K.saffron} w={p.w * 0.8} />
          <Shape d="M84 106Q60 96 44 66Q40 60 46 60Q58 76 86 92Z" fill={K.saffron} w={p.w} />
          <Path d="M117 112Q134 112 134 130Q134 146 120 152" fill="none" stroke={K.line} strokeWidth={p.w * 1.3} strokeLinecap="round" />
          <Path d="M76 150Q100 158 124 150" stroke={K.fried} strokeWidth={p.w * 0.9} fill="none" strokeLinecap="round" />
          <Path d="M92 112L94 160" stroke={K.white} strokeWidth={p.w} strokeLinecap="round" opacity={0.6} />
          <G transform="translate(160 172)">
            <Shape d="M-16 -18L16 -18Q14 0 0 2Q-14 0 -16 -18Z" fill={K.white} w={p.w * 0.8} />
            <Path d="M-14 -10Q0 -6 14 -10" stroke={K.kashi} strokeWidth={p.w * 0.9} fill="none" />
            <Path d={ellipseD(0, -18, 16, 4)} fill={K.fried} />
          </G>
          <Steam x={44} y={54} h={26} w={p.w * 0.7} />
        </G>
      );
    case 'iced':
      // An iced latte: milk below, coffee clouding down into it, ice and a straw.
      return (
        <G>
          <Shadow cx={104} cy={178} rx={40} ry={8} />
          <Line x1={118} y1={20} x2={108} y2={120} stroke={K.kashi} strokeWidth={p.w * 1.8} strokeLinecap="round" />
          <Shape d={glassD(100, 46, 174, 70, 54)} fill={K.white} w={p.w} opacity={0.85} />
          <Path d={bandD(100, 46, 174, 70, 54, 104, 170)} fill={K.laban} />
          <Path d={bandD(100, 46, 174, 70, 54, 62, 108)} fill={K.fried} />
          <Path d="M70 106Q82 116 92 106Q104 118 116 106Q124 114 130 108" stroke={K.fried} strokeWidth={p.w * 1.6} fill="none" strokeLinecap="round" opacity={0.7} />
          <Cube p={p} x={86} y={72} rot={-12} />
          <Cube p={p} x={110} y={86} s={13} rot={18} />
          <Cube p={p} x={92} y={96} s={12} rot={6} />
          <Path d="M74 80L80 162" stroke={K.white} strokeWidth={p.w * 1.1} strokeLinecap="round" opacity={0.5} />
        </G>
      );
    case 'pomegranate':
      // Pomegranate juice: a red glass and half a pomegranate showing its seeds.
      return (
        <G>
          <Shadow cx={96} cy={176} rx={60} ry={9} />
          <Shape d={glassD(84, 54, 172, 64, 50)} fill={K.pomegranate} w={p.w} />
          <Path d="M62 80L68 160" stroke={K.white} strokeWidth={p.w * 1.1} strokeLinecap="round" opacity={0.4} />
          <G transform="translate(142 150)">
            <Shape d={circleD(0, 0, 28)} fill={K.pomegranate} w={p.w * 0.9} />
            <Path d={circleD(0, 0, 21)} fill={K.onion} />
            {[
              [-9, -8],
              [2, -12],
              [11, -4],
              [-12, 4],
              [-2, 2],
              [9, 8],
              [-4, 12],
              [4, -2],
            ].map(([x, y]) => (
              <Path key={`${x}${y}`} d={circleD(x!, y!, 3.6)} fill={K.tomato} />
            ))}
            <Path d="M-6 -27l6 -8l6 8" fill={K.pomegranate} stroke={K.line} strokeWidth={p.w * 0.6} />
          </G>
        </G>
      );
    case 'lemonade':
      // Lemon with mint: pale lemon over crushed ice, mint leaves and a slice on the rim.
      return (
        <G>
          <Shadow cx={104} cy={176} rx={42} ry={8} />
          <Shape d={glassD(100, 52, 172, 72, 56)} fill={K.lemon} w={p.w} opacity={0.9} />
          <Path d={bandD(100, 52, 172, 72, 56, 64, 100)} fill={K.cucumber} opacity={0.45} />
          <Cube p={p} x={86} y={84} s={12} rot={14} />
          <Cube p={p} x={112} y={92} s={11} rot={-10} />
          <Path d="M76 80L82 160" stroke={K.white} strokeWidth={p.w * 1.2} strokeLinecap="round" opacity={0.5} />
          <Mint p={p} x={84} y={56} s={0.9} />
          <G transform="translate(134 56) rotate(24)">
            <Shape d={circleD(0, 0, 15)} fill={K.lemon} w={p.w * 0.8} />
            <Path d={circleD(0, 0, 10)} fill={K.onion} />
            <Path d="M0-10L0 10M-10 0L10 0M-7-7L7 7M-7 7L7-7" stroke={K.lemon} strokeWidth={1.4} />
          </G>
        </G>
      );
    case 'bananamilk':
      // Banana with milk: a creamy glass and a banana leaning on it.
      return (
        <G>
          <Shadow cx={100} cy={176} rx={56} ry={9} />
          <Shape d={glassD(90, 52, 172, 70, 54)} fill={K.rice} w={p.w} />
          <Path d={`M58 60Q74 52 90 60Q106 68 122 60`} stroke={K.white} strokeWidth={p.w * 1.2} fill="none" strokeLinecap="round" />
          <Path d="M66 80L72 160" stroke={K.white} strokeWidth={p.w * 1.2} strokeLinecap="round" opacity={0.7} />
          <Shape d="M120 172Q156 160 162 108Q164 100 170 104Q174 150 132 178Q122 180 120 172Z" fill={K.lemon} w={p.w} />
          <Path d="M130 170Q158 154 164 116" stroke={K.lentil} strokeWidth={p.w * 0.7} fill="none" strokeLinecap="round" />
          <Path d="M166 102l4 -8" stroke={K.wood} strokeWidth={p.w * 1.2} strokeLinecap="round" />
        </G>
      );
    case 'cocktail':
      // The Iraqi «كوكتيل»: layers of mango, strawberry and banana under cream, a cherry on top.
      return (
        <G>
          <Shadow cx={104} cy={178} rx={42} ry={8} />
          <Shape d={glassD(100, 50, 174, 72, 56)} fill={K.white} w={p.w} opacity={0.85} />
          <Path d={bandD(100, 50, 174, 72, 56, 136, 170)} fill={K.juice} />
          <Path d={bandD(100, 50, 174, 72, 56, 102, 136)} fill={K.turnip} />
          <Path d={bandD(100, 50, 174, 72, 56, 74, 102)} fill={K.lemon} />
          <Shape d="M62 74Q64 50 84 52Q92 38 106 46Q122 40 128 56Q142 60 138 74Z" fill={K.laban} w={p.w * 0.9} />
          <Shape d={circleD(104, 40, 8)} fill={K.tomato} w={p.w * 0.7} />
          <Path d="M104 32q2 -10 10 -14" stroke={K.palmDeep} strokeWidth={p.w * 0.8} fill="none" strokeLinecap="round" />
          <Path d="M76 84L82 164" stroke={K.white} strokeWidth={p.w * 1.1} strokeLinecap="round" opacity={0.45} />
          {p.garnish ? <Path d="M88 60h4M110 54h4M120 64h4" stroke={K.cucumber} strokeWidth={p.w * 1.4} strokeLinecap="round" /> : null}
        </G>
      );
  }
}

export interface DishDrawingProps {
  kind: DishKind;
  /** 0 … DISH_LOOKS − 1: the plate tint and whether the garnish shows. */
  look?: number;
  /** Ink width in the 200-unit box (4 ≈ 2 px at a 96 px thumbnail; heroes use less). */
  line?: number;
  /** Draw the faint arch window behind the dish (thumbnails); heroes have their own backdrop. */
  window?: boolean;
  /** Degrees the dish turns on the table (a look of its own); the window stays upright. */
  tilt?: number;
}

/**
 * One dish in a 200 × 200 box centred on (100, 110), as an SVG group: place it inside an `<Svg>` (the
 * caller sets the size and the backdrop). Pure and memoised: nothing animates per frame.
 */
export const DishDrawing = memo(function DishDrawing({ kind, look = 0, line = 4, window = true, tilt = 0 }: DishDrawingProps) {
  const i = ((look % DISH_LOOKS) + DISH_LOOKS) % DISH_LOOKS;
  const p: Pen = { plate: K.plateTints[i] ?? K.plate, garnish: i !== 1, w: line };
  return (
    <G>
      {window ? <Path d={archPath(34, 14, 132, 176)} fill={K.wallDeep} opacity={0.32} /> : null}
      {tilt ? <G transform={`rotate(${tilt} 100 120)`}>{drawDish(kind, p)}</G> : drawDish(kind, p)}
    </G>
  );
});
