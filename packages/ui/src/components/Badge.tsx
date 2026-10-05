import { View, type StyleProp, type ViewStyle } from 'react-native';
import { ltr } from '../format';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface BadgeProps {
  /** Omit for a dot. Counts over 99 read "99+". */
  count?: number;
  tone?: 'accent' | 'danger';
  style?: StyleProp<ViewStyle>;
}

/** Count bubble or dot, ringed in the surface colour so it separates from whatever it sits on. */
export function Badge({ count, tone = 'accent', style }: BadgeProps) {
  const theme = useTheme();
  const bg = tone === 'danger' ? theme.colors.danger : theme.colors.accent;
  const fg = tone === 'danger' ? theme.colors.onDanger : theme.colors.onAccent;
  if (count == null) {
    return (
      <View
        accessibilityElementsHidden
        style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: bg, borderWidth: 2, borderColor: theme.colors.surface }, style]}
      />
    );
  }
  const label = count > 99 ? ltr('99+') : String(count);
  return (
    <View
      accessibilityLabel={label}
      style={[
        {
          // 12 px count (the type floor, audit S-10) in a 22 px bubble that grows with large text.
          minWidth: 22,
          minHeight: 22,
          paddingHorizontal: 5,
          borderRadius: 11,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 2,
          borderColor: theme.colors.surface,
        },
        style,
      ]}
    >
      <Text variant="caption" weight={700} color={fg} tabular compact style={{ lineHeight: 16 }}>
        {label}
      </Text>
    </View>
  );
}
