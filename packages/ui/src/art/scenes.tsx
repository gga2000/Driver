import type { ReactElement } from 'react';
import { G, Path, Rect } from 'react-native-svg';
import { archPath, circleD, ellipseD, Grain, Ink, Shadow, Shape, SKETCH as K, Steam } from './kit';
import { Car, FoodBag, Istikan, Minibus, Palm, Shanasheel, Tuktuk } from './props';

/**
 * The scenes of the Aziziyah sketchbook (joy J4; design-system S2-08 / S2-12), each drawn in a 320 × 200
 * box that `SketchScene` clips to an arch. `w` is the ink width. The kitchen's steam is not here: the
 * scene component draws it on its own layer so it can drift without redrawing the kitchen.
 */

export type SceneVehicle = 'minibus' | 'tuktuk' | 'car';

/** Where the kitchen pot's steam rises from (the animated layer sits here). */
export const KITCHEN_STEAM = { x: 176, y: 84 } as const;

function Wall({ fill = K.wall }: { fill?: string }) {
  return <Rect x={0} y={0} width={320} height={200} fill={fill} />;
}

/** A floor from `y` down, with a few tile joints. */
function Floor({ y, fill = K.wallDeep, joints = true }: { y: number; fill?: string; joints?: boolean }) {
  return (
    <G>
      <Rect x={0} y={y} width={320} height={200 - y} fill={fill} />
      {joints ? <Path d={`M0 ${y + 18}H320M40 ${y}L24 200M120 ${y}L116 200M200 ${y}L204 200M280 ${y}L296 200`} stroke={K.rim} strokeWidth={1.4} /> : null}
      <Path d={`M0 ${y}H320`} stroke={K.line} strokeWidth={1.6} opacity={0.5} />
    </G>
  );
}

/** A row of kashi tiles: a band with diamonds. */
function KashiBand({ y, h = 20 }: { y: number; h?: number }) {
  let diamonds = '';
  for (let x = 10; x < 320; x += 24) diamonds += `M${x} ${y + h / 2}l8 -${h / 2 - 3}l8 ${h / 2 - 3}l-8 ${h / 2 - 3}Z`;
  return (
    <G>
      <Rect x={0} y={y} width={320} height={h} fill={K.kashiTint} />
      <Path d={diamonds} fill={K.kashi} />
      <Path d={`M0 ${y}H320M0 ${y + h}H320`} stroke={K.kashi} strokeWidth={1.6} />
    </G>
  );
}

function Sky({ fill = K.sky }: { fill?: string }) {
  return <Rect x={0} y={0} width={320} height={200} fill={fill} />;
}

/** The Tigris: a wide curve across the lower part with two ripples. */
function Tigris({ y = 132 }: { y?: number }) {
  const d = `M0 ${y}C70 ${y - 18} 130 ${y + 22} 200 ${y + 4}C250 ${y - 8} 290 ${y - 6} 320 ${y - 2}L320 ${y + 36}C280 ${y + 30} 240 ${y + 38} 190 ${y + 44}C120 ${y + 52} 60 ${y + 24} 0 ${y + 40}Z`;
  return (
    <G>
      <Path d={d} fill={K.river} />
      <Path d={`M40 ${y + 18}q14 -4 28 0M150 ${y + 26}q14 -4 28 0M240 ${y + 16}q12 -4 24 0`} stroke={K.white} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.8} />
      <Path d={`M0 ${y}C70 ${y - 18} 130 ${y + 22} 200 ${y + 4}C250 ${y - 8} 290 ${y - 6} 320 ${y - 2}`} stroke={K.line} strokeWidth={1.6} fill="none" opacity={0.6} />
    </G>
  );
}

/** The market skyline: low roofs, arches and one dome. `dark` for the night scene. */
function Market({ y, dark, lit }: { y: number; dark?: boolean; lit?: boolean }) {
  const fill = dark ? K.night : K.wallDeep;
  const d = `M0 ${y}H40V${y - 22}H78V${y - 10}H96V${y - 30}Q112 ${y - 58} 128 ${y - 30}V${y - 14}H168V${y - 26}H214V${y - 8}H250V${y - 34}H290V${y - 16}H320V200H0Z`;
  return (
    <G>
      <Path d={d} fill={fill} />
      <Ink d={`M0 ${y}H40V${y - 22}H78V${y - 10}H96V${y - 30}Q112 ${y - 58} 128 ${y - 30}V${y - 14}H168V${y - 26}H214V${y - 8}H250V${y - 34}H290V${y - 16}H320`} w={1.8} opacity={dark ? 0.9 : 0.6} />
      {[16, 136, 176, 258].map((x, i) => (
        <G key={x}>
          <Path d={archPath(x, y - 2, 20, 26, 0.5)} fill={lit && i === 2 ? K.saffron : dark ? K.char : K.wall} />
          {!(lit && i === 2) ? <Path d={`M${x + 2} ${y + 12}H${x + 18}M${x + 2} ${y + 17}H${x + 18}M${x + 2} ${y + 22}H${x + 18}`} stroke={dark ? K.metal : K.rim} strokeWidth={1.4} opacity={0.6} /> : null}
        </G>
      ))}
    </G>
  );
}

/* ───────────────────────── food scenes ───────────────────────── */

function kitchen(w: number): ReactElement {
  return (
    <G>
      <Wall />
      <Grain w={320} h={200} />
      <KashiBand y={96} />
      <Shanasheel x={34} y={22} width={50} height={62} w={w} lit />
      <Path d="M262 20V52" stroke={K.metal} strokeWidth={2.4} />
      <Shape d={`M262 52q-12 6 0 16q12-10 0-16Z`} fill={K.metal} w={w} />
      <Rect x={0} y={140} width={320} height={60} fill={K.woodLight} />
      <Path d="M0 140H320" stroke={K.wood} strokeWidth={6} />
      <Ink d="M0 137H320" w={w} />
      <Path d="M0 166H320" stroke={K.wood} strokeWidth={1.6} opacity={0.5} />
      <Path d={ellipseD(176, 138, 44, 6)} fill={K.night} />
      <Path d="M150 134q4-10 8 0M170 134q4-12 8 0M190 134q4-10 8 0" fill={K.saffron} stroke={K.tomato} strokeWidth={1.2} />
      <Shape d="M130 86H222L216 128Q176 140 136 128Z" fill={K.metal} w={w} />
      <Path d="M132 100H220" stroke={K.rim} strokeWidth={4} />
      <Path d="M130 92q-12 0-12 10M222 92q12 0 12 10" stroke={K.line} strokeWidth={w} fill="none" strokeLinecap="round" />
      <Shape d={ellipseD(176, 86, 48, 8)} fill={K.metal} w={w} />
      <Shape d={circleD(176, 76, 5)} fill={K.char} w={w} />
      <Shape d="M40 112H104L98 140H46Z" fill={K.wood} w={w} />
      <Path d="M44 120H100M46 130H98" stroke={K.woodLight} strokeWidth={1.6} />
      <G transform="translate(60 108) rotate(-10)">
        <Shape d="M-18 0Q-8-10 0-10Q8-10 18 0Q8 8 0 8Q-8 8-18 0Z" fill={K.bread} w={w} />
      </G>
      <G transform="translate(86 106) rotate(12)">
        <Shape d="M-18 0Q-8-10 0-10Q8-10 18 0Q8 8 0 8Q-8 8-18 0Z" fill={K.bread} w={w} />
      </G>
      <Istikan x={264} y={100} s={0.95} w={w} />
    </G>
  );
}

/** The kitchen's steam layer (drawn separately so it can drift). */
export function KitchenSteam({ w }: { w: number }) {
  return (
    <G>
      <Steam x={KITCHEN_STEAM.x - 16} y={KITCHEN_STEAM.y - 6} h={40} w={w * 1.2} />
      <Steam x={KITCHEN_STEAM.x + 14} y={KITCHEN_STEAM.y - 10} h={34} w={w * 1.2} />
    </G>
  );
}

function Chair({ x, flip, w }: { x: number; flip?: boolean; w: number }) {
  return (
    <G transform={flip ? `translate(${x * 2 + 40} 0) scale(-1 1)` : undefined}>
      <Shape d={`M${x} 76H${x + 8}V176H${x}Z`} fill={K.wood} w={w} />
      <Shape d={`M${x} 128H${x + 40}V136H${x}Z`} fill={K.woodLight} w={w} />
      <Path d={`M${x + 36} 136V176M${x + 4} 92H${x + 4}`} stroke={K.wood} strokeWidth={5} strokeLinecap="round" />
      <Path d={`M${x + 2} 92H${x + 6}M${x + 2} 108H${x + 6}`} stroke={K.woodLight} strokeWidth={3} />
    </G>
  );
}

function rejected(w: number): ReactElement {
  return (
    <G>
      <Wall />
      <Grain w={320} h={200} />
      <Shanasheel x={136} y={20} width={48} height={60} w={w} />
      <Floor y={164} />
      <Path d="M246 18V40" stroke={K.metal} strokeWidth={2} />
      <Shape d="M232 52Q234 40 246 40Q258 40 260 52Z" fill={K.metal} w={w} />
      <Chair x={50} w={w} />
      <Chair x={230} flip w={w} />
      <Shadow cx={160} cy={176} rx={70} ry={6} />
      <Path d="M112 112V174M208 112V174" stroke={K.wood} strokeWidth={6} strokeLinecap="round" />
      <Shape d="M96 104H224L230 132H90Z" fill={K.white} w={w} />
      <Path d="M108 104L104 132M128 104L126 132M148 104L148 132M168 104L170 132M188 104L192 132M208 104L214 132" stroke={K.kashiTint} strokeWidth={3} />
      <Path d="M92 118H228" stroke={K.kashiTint} strokeWidth={3} />
      <Shape d={ellipseD(146, 100, 24, 6)} fill={K.plate} w={w} />
      <Path d={ellipseD(146, 100, 15, 3.5)} fill="none" stroke={K.rim} strokeWidth={1.6} />
      <Shape d="M182 100L180 84H196L194 100Z" fill={K.white} w={w} />
    </G>
  );
}

function emptyCart(w: number): ReactElement {
  let awning = '';
  for (let x = 0; x < 320; x += 40) awning += `M${x} 0H${x + 20}V30Q${x + 10} 38 ${x} 30Z`;
  return (
    <G>
      <Wall />
      <Grain w={320} h={200} />
      <Path d={awning} fill={K.kashi} />
      <Path d="M0 30Q10 38 20 30Q30 38 40 30Q50 38 60 30Q70 38 80 30Q90 38 100 30Q110 38 120 30Q130 38 140 30Q150 38 160 30Q170 38 180 30Q190 38 200 30Q210 38 220 30Q230 38 240 30Q250 38 260 30Q270 38 280 30Q290 38 300 30Q310 38 320 30" stroke={K.line} strokeWidth={1.6} fill="none" opacity={0.6} />
      <Floor y={150} />
      <Shadow cx={164} cy={168} rx={62} ry={8} />
      <Path d="M118 104Q116 52 160 50Q204 52 202 104" stroke={K.wood} strokeWidth={6} fill="none" strokeLinecap="round" />
      <Ink d="M118 104Q116 52 160 50Q204 52 202 104" w={w} />
      <Shape d="M104 100H216L204 166H116Z" fill={K.woodLight} w={w} />
      <Path d="M108 116H212M110 132H210M113 148H207M128 100L132 166M152 100L154 166M176 100L174 166M198 100L192 166" stroke={K.wood} strokeWidth={2} opacity={0.75} />
      <Shape d={ellipseD(160, 100, 56, 8)} fill={K.char} w={w} />
      <G transform="translate(252 170) rotate(-24)">
        <Path d="M0 0c-8-6-18-4-20 4c8 3 15 2 20-4Z" fill={K.herb} />
      </G>
    </G>
  );
}

function emptyOrders(w: number): ReactElement {
  return (
    <G>
      <Wall />
      <Grain w={320} h={200} />
      <Shanasheel x={124} y={14} width={72} height={84} w={w} />
      <Floor y={150} joints={false} />
      <Shape d="M60 128H260V140H60Z" fill={K.wood} w={w} />
      <Path d="M76 140V176M244 140V176" stroke={K.wood} strokeWidth={7} strokeLinecap="round" />
      <Shape d={ellipseD(160, 124, 82, 12)} fill={K.metal} w={w} />
      <Path d={ellipseD(160, 123, 74, 9)} fill={K.rim} />
      <Shape d={ellipseD(140, 120, 34, 8)} fill={K.plate} w={w} />
      <Path d={ellipseD(140, 120, 22, 4.5)} fill="none" stroke={K.rim} strokeWidth={1.6} />
      <Istikan x={190} y={88} s={0.95} w={w} />
      <Steam x={205} y={84} h={22} w={w} />
    </G>
  );
}

function door(w: number): ReactElement {
  return (
    <G>
      <Wall />
      <Path d="M0 30H320M0 60H320M0 90H320M0 120H320M0 150H320M40 0V30M120 30V60M260 0V30M30 60V90M290 60V90M20 120V150M300 120V150M70 150V180M250 150V180" stroke={K.wallDeep} strokeWidth={2} />
      <Floor y={168} joints={false} />
      <Path d={archPath(92, 18, 136, 154, 0.32)} fill={K.wallDeep} />
      <Ink d={archPath(92, 18, 136, 154, 0.32)} w={w} />
      <Path d={archPath(104, 30, 112, 142, 0.3)} fill={K.saffron} />
      <Shape d="M104 172V64Q104 36 160 30V172Z" fill={K.door} w={w} />
      <Path d="M116 80H148V120H116ZM116 132H148V164H116Z" fill={K.doorDeep} />
      <Shape d="M178 172V34Q196 40 204 54V176Z" fill={K.door} w={w} />
      <Path d="M184 70L198 76V116L184 112ZM184 128L198 130V164L184 164Z" fill={K.doorDeep} />
      <Path d={ellipseD(152, 124, 5, 6)} fill="none" stroke={K.saffron} strokeWidth={2.6} />
      <Shape d="M80 172H240V184H80Z" fill={K.wallDeep} w={w} />
      <FoodBag x={164} y={130} w={w} />
      <Shape d="M258 150H286L282 178H262Z" fill={K.tea} w={w} />
      <Path d="M272 150C262 130 248 128 240 132C252 134 262 140 272 150ZM272 150C272 128 280 116 292 112C284 124 278 136 272 150ZM272 150C284 136 298 134 306 140C294 140 282 144 272 150Z" fill={K.palm} />
    </G>
  );
}

function doorbell(w: number): ReactElement {
  return (
    <G>
      <Wall />
      <Path d="M0 40H180M0 80H180M0 120H180M0 160H180M60 0V40M120 40V80M40 80V120M100 120V160M150 160V200" stroke={K.wallDeep} strokeWidth={2} />
      <Shape d="M180 0H320V200H180Z" fill={K.door} w={w} />
      <Path d="M200 30H300V100H200ZM200 116H300V184H200Z" fill={K.doorDeep} />
      <Path d={circleD(212, 108, 6)} fill="none" stroke={K.saffron} strokeWidth={3} />
      <Path d="M116 20V34" stroke={K.metal} strokeWidth={2.4} />
      <Shape d="M102 34H130L126 52H106Z" fill={K.saffron} w={w} />
      <Path d={ellipseD(116, 70, 30, 16)} fill={K.saffron} opacity={0.18} />
      <Shape d="M96 84H136Q140 84 140 88V140Q140 144 136 144H96Q92 144 92 140V88Q92 84 96 84Z" fill={K.metal} w={w} />
      <Shape d={circleD(116, 112, 12)} fill={K.saffron} w={w} />
      <Path d={circleD(116, 112, 5)} fill={K.white} opacity={0.6} />
      <Path d="M76 96Q66 112 76 128M62 88Q46 112 62 136M156 96Q166 112 156 128M170 88Q186 112 170 136" stroke={K.line} strokeWidth={w} fill="none" strokeLinecap="round" />
    </G>
  );
}

/* ───────────────────────── town scenes ───────────────────────── */

function offline(w: number): ReactElement {
  return (
    <G>
      <Sky />
      <Grain w={320} h={200} />
      <Rect x={0} y={118} width={320} height={82} fill={K.wallDeep} />
      <Tigris y={136} />
      <Palm x={60} y={128} s={0.9} w={w} lean={-6} />
      <Palm x={92} y={132} s={0.7} w={w} lean={8} />
      <G>
        <Path d="M232 128L246 40L260 128M236 104H256M240 80H252M243 60H249M236 104L252 80M256 104L240 80" stroke={K.metal} strokeWidth={3} fill="none" strokeLinejoin="round" />
        <Ink d="M232 128L246 40L260 128" w={w} />
        <Path d={circleD(246, 38, 4)} fill={K.pomegranate} />
        <Path d="M232 30Q226 38 232 46M224 24Q214 38 224 52M260 30Q266 38 260 46M268 24Q278 38 268 52" stroke={K.metal} strokeWidth={w} fill="none" strokeLinecap="round" opacity={0.7} />
        <Path d="M222 20L270 58" stroke={K.pomegranate} strokeWidth={w * 1.6} strokeLinecap="round" />
      </G>
    </G>
  );
}

function night(w: number): ReactElement {
  return (
    <G>
      <Sky fill={K.nightSky} />
      <Path d="M220 36A26 26 0 1 0 252 74A20 20 0 1 1 220 36Z" fill={K.saffron} />
      <Ink d="M220 36A26 26 0 1 0 252 74A20 20 0 1 1 220 36Z" w={w} />
      {[
        [60, 34],
        [112, 22],
        [150, 52],
        [286, 30],
        [94, 62],
        [190, 20],
      ].map(([x, y]) => (
        <Path key={x} d={`M${x} ${y! - 4}L${x! + 1.4} ${y! - 1.4}L${x! + 4} ${y}L${x! + 1.4} ${y! + 1.4}L${x} ${y! + 4}L${x! - 1.4} ${y! + 1.4}L${x! - 4} ${y}L${x! - 1.4} ${y! - 1.4}Z`} fill={K.saffron} opacity={0.85} />
      ))}
      <Market y={150} dark lit />
      <Rect x={0} y={176} width={320} height={24} fill={K.night} />
      <Path d="M0 176H320" stroke={K.metal} strokeWidth={1.4} opacity={0.5} />
    </G>
  );
}

function SafeVehicle({ vehicle, w }: { vehicle: SceneVehicle; w: number }) {
  if (vehicle === 'tuktuk') return <Tuktuk x={116} y={118} s={1.05} w={w} />;
  if (vehicle === 'car') return <Car x={110} y={128} s={1.05} w={w} />;
  return <Minibus x={98} y={112} s={1.1} w={w} />;
}

function safeArrival(w: number, vehicle: SceneVehicle): ReactElement {
  return (
    <G>
      <Sky />
      <Path d={circleD(250, 96, 30)} fill={K.saffron} />
      <Market y={118} />
      <Rect x={0} y={150} width={320} height={50} fill={K.wallDeep} />
      <Path d="M70 200L136 150H184L250 200Z" fill={K.rim} />
      <Path d="M160 158V166M160 176V188" stroke={K.white} strokeWidth={3} strokeLinecap="round" />
      <Palm x={40} y={174} s={1.05} w={w} lean={-8} />
      <Palm x={286} y={176} s={1.1} w={w} lean={6} />
      <SafeVehicle vehicle={vehicle} w={w} />
    </G>
  );
}

function welcome(w: number): ReactElement {
  return (
    <G>
      <Sky />
      <Path d={circleD(70, 50, 22)} fill={K.saffron} />
      <Market y={104} />
      <Rect x={0} y={104} width={320} height={96} fill={K.wallDeep} />
      <Tigris y={144} />
      <Path d="M0 128H320" stroke={K.rim} strokeWidth={10} />
      <Palm x={34} y={150} s={0.85} w={w} lean={-6} />
      <Palm x={292} y={152} s={0.95} w={w} lean={6} />
      <Palm x={262} y={146} s={0.65} w={w} lean={-4} />
      <Tuktuk x={66} y={98} s={0.6} w={w} />
      <Minibus x={170} y={96} s={0.58} w={w} />
    </G>
  );
}

export const SCENE_NAMES = ['kitchen', 'rejected', 'empty_cart', 'empty_orders', 'door', 'doorbell', 'offline', 'night', 'safe_arrival', 'welcome'] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

/** The scene's drawing (without frame or steam). */
export function drawScene(name: SceneName, w: number, vehicle: SceneVehicle = 'minibus'): ReactElement {
  switch (name) {
    case 'kitchen':
      return kitchen(w);
    case 'rejected':
      return rejected(w);
    case 'empty_cart':
      return emptyCart(w);
    case 'empty_orders':
      return emptyOrders(w);
    case 'door':
      return door(w);
    case 'doorbell':
      return doorbell(w);
    case 'offline':
      return offline(w);
    case 'night':
      return night(w);
    case 'safe_arrival':
      return safeArrival(w, vehicle);
    case 'welcome':
      return welcome(w);
  }
}
