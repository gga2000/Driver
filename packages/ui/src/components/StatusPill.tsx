import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { usePulse } from '../motion/motion';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const STATUS_TONES: Record<StatusTone, { bg: ThemeColorKey; fg: ThemeColorKey; dot: ThemeColorKey }> = {
  neutral: { bg: 'surfaceSunken', fg: 'text', dot: 'textMuted' },
  accent: { bg: 'accentTint', fg: 'accentText', dot: 'accent' },
  success: { bg: 'successTint', fg: 'successText', dot: 'success' },
  warning: { bg: 'warningTint', fg: 'warningText', dot: 'warning' },
  danger: { bg: 'dangerTint', fg: 'dangerText', dot: 'danger' },
  info: { bg: 'infoTint', fg: 'infoText', dot: 'info' },
};

export interface StatusPillProps {
  label: string;
  tone?: StatusTone;
  icon?: IconName;
  /** Dot with a pulsing ring: live state ("الدليفري بالطريق", "متصل"). */
  live?: boolean;
  /** Dot without the pulse. */
  dot?: boolean;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

export function StatusPill({ label, tone = 'neutral', icon, live, dot, size = 'md', style }: StatusPillProps) {
  const theme = useTheme();
  const c = STATUS_TONES[tone];
  const pulse = usePulse(!!live);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 6,
          // A floor, not a fixed height: Arabic at large text needs the room (audit S-11).
          minHeight: size === 'sm' ? 24 : 30,
          paddingHorizontal: size === 'sm' ? theme.space[2] : theme.space[3],
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors[c.bg],
        },
        style,
      ]}
    >
      {live || dot ? (
        <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
          {live ? (
            <Animated.View style={[{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors[c.dot] }, pulse]} />
          ) : null}
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors[c.dot] }} />
        </View>
      ) : null}
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} color={c.fg} strokeWidth={2} /> : null}
      <Text variant={size === 'sm' ? 'caption' : 'footnote'} weight={600} color={c.fg} numberOfLines={1} compact>
        {label}
      </Text>
    </View>
  );
}
