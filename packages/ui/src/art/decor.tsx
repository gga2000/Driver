import { memo, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { skyHour } from '../logic/sky';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Date & Saffron decoration (Ali, 2026-10-06; v3 artifact): the warm dot halo behind the service
 * tiles, the food tile's saffron gradient, the Iraqi star lines on the trips tile, the hour's sky at
 * the top of home and the paper grain. All of it is drawn with react-native-svg (no image files),
 * still (the movement comes in step 3), never takes a touch, and no text relies on it: every title
 * sits on a solid fill that passes AA by itself.
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
 * A fill with three soft glows over it (a still "mesh" gradient): light in the top corner, warm on
 * the side, deep at the bottom. The food tile's saffron; it starts to drift in step 3.
 */
export const MeshFill = memo(function MeshFill({ base, mesh }: { base: string; mesh: readonly [string, string, string] }) {
  const id = useSvgId('mesh');
  const [hi, warm, deep] = mesh;
  return (
    <View pointerEvents="none" style={fill}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`${id}a`} cx="20%" cy="12%" r="70%">
            <Stop offset="0" stopColor={hi} stopOpacity={1} />
            <Stop offset="0.6" stopColor={hi} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`${id}b`} cx="88%" cy="32%" r="70%">
            <Stop offset="0" stopColor={warm} stopOpacity={1} />
            <Stop offset="0.6" stopColor={warm} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`${id}c`} cx="45%" cy="100%" r="80%">
            <Stop offset="0" stopColor={deep} stopOpacity={1} />
            <Stop offset="0.7" stopColor={deep} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={base} />
        <Rect width="100%" height="100%" fill={`url(#${id}a)`} />
        <Rect width="100%" height="100%" fill={`url(#${id}b)`} />
        <Rect width="100%" height="100%" fill={`url(#${id}c)`} />
      </Svg>
    </View>
  );
});

/** One tile of the eight-pointed star (two squares, one turned 45°), as on Iraqi tiles and doors. */
const STAR_TILE = 28;
const STAR_D = 'M8 8H20V20H8Z M14 3.5L24.5 14L14 24.5L3.5 14Z';

/** Faint eight-pointed star lines over a fill (the Baghdad and Kut trips tile). */
export const StarPattern = memo(function StarPattern({ color, opacity = 0.16 }: { color: string; opacity?: number }) {
  const id = useSvgId('star');
  return (
    <View pointerEvents="none" style={fill}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={STAR_TILE} height={STAR_TILE}>
            <Path d={STAR_D} fill="none" stroke={color} strokeOpacity={opacity} strokeWidth={1.2} strokeLinejoin="round" />
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
