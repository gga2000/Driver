import { useEffect } from 'react';
import { Image, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { LivenessGesture } from '@driver/contracts';
import { Icon, useTheme, withAlpha } from '@driver/ui';

const SKIN = '#F3D2B3';
const SKIN_EDGE = '#D9A87F';
const INK = '#3B2A1E';

/**
 * The liveness move drawn on a face, looping: eyes blink twice, the face turns left / right, nods, or
 * smiles. Directions are physical (what he does in front of the camera), never mirrored by RTL.
 */
export function GestureIllustration({ gesture, size = 168 }: { gesture: LivenessGesture; size?: number }) {
  const theme = useTheme();
  const k = size / 168;
  const lid = useSharedValue(1);
  const turn = useSharedValue(0);
  const nod = useSharedValue(0);
  const smile = useSharedValue(0);

  useEffect(() => {
    if (theme.reduceMotion) {
      lid.value = 1;
      turn.value = gesture === 'turn_left' ? -1 : gesture === 'turn_right' ? 1 : 0;
      nod.value = 0;
      smile.value = gesture === 'smile' ? 1 : 0;
      return;
    }
    const ease = { duration: 420, easing: Easing.inOut(Easing.cubic) };
    if (gesture === 'blink') {
      lid.value = withRepeat(withSequence(withDelay(700, withTiming(0.08, { duration: 90 })), withTiming(1, { duration: 120 }), withTiming(0.08, { duration: 90 }), withTiming(1, { duration: 120 })), -1);
    } else if (gesture === 'turn_left' || gesture === 'turn_right') {
      const dir = gesture === 'turn_left' ? -1 : 1;
      turn.value = withRepeat(withSequence(withDelay(400, withTiming(dir, ease)), withDelay(700, withTiming(0, ease))), -1);
    } else if (gesture === 'nod') {
      nod.value = withRepeat(withSequence(withDelay(400, withTiming(-1, { duration: 300 })), withTiming(1, { duration: 420 }), withTiming(0, { duration: 300 })), -1);
    } else {
      smile.value = withRepeat(withSequence(withDelay(500, withTiming(1, ease)), withDelay(900, withTiming(0, ease))), -1);
    }
    return () => {
      cancelAnimation(lid);
      cancelAnimation(turn);
      cancelAnimation(nod);
      cancelAnimation(smile);
    };
  }, [gesture, theme.reduceMotion, lid, turn, nod, smile]);

  const head = useAnimatedStyle(() => ({ transform: [{ translateY: nod.value * 7 * k }, { rotate: `${turn.value * 6}deg` }] }));
  const features = useAnimatedStyle(() => ({ transform: [{ translateX: turn.value * 16 * k }, { translateY: nod.value * 5 * k }] }));
  const eyes = useAnimatedStyle(() => ({ transform: [{ scaleY: lid.value }] }));
  const neutral = useAnimatedStyle(() => ({ opacity: 1 - smile.value }));
  const happy = useAnimatedStyle(() => ({ opacity: smile.value, transform: [{ scale: 0.9 + smile.value * 0.1 }] }));

  const headW = 104 * k;
  const headH = 124 * k;
  return (
    <View testID={`gesture-${gesture}`} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.accentTint }} />
      <View style={{ position: 'absolute', width: size - 18 * k, height: size - 18 * k, borderRadius: size, borderWidth: 2, borderStyle: 'dashed', borderColor: withAlpha(theme.colors.accent, 0.55) }} />
      <Animated.View style={[{ width: headW, height: headH, borderRadius: headW / 2, backgroundColor: SKIN, borderWidth: 2, borderColor: SKIN_EDGE, overflow: 'hidden', alignItems: 'center' }, head]}>
        <View style={{ position: 'absolute', top: -6 * k, width: headW + 8, height: 40 * k, borderBottomLeftRadius: headW / 2, borderBottomRightRadius: headW / 2, backgroundColor: INK }} />
        <Animated.View style={[{ position: 'absolute', top: 50 * k, width: headW, alignItems: 'center' }, features]}>
          <Animated.View style={[{ flexDirection: 'row', gap: 26 * k, direction: 'ltr' }, eyes]}>
            <View style={{ width: 11 * k, height: 13 * k, borderRadius: 6 * k, backgroundColor: INK }} />
            <View style={{ width: 11 * k, height: 13 * k, borderRadius: 6 * k, backgroundColor: INK }} />
          </Animated.View>
          <View style={{ marginTop: 9 * k, width: 7 * k, height: 12 * k, borderRadius: 4 * k, backgroundColor: SKIN_EDGE, opacity: 0.55 }} />
          <View style={{ marginTop: 8 * k, width: 40 * k, height: 18 * k, alignItems: 'center' }}>
            <Animated.View style={[{ position: 'absolute' }, neutral]}>
              <Svg width={36 * k} height={12 * k} viewBox="0 0 36 12">
                <Path d="M6 6h24" stroke={INK} strokeWidth={3} strokeLinecap="round" />
              </Svg>
            </Animated.View>
            <Animated.View style={[{ position: 'absolute' }, happy]}>
              <Svg width={36 * k} height={18 * k} viewBox="0 0 36 18">
                <Path d="M4 3c4 9 9 12 14 12s10-3 14-12z" fill={INK} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
              </Svg>
            </Animated.View>
          </View>
        </Animated.View>
      </Animated.View>
      <Cue gesture={gesture} />
    </View>
  );
}

/** A small arrow badge that says which way to move. */
function Cue({ gesture }: { gesture: LivenessGesture }) {
  const theme = useTheme();
  const d =
    gesture === 'turn_left'
      ? 'M15 5l-7 7 7 7'
      : gesture === 'turn_right'
        ? 'M9 5l7 7-7 7'
        : gesture === 'nod'
          ? 'M12 4v16M7 9l5-5 5 5M7 15l5 5 5-5'
          : gesture === 'blink'
            ? 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 9.5v.01'
            : 'M7 14c1.4 2 3 3 5 3s3.6-1 5-3M9 9v.5M15 9v.5';
  const side = gesture === 'turn_left' ? { left: 0 } : gesture === 'turn_right' ? { right: 0 } : { right: 4 };
  return (
    <View style={{ position: 'absolute', bottom: 6, ...side, width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: theme.colors.surface }}>
      <Svg width={22} height={22} viewBox="0 0 24 24">
        <Path d={d} stroke={theme.colors.onAccent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

/** The selfie in an oval frame; while `scanning`, a light band sweeps over it. */
export function SelfieFrame({ uri, scanning }: { uri: string; scanning: boolean }) {
  const theme = useTheme();
  const W = 200;
  const H = 250;
  const y = useSharedValue(0);
  useEffect(() => {
    if (!scanning || theme.reduceMotion) {
      cancelAnimation(y);
      y.value = 0;
      return;
    }
    y.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(y);
  }, [scanning, theme.reduceMotion, y]);
  const band = useAnimatedStyle(() => ({ transform: [{ translateY: y.value * (H - 40) }] }));
  return (
    <View style={{ alignSelf: 'center', width: W + 12, height: H + 12, borderRadius: (W + 12) / 2, borderWidth: 3, borderColor: scanning ? theme.colors.accent : theme.colors.border, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: W, height: H, borderRadius: W / 2, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
        <Image testID="checkin-selfie" source={{ uri }} resizeMode="cover" style={{ width: W, height: H }} />
        {scanning ? <Animated.View style={[{ position: 'absolute', top: 0, start: 0, end: 0, height: 40, backgroundColor: withAlpha(theme.colors.accent, 0.35) }, band]} /> : null}
      </View>
    </View>
  );
}

/** Success / failure / lock mark: a disc that pops in with rings. */
export function ResultMark({ kind }: { kind: 'passed' | 'failed' | 'locked' }) {
  const theme = useTheme();
  const s = useSharedValue(theme.reduceMotion ? 1 : 0.4);
  const ring = useSharedValue(0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    s.value = withSpring(1, { damping: 10, stiffness: 180 });
    ring.value = withDelay(120, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [s, ring, theme.reduceMotion]);
  const disc = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: 1 - ring.value, transform: [{ scale: 1 + ring.value * 0.6 }] }));
  const c = kind === 'passed' ? theme.colors.success : kind === 'failed' ? theme.colors.warning : theme.colors.danger;
  const tint = kind === 'passed' ? theme.colors.successTint : kind === 'failed' ? theme.colors.warningTint : theme.colors.dangerTint;
  return (
    <View style={{ width: 132, height: 132, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 132, height: 132, borderRadius: 66, backgroundColor: tint }, halo]} />
      <View style={{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: tint }} />
      <Animated.View style={[{ width: 84, height: 84, borderRadius: 42, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }, disc]}>
        {kind === 'passed' ? (
          <Icon name="check" size={44} color="#FFFFFF" strokeWidth={3} />
        ) : kind === 'failed' ? (
          <Svg width={40} height={40} viewBox="0 0 24 24">
            <Path d="M20 11a8 8 0 1 0-2.3 5.7M20 4.5V11h-6.5" stroke="#FFFFFF" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        ) : (
          <Svg width={40} height={40} viewBox="0 0 24 24">
            <Path d="M7 10.5h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        )}
      </Animated.View>
    </View>
  );
}
