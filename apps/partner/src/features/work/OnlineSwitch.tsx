import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

const H = 72;
const THUMB = 58;
const HOLD_MS = 900;

export interface OnlineSwitchProps {
  online: boolean;
  /** A go-online/offline request is in flight. */
  busy: boolean;
  onGoOnline: () => void;
  onGoOffline: () => void;
  testID?: string;
}

/**
 * The big switch. Offline: an orange pill — one tap slides the thumb across, the track turns
 * green and the phone gives a success tick while the request goes out. Online: going offline is a
 * press-and-hold (the track fills over 0.9 s) so a pocket tap never ends a shift by accident.
 */
export function OnlineSwitch({ online, busy, onGoOnline, onGoOffline, testID = 'online-switch' }: OnlineSwitchProps) {
  const theme = useTheme();
  const t = useT();
  const [w, setW] = useState(0);
  const pos = useSharedValue(online ? 1 : 0);
  const hold = useSharedValue(0);
  const [holding, setHolding] = useState(false);
  const fired = useRef(false);
  const dir = theme.isRTL ? -1 : 1;
  const travel = Math.max(0, w - THUMB - 14);

  useEffect(() => {
    pos.value = theme.reduceMotion ? (online ? 1 : 0) : withSpring(online ? 1 : 0, { damping: 16, stiffness: 170, mass: 0.9 });
    if (online) theme.haptic('success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(pos.value, [0, 1], [theme.colors.accent, theme.colors.success]),
  }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: dir * pos.value * travel }] }), [travel, dir]);
  const fill = useAnimatedStyle(() => ({ width: `${hold.value * 100}%` }));

  const startHold = () => {
    if (busy) return;
    fired.current = false;
    setHolding(true);
    theme.haptic('light');
    hold.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear }, (done) => {
      if (done) runOnJS(finishHold)();
    });
  };
  const finishHold = () => {
    if (fired.current) return;
    fired.current = true;
    theme.haptic('warning');
    onGoOffline();
  };
  const endHold = () => {
    setHolding(false);
    if (fired.current) return;
    cancelAnimation(hold);
    hold.value = withTiming(0, { duration: 180 });
  };
  useEffect(() => {
    if (!online) hold.value = 0;
  }, [online, hold]);

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  if (online) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('partner.go_offline')}
        accessibilityHint={t('partner.switch_hold_offline')}
        onPressIn={startHold}
        onPressOut={endHold}
        disabled={busy}
        style={{ height: 56, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden', justifyContent: 'center' }}
      >
        <Animated.View style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, backgroundColor: theme.colors.dangerTint }, fill]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2] }}>
          {busy ? <ActivityIndicator color={theme.colors.dangerText} /> : <Icon name="x" size={18} color={holding ? 'dangerText' : 'textMuted'} strokeWidth={2.4} />}
          <Text variant="label" weight={600} color={holding ? 'dangerText' : 'textMuted'}>
            {holding ? t('partner.go_offline') : t('partner.switch_hold_offline')}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: false, busy }}
      accessibilityLabel={t('partner.go_online')}
      onPress={() => {
        if (busy) return;
        theme.haptic('medium');
        pos.value = theme.reduceMotion ? 1 : withSpring(1, { damping: 16, stiffness: 170, mass: 0.9 });
        onGoOnline();
      }}
      onLayout={onLayout}
    >
      <Animated.View
        style={[
          {
            height: H,
            borderRadius: theme.radius.pill,
            justifyContent: 'center',
            shadowColor: theme.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 6,
          },
          track,
        ]}
      >
        <Text variant="title" weight={700} align="center" color="onAccent" style={{ fontSize: 20 }}>
          {busy ? t('partner.switch_going_online') : t('partner.go_online')}
        </Text>
        <Animated.View
          style={[
            {
              position: 'absolute',
              start: 7,
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              backgroundColor: theme.colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            },
            thumb,
          ]}
        >
          {busy ? <ActivityIndicator color={theme.colors.success} /> : <Icon name="arrow-forward" size={26} color="text" strokeWidth={2.4} />}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}
