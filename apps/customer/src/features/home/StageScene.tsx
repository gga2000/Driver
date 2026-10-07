import type { ComponentProps, ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { Ink, Shape, SKETCH as K, Steam, circleD, ellipseD, useMotionPresets, useTheme } from '@driver/ui';
import type { LiveStage } from './live-card';

/** The picture's square (px, and its drawing units: one unit is one pixel). */
export const SCENE = 52;
const W = 1.4;

type Clock = SharedValue<number>;
type Box = readonly [x: number, y: number, w: number, h: number];
type MotionStyle = ComponentProps<typeof Animated.View>['style'];

/** A four-pointed sparkle in a 10 × 10 box (the night card's stars). */
const STAR_D = 'M5 0L6.1 3.9L10 5L6.1 6.1L5 10L3.9 6.1L0 5L3.9 3.9Z';

/**
 * The little moving picture at the head of the live-order card, one per stage (Ali, 2026-10-07:
 * "make each stage visually different"): the slip printing at the restaurant, the slip stamped with
 * the kitchen's yes, the pot on the fire, the bag ready with sparkles, the courier riding toward you;
 * for a ride, the pin calling for a driver, the car coming to the pin, the car on the road. Drawn in
 * the Aziziyah sketchbook (flat paint, the date-brown ink a little off its fill) on the stage's
 * plate. Each moves on home's ambient clock, so it stops off screen; the clock's first frame is a
 * complete still picture, which is what reduced motion shows. Decoration: the card says the stage.
 */
export function StageScene({ stage, clock, plate, arrived }: { stage: LiveStage; clock: Clock; plate: string; arrived: boolean }) {
  const theme = useTheme();
  // A vehicle faces where the bar runs: toward the door at the end of the line.
  const mirror = theme.isRTL && (stage === 'onTheWay' || stage === 'driverComing' || stage === 'onTrip');
  return (
    <View
      testID="home-active-scene"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: SCENE, height: SCENE, borderRadius: theme.radius.lg, backgroundColor: plate, overflow: 'hidden' }}
    >
      <Animated.View
        key={stage}
        entering={arrived ? FadeIn.duration(theme.motion.duration.base).delay(theme.motion.duration.slow) : undefined}
        style={[{ width: SCENE, height: SCENE }, mirror ? { transform: [{ scaleX: -1 }] } : null]}
      >
        {stage === 'sent' ? <SlipPrinting clock={clock} /> : null}
        {stage === 'accepted' ? <SlipStamped clock={clock} arrived={arrived} /> : null}
        {stage === 'cooking' ? <PotOnFire clock={clock} /> : null}
        {stage === 'ready' ? <BagReady clock={clock} /> : null}
        {stage === 'onTheWay' ? <CourierRiding clock={clock} /> : null}
        {stage === 'searching' ? <PinCalling clock={clock} /> : null}
        {stage === 'driverComing' ? <CarComing clock={clock} /> : null}
        {stage === 'onTrip' ? <CarOnTrip clock={clock} /> : null}
      </Animated.View>
    </View>
  );
}

/** One moving part: an SVG cut to `box` of the picture's square, so its transform turns and scales it about its own middle. */
function Part({ box, style, children }: { box: Box; style?: MotionStyle; children: ReactNode }) {
  const [x, y, w, h] = box;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: y, width: w, height: h }, style]}>
      <Svg width={w} height={h} viewBox={`${x} ${y} ${w} ${h}`}>
        {children}
      </Svg>
    </Animated.View>
  );
}

const FULL: Box = [0, 0, SCENE, SCENE];

/** Where in a loop of `period` seconds the clock is, 0–1, shifted by `at` (so the clock's 0 can land on a still moment). */
function phase(t: number, period: number, at = 0): number {
  'worklet';
  return (((t / period + at) % 1) + 1) % 1;
}

/** A smooth 0 → 1 → 0 hump over `p` from `from` to `to` (0 outside it). */
function hump(p: number, from: number, to: number): number {
  'worklet';
  if (p <= from || p >= to) return 0;
  return Math.sin(((p - from) / (to - from)) * Math.PI);
}

// ——— The restaurant's printer and the order slip (sent, accepted) ———

const SLIP_D = 'M15 12H37V41l-2.75 2.5-2.75-2.5-2.75 2.5-2.75-2.5-2.75 2.5-2.75-2.5-2.75 2.5-2.75-2.5Z';
const SLIP_LINES: readonly (readonly [number, number, number])[] = [
  [19, 19, 33],
  [19, 24, 30],
  [19, 29, 32],
  [19, 35, 24],
  [28, 35, 33],
];

function Slip() {
  return (
    <G>
      <Shape d={SLIP_D} fill={K.white} w={W} />
      {SLIP_LINES.map(([x1, y, x2]) => (
        <Path key={`${x1}-${y}`} d={`M${x1} ${y}H${x2}`} stroke={K.line} strokeWidth={1.6} strokeLinecap="round" opacity={0.5} />
      ))}
    </G>
  );
}

function Printer({ light }: { light?: MotionStyle }) {
  return (
    <>
      <Part box={[9, 6, 34, 10]}>
        <Rect x={10} y={7} width={32} height={8} rx={4} fill={K.line} />
        <Path d="M14 12H38" stroke={K.night} strokeWidth={1.6} strokeLinecap="round" />
      </Part>
      <Part box={[34, 8, 5, 5]} style={light}>
        <Circle cx={36.5} cy={10.5} r={1.7} fill={K.saffron} />
      </Part>
    </>
  );
}

/** Sent: the slip prints out of the restaurant's printer, its light blinking, then the next one. */
function SlipPrinting({ clock }: { clock: Clock }) {
  const PERIOD = 3.4;
  // Out in the first 30 % of the loop, hanging there till 86 %, then fading for the next. The clock's
  // 0 falls just as it is fully out.
  const slip = useAnimatedStyle(() => {
    const p = phase(clock.value, PERIOD, 0.3);
    const out = p < 0.3 ? 1 - (1 - p / 0.3) ** 2 : 1;
    const gone = p > 0.86 ? (p - 0.86) / 0.14 : 0;
    return { opacity: 1 - gone, transform: [{ translateY: -30 * (1 - out) }] };
  });
  const light = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * (phase(clock.value, 0.8) < 0.5 ? 1 : 0) }));
  return (
    <>
      {/* The slip slides out from under the printer's mouth. */}
      <View style={{ position: 'absolute', left: 0, top: 12, width: SCENE, height: SCENE - 12, overflow: 'hidden' }}>
        <Animated.View style={[{ position: 'absolute', left: 0, top: -12, width: SCENE, height: SCENE }, slip]}>
          <Svg width={SCENE} height={SCENE} viewBox={`0 0 ${SCENE} ${SCENE}`}>
            <Slip />
          </Svg>
        </Animated.View>
      </View>
      <Printer light={light} />
    </>
  );
}

/** Accepted: the slip hangs out, stamped with the kitchen's saffron yes; the stamp presses again now and then. */
function SlipStamped({ clock, arrived }: { clock: Clock; arrived: boolean }) {
  const theme = useTheme();
  const presets = useMotionPresets();
  const PERIOD = 3;
  const stamp = useAnimatedStyle(() => {
    const p = phase(clock.value, PERIOD);
    return { transform: [{ rotate: '-12deg' }, { scale: 1 + 0.12 * hump(p, 0, 0.12) }] };
  });
  const ring = useAnimatedStyle(() => {
    const p = phase(clock.value, PERIOD);
    const k = Math.min(1, p / 0.4);
    return { opacity: p < 0.4 ? 0.7 * (1 - k) : 0, transform: [{ scale: 1 + 0.9 * k }] };
  });
  return (
    <>
      <Part box={FULL}>
        <Slip />
      </Part>
      <Printer />
      <Part box={[19, 23, 26, 26]} style={ring}>
        <Circle cx={32} cy={36} r={10} fill="none" stroke={K.saffron} strokeWidth={2} />
      </Part>
      {/* The stamp lands (once, when the kitchen says yes), then presses again now and then. */}
      <Animated.View entering={arrived ? presets.pop(theme.motion.duration.deliberate) : undefined} style={{ position: 'absolute', left: 21, top: 25, width: 22, height: 22 }}>
        <Animated.View style={stamp}>
          <Svg width={22} height={22} viewBox="21 25 22 22">
            <Shape d={circleD(32, 36, 9)} fill={K.saffron} w={W} />
            <Circle cx={32} cy={36} r={6.4} fill="none" stroke={K.line} strokeWidth={1} opacity={0.45} />
            <Path d="M28.4 36.2l2.6 2.6 4.8-5.2" fill="none" stroke={K.line} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Animated.View>
      </Animated.View>
    </>
  );
}

// ——— Cooking: the pot on the fire ———

const FLAME_OUT = 'M19 47Q17 42 20 38Q21 41 23 40Q23 35 26 33Q29 36 29 40Q31 41 32 38Q35 42 33 47Z';
const FLAME_IN = 'M22.5 47Q21.5 44 23.5 42Q24.5 44 25.5 43Q26.5 40 27.5 42.5Q29.5 44 28.5 47Z';
const POT_D = 'M11 24H41V34Q41 39.5 35.5 39.5H16.5Q11 39.5 11 34Z';
const LID_D = 'M10 24.5Q26 13 42 24.5Z';

/** Cooking: the fire flickers under the pot, the lid rattles when it boils and steam curls up. */
function PotOnFire({ clock }: { clock: Clock }) {
  const flame = useAnimatedStyle(() => {
    const t = clock.value;
    const k = 1 + 0.1 * Math.sin(t * 9.1) + 0.06 * Math.sin(t * 14.3 + 1);
    // Scaled up from its base, not its middle: the box is 16 tall, so lift by half the growth.
    return { transform: [{ translateY: -8 * (k - 1) }, { scaleY: k }, { scaleX: 1 - 0.04 * Math.sin(t * 7.7) }] };
  });
  const lid = useAnimatedStyle(() => {
    const p = phase(clock.value, 2.6);
    const boil = hump(p, 0.55, 0.9);
    return { transform: [{ translateY: -1.6 * boil * Math.abs(Math.sin(clock.value * 28)) }, { rotate: `${4 * boil * Math.sin(clock.value * 31)}deg` }] };
  });
  return (
    <>
      <Part box={[16, 31, 20, 16]} style={flame}>
        <Path d={FLAME_OUT} fill={K.tomato} />
        <Path d={FLAME_IN} fill={K.saffron} />
      </Part>
      <Part box={[6, 36, 40, 12]}>
        <Path d="M12 46.5H40" stroke={K.line} strokeWidth={1.8} strokeLinecap="round" />
      </Part>
      <Part box={FULL}>
        <Path d="M7 27.5H11M41 27.5H45" stroke={K.line} strokeWidth={2.6} strokeLinecap="round" />
        <Shape d={POT_D} fill={K.metal} w={W} />
        <Path d="M11 28H41V30.5H11Z" fill={K.white} opacity={0.35} />
      </Part>
      <Part box={[8, 13, 36, 14]} style={lid}>
        <Shape d={LID_D} fill={K.metal} w={W} />
        <Shape d={circleD(26, 16, 2)} fill={K.line} w={1} ink={false} />
      </Part>
      <RisingSteam clock={clock} box={[18, 0, 10, 16]} x={21} h={12} w={1.8} at={0.35} />
      <RisingSteam clock={clock} box={[26, 0, 10, 16]} x={29} h={11} w={1.6} at={0.85} />
    </>
  );
}

/** A curl of steam that rises from the lid and fades, then the next. */
function RisingSteam({ clock, box, x, h, w, at }: { clock: Clock; box: Box; x: number; h: number; w: number; at: number }) {
  const style = useAnimatedStyle(() => {
    const p = phase(clock.value, 2.4, at);
    return { opacity: 0.9 * hump(p, 0, 1), transform: [{ translateY: -7 * p }] };
  });
  return (
    <Part box={box} style={style}>
      <Steam x={x} y={14} h={h} w={w} />
    </Part>
  );
}

// ——— Ready: the bag ———

const SPARKLES = [
  { x: 6, y: 9, size: 8, period: 2.2, at: 0.2 },
  { x: 40, y: 6, size: 6, period: 2.9, at: 0.65 },
  { x: 42, y: 28, size: 5, period: 3.4, at: 0.4 },
] as const;

/** Ready: the bag sits sealed with sparkles twinkling round it, and hops now and then as if to say "come get me". */
function BagReady({ clock }: { clock: Clock }) {
  const PERIOD = 2.6;
  const bag = useAnimatedStyle(() => {
    const p = phase(clock.value, PERIOD);
    const up = hump(p, 0, 0.22);
    const land = hump(p, 0.22, 0.32);
    return { transform: [{ translateY: -4 * up + 0.6 * land }, { scaleY: 1 - 0.05 * land }] };
  });
  const shadow = useAnimatedStyle(() => {
    const up = hump(phase(clock.value, PERIOD), 0, 0.22);
    return { opacity: 1 - 0.35 * up, transform: [{ scaleX: 1 - 0.25 * up }] };
  });
  return (
    <>
      <Part box={[12, 42, 28, 6]} style={shadow}>
        <Path d={ellipseD(26, 45, 13, 2.2)} fill={K.rim} />
      </Part>
      <Part box={[9, 6, 34, 40]} style={bag}>
        <Path d="M20 19Q20 10 26 10Q32 10 32 19" stroke={K.wood} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <Shape d="M14 19H38L40 44H12Z" fill={K.bread} w={W} />
        <Path d="M14 19H38L38.4 24H13.6Z" fill={K.fried} opacity={0.6} />
        {/* The kitchen's seal: saffron, ringed in ink on its own line (an off-register ring reads as ⊘ this small). */}
        <Circle cx={26} cy={33} r={5.6} fill={K.saffron} stroke={K.line} strokeWidth={1.1} />
        <Path d="M23.4 33.2l1.9 1.9 3.4-3.7" fill="none" stroke={K.line} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
      </Part>
      {SPARKLES.map((s, i) => (
        <Sparkle key={i} {...s} clock={clock} />
      ))}
    </>
  );
}

function Sparkle({ x, y, size, period, at, clock }: { x: number; y: number; size: number; period: number; at: number; clock: Clock }) {
  const twinkle = useAnimatedStyle(() => {
    const k = ((1 + Math.sin(2 * Math.PI * phase(clock.value, period, at))) / 2) ** 3;
    return { opacity: 0.3 + 0.7 * k, transform: [{ scale: 0.65 + 0.35 * k }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: x, top: y, width: size, height: size }, twinkle]}>
      <Svg width={size} height={size} viewBox="0 0 10 10">
        <Path d={STAR_D} fill={K.fried} />
      </Svg>
    </Animated.View>
  );
}

// ——— The road (on the way, a ride) ———

/** The road under a vehicle: its edge, and dashes that slide back as it rides on. */
function Road({ clock, y = 45, speed = 0.55 }: { clock: Clock; y?: number; speed?: number }) {
  const dashes = useAnimatedStyle(() => ({ transform: [{ translateX: -12 * phase(clock.value, speed) }] }));
  return (
    <>
      <Part box={[0, y - 2, SCENE, 4]}>
        <Path d={`M0 ${y}H${SCENE}`} stroke={K.line} strokeWidth={1.2} opacity={0.3} />
      </Part>
      <Part box={[0, y + 1, SCENE + 12, 4]} style={dashes}>
        {Array.from({ length: 6 }, (_, i) => (
          <Path key={i} d={`M${i * 12 + 2} ${y + 3}h6`} stroke={K.line} strokeWidth={1.4} strokeLinecap="round" opacity={0.35} />
        ))}
      </Part>
    </>
  );
}

/** Three short lines streaming behind a vehicle, each fading on its own beat. */
function SpeedLines({ clock, x, ys }: { clock: Clock; x: number; ys: readonly number[] }) {
  return (
    <>
      {ys.map((y, i) => (
        <SpeedLine key={y} clock={clock} x={x} y={y} at={i * 0.33} />
      ))}
    </>
  );
}

function SpeedLine({ clock, x, y, at }: { clock: Clock; x: number; y: number; at: number }) {
  const style = useAnimatedStyle(() => {
    const p = phase(clock.value, 0.9, at);
    return { opacity: 0.2 + 0.6 * hump(p, 0, 1), transform: [{ translateX: -3 * p }] };
  });
  return (
    <Part box={[x - 4, y - 2, 12, 4]} style={style}>
      <Path d={`M${x} ${y}h5`} stroke={K.line} strokeWidth={1.4} strokeLinecap="round" />
    </Part>
  );
}

/** A small bump as the wheels roll: up by `lift` px, twice a `period`. */
function useRoll(clock: Clock, period: number, lift: number) {
  return useAnimatedStyle(() => ({ transform: [{ translateY: -lift * Math.abs(Math.sin(Math.PI * 2 * phase(clock.value, period))) }] }));
}

// ——— On the way: the courier ———

/** On the way: the courier rides on his scooter, the food box on the back, the road running under him. */
function CourierRiding({ clock }: { clock: Clock }) {
  const roll = useRoll(clock, 0.7, 0.8);
  return (
    <>
      <Road clock={clock} />
      <SpeedLines clock={clock} x={3} ys={[21, 27, 33]} />
      <Part box={[6, 6, 42, 40]} style={roll}>
        {/* The food box on the back. */}
        <Shape d="M9 19H22V31H9Z" fill={K.juice} w={W} />
        <Path d="M9 22.5H22" stroke={K.line} strokeWidth={1} opacity={0.5} />
        {/* The rider: helmet, body and the arm to the handlebar. */}
        <Shape d="M21 33Q19.5 23 25 20Q29 18.5 31 22L35.5 25.5L34.2 27.4L29.5 25L28.5 33Z" fill={K.char} w={W} />
        <Shape d={circleD(27.5, 14.5, 4.6)} fill={K.saffron} w={W} />
        <Path d="M29.5 13.2H32.2" stroke={K.line} strokeWidth={1.4} strokeLinecap="round" />
        {/* The scooter: body, seat, front fork and handlebar. */}
        <Path d="M36.5 25L39.5 38" stroke={K.line} strokeWidth={2} strokeLinecap="round" />
        <Path d="M34.5 24.5H38" stroke={K.line} strokeWidth={2} strokeLinecap="round" />
        <Shape d="M12 33H30L34 30H38L40 35Q41 38 38 38.5H13Q10.5 38 12 33Z" fill={K.white} w={W} />
        <Path d="M18 33H27" stroke={K.line} strokeWidth={2.4} strokeLinecap="round" />
        <Wheel cx={15} cy={39.5} />
        <Wheel cx={38} cy={39.5} />
      </Part>
    </>
  );
}

function Wheel({ cx, cy, r = 4.4 }: { cx: number; cy: number; r?: number }) {
  return (
    <G>
      <Shape d={circleD(cx, cy, r)} fill={K.night} w={1} />
      <Circle cx={cx} cy={cy} r={r * 0.36} fill={K.metal} />
    </G>
  );
}

// ——— A ride: the pin and the car ———

const PIN_D = 'M0 0C-5.5 -6 -8 -9 -8 -13A8 8 0 0 1 8 -13C8 -9 5.5 -6 0 0Z';

/** The pick-up pin with its tip at (x, y). */
function Pin({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Path d={PIN_D} fill={K.juice} />
      <Ink d={PIN_D} w={W / s} />
      <Circle cx={0} cy={-13} r={3} fill={K.white} />
    </G>
  );
}

const CAR_D = 'M1 15Q0 10 4 9.5L9 8.8L13.5 3Q15 1 18 1H25Q28 1 29.5 3.5L33 8.6Q38 9.6 38 14V17H1Z';
const CAR_GLASS = 'M12.5 8.6L16.2 3.6H21V8.6ZM23 3.6H27.2L30.4 8.6H23Z';

/** A town car (a warm white Elantra-ish saloon with a saffron stripe), facing forward, 38 × 22, its top-left at (x, y). */
function Car({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${s})`}>
      <Path d={CAR_D} fill={K.white} />
      <Ink d={CAR_D} w={W / s} />
      <Path d={CAR_GLASS} fill={K.line} opacity={0.22} />
      <Path d="M1.5 12.5H37.5" stroke={K.juice} strokeWidth={2.2} />
      <Wheel cx={9} cy={17.5} r={4} />
      <Wheel cx={30} cy={17.5} r={4} />
    </G>
  );
}

/** Looking for a driver: rings go out from the pin like a call, and nearby cars blink as they hear it. */
function PinCalling({ clock }: { clock: Clock }) {
  const pin = useAnimatedStyle(() => ({ transform: [{ translateY: -1.5 * hump(phase(clock.value, 2.2, 0.3), 0, 0.25) }] }));
  return (
    <>
      <Part box={FULL}>
        <Path d="M0 18H52M0 41H52M15 0V52M38 0V52" stroke={K.rim} strokeWidth={3} />
      </Part>
      <CallRing clock={clock} at={0.3} />
      <CallRing clock={clock} at={0.8} />
      {[
        { x: 3, y: 12, at: 0.1 },
        { x: 40, y: 9, at: 0.45 },
        { x: 41, y: 43, at: 0.75 },
      ].map((c) => (
        <CarDot key={c.x} {...c} clock={clock} />
      ))}
      <Part box={[16, 12, 20, 26]} style={pin}>
        <Pin x={26} y={37} />
      </Part>
    </>
  );
}

/** One ring going out from the pin's tip and fading. */
function CallRing({ clock, at }: { clock: Clock; at: number }) {
  const style = useAnimatedStyle(() => {
    const p = phase(clock.value, 2.2, at);
    return { opacity: 0.75 * (1 - p), transform: [{ scale: 0.25 + 0.75 * p }] };
  });
  return (
    <Part box={[2, 26, 48, 22]} style={style}>
      <Path d={ellipseD(26, 37, 22, 9)} fill="none" stroke={K.juice} strokeWidth={1.6} />
    </Part>
  );
}

function CarDot({ x, y, at, clock }: { x: number; y: number; at: number; clock: Clock }) {
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * hump(phase(clock.value, 2.2, at), 0, 0.5) }));
  return (
    <Part box={[x, y, 9, 6]} style={style}>
      <Rect x={x + 0.5} y={y + 0.5} width={8} height={5} rx={2} fill={K.white} stroke={K.line} strokeWidth={1} />
    </Part>
  );
}

/** The driver coming: the car drives along with the road running under it, toward your pin just ahead. */
function CarComing({ clock }: { clock: Clock }) {
  const roll = useRoll(clock, 0.6, 0.6);
  const pin = useAnimatedStyle(() => ({ transform: [{ translateY: -2 * hump(phase(clock.value, 1.6), 0, 0.5) }] }));
  return (
    <>
      <Road clock={clock} y={44} speed={0.5} />
      <SpeedLines clock={clock} x={0} ys={[30, 36]} />
      <Part box={[3, 22, 34, 22]} style={roll}>
        <Car x={5} y={24} s={0.78} />
      </Part>
      <Part box={[36, 14, 16, 30]} style={pin}>
        <Pin x={44} y={41} s={0.7} />
      </Part>
    </>
  );
}

/** On the trip: the car rolls on while palms slide past behind it. */
function CarOnTrip({ clock }: { clock: Clock }) {
  const roll = useRoll(clock, 0.6, 0.6);
  const palms = useAnimatedStyle(() => ({ transform: [{ translateX: -SCENE * phase(clock.value, 4.2, 0.4) }] }));
  return (
    <>
      <Part box={[0, 0, SCENE * 2, 46]} style={palms}>
        {[10, 36, 62, 88].map((x, i) => (
          <PalmTree key={x} x={x} tall={i % 2 === 0} />
        ))}
      </Part>
      <Road clock={clock} y={44} speed={0.45} />
      <Part box={[5, 24, 44, 21]} style={roll}>
        <Car x={8} y={26} s={0.86} />
      </Part>
    </>
  );
}

/** A small date palm, its foot at (x, 44), in the far row (paler than the road). */
function PalmTree({ x, tall }: { x: number; tall: boolean }) {
  const top = tall ? 14 : 20;
  return (
    <G opacity={0.75}>
      <Path d={`M${x} 44Q${x + 1.5} ${(44 + top) / 2} ${x + 0.5} ${top}`} stroke={K.wood} strokeWidth={2.2} fill="none" strokeLinecap="round" />
      {[-1, 1].map((side) => (
        <G key={side}>
          <Path d={`M${x + 0.5} ${top}q${side * 4} -3 ${side * 8} 1q${side * -4} -1 ${side * -8} -1Z`} fill={K.palm} />
          <Path d={`M${x + 0.5} ${top}q${side * 3} -5 ${side * 6} -5q${side * -3} 2 ${side * -6} 5Z`} fill={K.palmDeep} />
        </G>
      ))}
    </G>
  );
}
