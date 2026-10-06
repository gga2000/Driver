import { Circle, G, Path, Rect } from 'react-native-svg';
import { archPath, circleD, ellipseD, Ink, Shadow, Shape, SKETCH as K } from './kit';

/**
 * Recurring props of the sketchbook scenes (town motifs from the design-system report S2-08): palms,
 * the shanasheel window, the garage minibus, the tuktuk with its canopy fringe, a car, a paper food bag,
 * the istikan. Each is drawn in its own small box and placed with `x`, `y` and `s` (scale).
 */

interface Place {
  x: number;
  y: number;
  s?: number;
  w: number;
}

const at = ({ x, y, s = 1 }: Place) => `translate(${x} ${y}) scale(${s})`;

/** A date palm, its foot at (x, y): a ringed, slightly curved trunk and six fronds. */
export function Palm(p: Place & { lean?: number }) {
  const lean = p.lean ?? 6;
  return (
    <G transform={at(p)}>
      <Shape d={`M-4 0Q${lean * 0.4 - 4} -40 ${lean - 3} -78L${lean + 3} -78Q${lean * 0.4 + 4} -40 4 0Z`} fill={K.wood} w={p.w / (p.s ?? 1)} />
      <Path d={`M-3 -14l7 -2M-2 -30l7 -2M${lean * 0.2 - 2} -46l7 -2M${lean * 0.4 - 1} -62l7 -2`} stroke={K.char} strokeWidth={1.6} opacity={0.5} />
      <G transform={`translate(${lean} -78)`}>
        <Path
          d="M0 0C-14-14-34-14-46 2C-32-6-16-4 0 0ZM0 0C-6-20-22-30-38-28C-22-22-10-12 0 0ZM0 0C4-20 0-34-10-42C-4-28-4-14 0 0ZM0 0C10-18 24-26 40-24C24-18 12-10 0 0ZM0 0C14-12 34-12 46 4C32-4 16-4 0 0ZM0 0C-12 6-22 18-24 30C-14 18-6 10 0 0Z"
          fill={K.palm}
        />
        <Ink d="M0 0C-14-14-34-14-46 2M0 0C4-20 0-34-10-42M0 0C14-12 34-12 46 4" w={p.w / (p.s ?? 1)} />
      </G>
    </G>
  );
}

/** A shanasheel window: a pointed arch with a wooden lattice; `lit` fills it with warm light. */
export function Shanasheel(p: Place & { width: number; height: number; lit?: boolean; dark?: boolean }) {
  const d = archPath(0, 0, p.width, p.height, 0.5);
  const fill = p.lit ? K.saffron : p.dark ? K.night : K.sky;
  let lattice = '';
  for (let x = p.width / 4; x < p.width; x += p.width / 4) lattice += `M${x} ${p.height * 0.18}V${p.height}`;
  for (let y = p.height * 0.45; y < p.height; y += p.height / 4) lattice += `M0 ${y}H${p.width}`;
  return (
    <G transform={at(p)}>
      <Path d={d} fill={fill} />
      <Path d={lattice} stroke={K.wood} strokeWidth={2} opacity={0.75} />
      <Ink d={d} w={p.w} />
      <Rect x={-4} y={p.height} width={p.width + 8} height={5} fill={K.wood} />
    </G>
  );
}

/** The white garage minibus of الرجعة with its kashi stripe, facing the start side, 112 × 52. */
export function Minibus(p: Place) {
  const w = p.w / (p.s ?? 1);
  const body = 'M16 0H104Q112 0 112 8V44H0V24Q2 8 16 0Z';
  return (
    <G transform={at(p)}>
      <Shadow cx={56} cy={50} rx={58} ry={5} />
      <Shape d={body} fill={K.white} w={w} />
      <Path d="M14 6H30V20H4Q6 10 14 6ZM36 6H54V20H36ZM60 6H78V20H60ZM84 6H104V20H84Z" fill={K.kashiTint} />
      <Rect x={0} y={27} width={112} height={5} fill={K.kashi} />
      <Path d="M58 22V44" stroke={K.rim} strokeWidth={1.6} />
      <Rect x={2} y={34} width={8} height={4} rx={1} fill={K.saffron} />
      {[24, 90].map((cx) => (
        <G key={cx}>
          <Shape d={circleD(cx, 44, 9)} fill={K.night} w={w} />
          <Circle cx={cx} cy={44} r={3.5} fill={K.metal} />
        </G>
      ))}
    </G>
  );
}

/** A tuktuk with its fringed canopy (تكتك), facing the start side, 88 × 56. */
export function Tuktuk(p: Place) {
  const w = p.w / (p.s ?? 1);
  let fringe = 'M10 10';
  for (let i = 0; i < 12; i++) fringe += `l3 5l3-5`;
  return (
    <G transform={at(p)}>
      <Shadow cx={46} cy={54} rx={44} ry={4} />
      <Path d="M14 10V30M78 10V30" stroke={K.char} strokeWidth={3} />
      <Shape d="M6 2H84Q86 2 86 6V10H6Z" fill={K.saffron} w={w} />
      <Path d={fringe} stroke={K.pomegranate} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
      <Shape d="M0 46Q0 28 16 28H84V46Z" fill={K.pomegranate} w={w} />
      <Path d="M4 36H22" stroke={K.white} strokeWidth={2} strokeLinecap="round" />
      <Shape d="M52 16H76V28H52Z" fill={K.char} w={w} opacity={0.85} />
      {[14, 72].map((cx) => (
        <G key={cx}>
          <Shape d={circleD(cx, 47, 8)} fill={K.night} w={w} />
          <Circle cx={cx} cy={47} r={3} fill={K.metal} />
        </G>
      ))}
    </G>
  );
}

/** A small saloon car (taxi), facing the start side, 96 × 40. */
export function Car(p: Place) {
  const w = p.w / (p.s ?? 1);
  return (
    <G transform={at(p)}>
      <Shadow cx={48} cy={38} rx={50} ry={4} />
      <Shape d="M2 30Q0 20 10 18L24 16L34 4Q38 0 46 0H66Q74 0 78 6L86 16Q96 18 96 28V32H2Z" fill={K.white} w={w} />
      <Path d="M30 16L38 6H54V16ZM58 6H70L78 16H58Z" fill={K.kashiTint} />
      <Rect x={2} y={22} width={94} height={4} fill={K.kashi} />
      {[22, 76].map((cx) => (
        <G key={cx}>
          <Shape d={circleD(cx, 32, 8)} fill={K.night} w={w} />
          <Circle cx={cx} cy={32} r={3} fill={K.metal} />
        </G>
      ))}
    </G>
  );
}

/** A paper food bag with a folded top and a twine handle (no logo: J4 honesty rule), 40 × 46. */
export function FoodBag(p: Place) {
  const w = p.w / (p.s ?? 1);
  return (
    <G transform={at(p)}>
      <Shadow cx={22} cy={46} rx={22} ry={3.5} />
      <Path d="M12 6Q12 -6 20 -6Q28 -6 28 6" stroke={K.wood} strokeWidth={2.4} fill="none" />
      <Shape d="M2 8H38L40 46H0Z" fill={K.bread} w={w} />
      <Path d="M2 8H38L38 14H2Z" fill={K.fried} opacity={0.6} />
      <Path d={circleD(20, 28, 6)} fill={K.saffron} />
    </G>
  );
}

/** An istikan of tea on its saucer, 30 × 40. */
export function Istikan(p: Place) {
  const w = p.w / (p.s ?? 1);
  return (
    <G transform={at(p)}>
      <Shape d={ellipseD(15, 38, 16, 4)} fill={K.plate} w={w} />
      <Shape d="M6 4Q4 16 10 20Q4 26 8 36H22Q26 26 20 20Q26 16 24 4Z" fill={K.white} w={w} />
      <Path d="M7 10Q6 17 11 20Q6 26 9 34H21Q24 26 19 20Q24 17 23 10Z" fill={K.tea} />
      <Path d="M6 4H24" stroke={K.saffron} strokeWidth={1.6} />
    </G>
  );
}
