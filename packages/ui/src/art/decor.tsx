import { memo, useEffect, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { skyHour } from '../logic/sky';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Date & Saffron decoration (Ali, 2026-10-06; v3 artifact): the warm dot halo behind the service
 * tiles, the food tile's saffron gradient, the trips tiles' date brown and gold with the Iraqi star
 * lines, the hour's sky at the top of home and the paper grain. All of it is drawn with
 * react-native-svg (no image files), still but for the food tile's slow drift, never takes a touch, and
 * no text relies on it: every title passes AA on every stop of the fill under it (tested in tokens).
 */

/** A gradient/pattern id unique in the document (the web shares one id space across every SVG). */
function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

const fill = StyleSheet.absoluteFill;

/**
 * Dots on a 10 px grid with a warm glow in the middle, fading into the page at the edges, so the
 * tiles above it sit on something. Place it absolutely behind the group, a little larger than it.
 */
export const DotHalo = memo(function DotHalo({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const d = theme.decor;
  const id = useSvgId('halo');
  return (
    <View pointerEvents="none" style={[fill, style]} testID="dot-halo">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={`${id}d`} patternUnits="userSpaceOnUse" width={10} height={10}>
            <Circle cx={5} cy={5} r={1.1} fill={d.haloDot} />
          </Pattern>
          <RadialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={d.haloGlow} stopOpacity={0.32} />
            <Stop offset="1" stopColor={d.haloGlow} stopOpacity={0} />
          </RadialGradient>
          {/* In bounding-box units the circle stretches with the box: an oval that fades out at the edges. */}
          <RadialGradient id={`${id}f`} cx="50%" cy="50%" r="50%">
            <Stop offset="0.4" stopColor="#FFFFFF" stopOpacity={1} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <Mask id={`${id}m`}>
            <Rect width="100%" height="100%" fill={`url(#${id}f)`} />
          </Mask>
        </Defs>
        <G mask={`url(#${id}m)`}>
          <Rect width="100%" height="100%" fill={`url(#${id}d)`} />
          <Rect width="100%" height="100%" fill={`url(#${id}g)`} />
        </G>
      </Svg>
    </View>
  );
});

/**
 * Seconds of ambient drift (Ali's Yes, home effects "mesh", 2026-10-07): a clock on the UI thread
 * that only advances while `running`, so whatever it moves stops where it is (off screen, another
 * screen on top, the app in the background) and carries on from there. Under reduced motion it never
 * runs and its drawings stay still.
 */
export function useDriftClock(running: boolean): SharedValue<number> {
  const theme = useTheme();
  const t = useSharedValue(0);
  const frame = useFrameCallback((f) => {
    // A long gap (a dropped frame, a resume) is one ordinary step, never a jump.
    t.value += Math.min(0.05, (f.timeSincePreviousFrame ?? 0) / 1000);
  }, false);
  const on = running && !theme.reduceMotion;
  useEffect(() => {
    frame.setActive(on);
    return () => frame.setActive(false);
  }, [on, frame]);
  return t;
}

/** How far a glow's layer reaches past the tile on each side, as a share of it (covers the drift). */
const GLOW_PAD = 0.3;
/** The food tile's three glows: where each sits (share of the tile), how big, and its slow path. */
const GLOWS = [
  // light in the top corner
  { cx: 0.2, cy: 0.12, r: 0.7, stop: 0.6, dx: 22, dy: 16, px: 20, py: 15 },
  // warm on the side
  { cx: 0.88, cy: 0.32, r: 0.7, stop: 0.6, dx: 16, dy: 22, px: 15, py: 12 },
  // deep at the bottom
  { cx: 0.45, cy: 1, r: 0.8, stop: 0.7, dx: 24, dy: 12, px: 12, py: 20 },
] as const;

/**
 * A fill with three soft glows over it (a "mesh" gradient): light in the top corner, warm on the
 * side, deep at the bottom. The food tile's saffron. With a `clock` (`useDriftClock`) each glow
 * wanders on its own slow loop (12–20 s, never in step with the others), so the saffron seems to
 * breathe; the colours stay the tested ones, only where they sit moves. Without one it is still.
 */
export const MeshFill = memo(function MeshFill({ base, mesh, clock }: { base: string; mesh: readonly [string, string, string]; clock?: SharedValue<number> }) {
  return (
    <View pointerEvents="none" style={[fill, { backgroundColor: base }]}>
      {GLOWS.map((g, i) => (
        <Glow key={i} color={mesh[i]!} g={g} clock={clock} />
      ))}
    </View>
  );
});

function Glow({ color, g, clock }: { color: string; g: (typeof GLOWS)[number]; clock: SharedValue<number> | undefined }) {
  const id = useSvgId('glow');
  const span = 1 + 2 * GLOW_PAD;
  const at = (v: number) => `${((v + GLOW_PAD) / span) * 100}%`;
  const move = useAnimatedStyle(() => {
    const s = clock ? clock.value : 0;
    const tau = 2 * Math.PI;
    return { transform: [{ translateX: g.dx * Math.sin((tau * s) / g.px) }, { translateY: g.dy * Math.sin((tau * s) / g.py) }] };
  });
  const pad = `${-GLOW_PAD * 100}%` as const;
  const size = `${span * 100}%` as const;
  return (
    <Animated.View style={[{ position: 'absolute', left: pad, top: pad, width: size, height: size }, move]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx={at(g.cx)} cy={at(g.cy)} r={`${(g.r / span) * 100}%`}>
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset={g.stop} stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * A fill lit from its top start corner (the outer corner of a tile on the start side): `light` at the
 * corner, deepening to `base` two-thirds of the way across. The Baghdad and Kut tile's date brown.
 */
export const CornerFill = memo(function CornerFill({ base, light }: { base: string; light: string }) {
  const theme = useTheme();
  const id = useSvgId('corner');
  const x = theme.isRTL ? '100%' : '0%';
  return (
    <View pointerEvents="none" style={fill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx={x} cy="0%" fx={x} fy="0%" r="130%">
            <Stop offset="0" stopColor={light} stopOpacity={1} />
            <Stop offset="0.65" stopColor={base} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={base} />
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});

/** A fill from `top` down to `bottom` (a slight slant, like light from above). الرجعة's gold. */
export const DownFill = memo(function DownFill({ top, bottom }: { top: string; bottom: string }) {
  const id = useSvgId('down');
  return (
    <View pointerEvents="none" style={fill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0.42" y1="0" x2="0.58" y2="1">
            <Stop offset="0" stopColor={top} stopOpacity={1} />
            <Stop offset="1" stopColor={bottom} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});

/**
 * One tile of the khatam, the eight-pointed star of Iraqi tiles and doors: two squares, one turned
 * 45°, a ring in the middle and a tick at each corner where four stars meet (the trips artifact).
 */
export const STAR_TILE = 34;
const STAR_D = 'M9 9H25V25H9Z M17 5.69L28.31 17L17 28.31L5.69 17Z M0 0L4 4M34 0L30 4M0 34L4 30M34 34L30 30';

/** Faint khatam star lines over a fill (the Baghdad and Kut trips tile, in gold). */
export const StarPattern = memo(function StarPattern({ color, opacity = 0.16 }: { color: string; opacity?: number }) {
  const id = useSvgId('star');
  return (
    <View pointerEvents="none" style={fill}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={STAR_TILE} height={STAR_TILE}>
            <Path d={STAR_D} fill="none" stroke={color} strokeOpacity={opacity} strokeWidth={1.2} strokeLinejoin="round" />
            <Circle cx={17} cy={17} r={3} fill="none" stroke={color} strokeOpacity={opacity} strokeWidth={1.2} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});

/** Tiny dots, scattered the same way every time, for the paper grain. */
const GRAIN_TILE = 48;
const GRAIN_DOTS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const out: Array<readonly [number, number, number]> = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 60; i++) out.push([rnd() * GRAIN_TILE, rnd() * GRAIN_TILE, 0.15 + rnd() * 0.35]);
  return out;
})();

/**
 * The top of home: the hour's sky fading into the page (late lilac, dawn peach, noon blue, sunset
 * rose), and a light paper grain over the whole screen. Pass it as `Screen`'s `backdrop`.
 */
export const SkyBackdrop = memo(function SkyBackdrop({ hour, height = 260 }: { hour: number; height?: number }) {
  const theme = useTheme();
  const id = useSvgId('sky');
  const wash = theme.decor.wash[skyHour(hour)];
  return (
    <View pointerEvents="none" style={fill} testID={`sky-${skyHour(hour)}`}>
      <Svg width="100%" height="100%" style={fill}>
        <Defs>
          <Pattern id={`${id}g`} patternUnits="userSpaceOnUse" width={GRAIN_TILE} height={GRAIN_TILE}>
            {GRAIN_DOTS.map(([x, y, o], i) => (
              <Circle key={i} cx={x} cy={y} r={0.6} fill={theme.decor.grain} fillOpacity={o * 0.22} />
            ))}
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id}g)`} />
      </Svg>
      <Svg width="100%" height={height} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <Defs>
          <LinearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={wash} stopOpacity={0.95} />
            <Stop offset="1" stopColor={wash} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id}w)`} />
      </Svg>
    </View>
  );
});
