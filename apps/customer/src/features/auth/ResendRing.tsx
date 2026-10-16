import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text, useTheme } from '@driver/ui';

/**
 * "تگدر تطلب رمز جديد بعد 18 ثانية" with a small saffron ring that empties as the wait runs out, so
 * the wait reads at a glance instead of only as a number.
 */
export function ResendRing({ secondsLeft, totalSeconds, label }: { secondsLeft: number; totalSeconds: number; label: string }) {
  const theme = useTheme();
  const size = 22;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const left = totalSeconds > 0 ? Math.min(1, secondsLeft / totalSeconds) : 0;
  return (
    <View testID="otp-resend-wait" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], minHeight: 44 }}>
      <Svg width={size} height={size} aria-hidden accessible={false}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={theme.colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - left)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text variant="label" color="textMuted" tabular accessibilityLiveRegion="none">
        {label}
      </Text>
    </View>
  );
}
