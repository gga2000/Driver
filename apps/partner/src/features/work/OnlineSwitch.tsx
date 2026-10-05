import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Icon, SlideToConfirm, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

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
 * The big switch. Offline: the orange slider (P-40) — slide the thumb across, or just tap it, to
 * start the shift; the thumb is a real slider now, so the affordance tells the truth. Online: going
 * offline is a press-and-hold (the track fills over 0.9 s) so a pocket tap never ends a shift.
 */
export function OnlineSwitch({ online, busy, onGoOnline, onGoOffline, testID = 'online-switch' }: OnlineSwitchProps) {
  const theme = useTheme();
  const t = useT();
  const hold = useSharedValue(0);
  const [holding, setHolding] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (online) theme.haptic('success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

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
    <SlideToConfirm
      testID={testID}
      label={busy ? t('partner.switch_going_online') : t('partner.go_online')}
      loading={busy}
      tapToConfirm
      confirmHaptic="medium"
      onConfirm={onGoOnline}
      style={{
        borderRadius: theme.radius.pill,
        shadowColor: theme.colors.accent,
        shadowOpacity: 0.35,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      }}
    />
  );
}
