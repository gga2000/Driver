import { memo, useEffect, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { ClipPath, Defs, G, Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { archPath, Ink, SKETCH } from './kit';
import { drawScene, KitchenSteam, type SceneName, type SceneVehicle } from './scenes';

export { SCENE_NAMES, type SceneName, type SceneVehicle } from './scenes';

/** Scene box (16:10) and its arch. */
const VIEW_W = 320;
const VIEW_H = 200;
const FRAME = archPath(4, 4, 312, 192, 0.24);
/** Ink width in scene units (scenes show at ≈ 1 unit per px). */
const LINE = 2.4;
/** The steam loop (food-funnel S-3): opacity 0.35 ↔ 0.8 and a 4 px drift over 2.4 s, the only ambient loop. */
const STEAM_HALF_MS = 1200;

export interface SketchSceneProps {
  name: SceneName;
  /** For `safe_arrival`: which vehicle brings them home (default the garage minibus). */
  vehicle?: SceneVehicle;
  /**
   * Arabic label when the drawing carries meaning on its own (locale `art.scene.*`). Without one the
   * drawing is decorative and hidden from screen readers — the screen's own text says what it shows.
   */
  label?: string;
  /** The kitchen's steam drifts unless this is false or the phone asks for reduced motion. */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * One arch-topped scene of the Aziziyah sketchbook (joy J4), 16:10, filling the width it is given. Used
 * in place of the icon-in-a-circle on status screens (design-system S2-12): the waiting kitchen, the
 * arrival door, the doorbell ask, empty and offline states. Static SVG; only the kitchen steam moves,
 * as a separate layer (transform and opacity), and never under reduced motion.
 */
export const SketchScene = memo(function SketchScene({ name, vehicle, label, animate = true, style, testID }: SketchSceneProps) {
  const clipId = `sketch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const a11y = label ? ({ accessible: true, role: 'img', 'aria-label': label } as const) : ({ accessible: false, 'aria-hidden': true, importantForAccessibility: 'no-hide-descendants' } as const);
  return (
    <View testID={testID ?? `scene-${name}`} style={[{ width: '100%', aspectRatio: VIEW_W / VIEW_H }, style]} {...a11y}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={FRAME} />
          </ClipPath>
        </Defs>
        <Path d={FRAME} fill={SKETCH.paper} />
        <G clipPath={`url(#${clipId})`}>{drawScene(name, LINE, vehicle)}</G>
        <Ink d={FRAME} w={LINE} />
      </Svg>
      {name === 'kitchen' ? <SteamLayer animate={animate} /> : null}
    </View>
  );
});

function SteamLayer({ animate }: { animate: boolean }) {
  const theme = useTheme();
  const still = !animate || theme.reduceMotion;
  const t = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    const ease = Easing.inOut(Easing.sin);
    t.value = withRepeat(withSequence(withTiming(1, { duration: STEAM_HALF_MS, easing: ease }), withTiming(0, { duration: STEAM_HALF_MS, easing: ease })), -1);
    return () => cancelAnimation(t);
  }, [still, t]);
  const drift = useAnimatedStyle(() => ({ opacity: still ? 0.7 : 0.35 + 0.45 * t.value, transform: [{ translateY: still ? 0 : -4 * t.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, drift]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        <KitchenSteam w={LINE} />
      </Svg>
    </Animated.View>
  );
}
