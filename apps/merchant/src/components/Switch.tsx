import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@driver/ui';
import { color as palette } from '@driver/design-tokens';

const TRACK_W = 52;
const TRACK_H = 30;
const THUMB = 24;
const INSET = (TRACK_H - THUMB) / 2;
const TRAVEL = TRACK_W - THUMB - INSET * 2;

/**
 * d15 · the one switch of the Merchant app: the brand colour when on, grey when off, a 56 × 44 px target.
 * The printer screen's switches were orange and the settings' green; every on/off in the app is now
 * this one. On sits at the end side (left in Arabic). The thumb slides once per change (transform
 * only), and jumps straight there with reduce motion.
 */
export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
  testID,
  disabled = false,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel?: string;
  testID?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const dir = theme.isRTL ? -1 : 1;
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    const to = value ? 1 : 0;
    x.value = theme.reduceMotion ? to : withTiming(to, { duration: 160, easing: Easing.out(Easing.quad) });
  }, [value, theme.reduceMotion, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * TRAVEL * dir }] }));
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      disabled={disabled}
      onPress={() => {
        theme.haptic('selection');
        onValueChange(!value);
      }}
      style={({ pressed }) => ({ minWidth: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? theme.state.disabledOpacity : pressed ? 0.85 : 1 })}
    >
      <View style={{ width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: value ? theme.colors.accent : theme.colors.borderStrong }}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: INSET,
              start: INSET,
              width: THUMB,
              height: THUMB,
              borderRadius: THUMB / 2,
              backgroundColor: palette.neutral[0],
              shadowColor: palette.neutral[900],
              shadowOpacity: 0.18,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
              elevation: 2,
            },
            thumb,
          ]}
        />
      </View>
    </Pressable>
  );
}
