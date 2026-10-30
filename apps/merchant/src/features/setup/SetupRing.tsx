import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { COUNTER } from '@/lib/counter';

/**
 * f3: «جاهز 40%» — one ring for how ready the shop is, filling in saffron. `onDark` sits on the date
 * brown header; otherwise on cream. The number in the middle reads the same to a screen reader.
 */
export function SetupRing({ percent, size = 72, onDark = false, label, testID }: { percent: number; size?: number; onDark?: boolean; label: string; testID?: string }) {
  const theme = useTheme();
  const stroke = Math.max(5, Math.round(size / 11));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(100, Math.max(0, percent));
  return (
    <View testID={testID} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: p }} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={onDark ? withAlpha(COUNTER.onDate, 0.18) : COUNTER.sand} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={p >= 100 ? COUNTER.ready : COUNTER.saffron} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${(c * p) / 100} ${c}`} />
      </Svg>
      <Text weight={700} tabular style={[theme.face('display'), { color: onDark ? COUNTER.onDate : COUNTER.date, fontSize: Math.round(size / 4), lineHeight: Math.round(size / 4) + 8 }]}>
        {`${p}%`}
      </Text>
    </View>
  );
}

/** The same progress as a thin bar (the board card): saffron on sand, growing from the start side. */
export function SetupBar({ percent }: { percent: number }) {
  const p = Math.min(100, Math.max(0, percent));
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: COUNTER.sand, overflow: 'hidden', flexDirection: 'row' }}>
      <View style={{ width: `${p}%`, minWidth: p > 0 ? 8 : 0, borderRadius: 4, backgroundColor: p >= 100 ? COUNTER.ready : COUNTER.saffron }} />
    </View>
  );
}
