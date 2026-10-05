import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { withAlpha } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Leading icon in a soft square, or any node (Avatar). */
  leading?: IconName | ReactNode;
  /** Short value at the end side ("12,000 دينار", "شغّال"). */
  value?: string;
  /** Any node at the end side (Switch, StatusPill). Replaces `value`. */
  trailing?: ReactNode;
  /** Show a chevron that points forward in the reading direction. Defaults to true when pressable. */
  chevron?: boolean;
  onPress?: () => void;
  /** Hairline under the row (rows stacked in a card). */
  divider?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListRow({ title, subtitle, leading, value, trailing, chevron, onPress, divider, selected, style, testID }: ListRowProps) {
  const theme = useTheme();
  const showChevron = chevron ?? !!onPress;
  const content = (pressed: boolean) => (
    <View
      style={[
        {
          minHeight: subtitle ? 64 : 52,
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          paddingVertical: theme.space[2],
          paddingHorizontal: theme.space[4],
          backgroundColor: selected
            ? theme.colors.accentTint
            : pressed
              ? withAlpha(theme.state.layer[theme.name], theme.state.pressedOpacity)
              : 'transparent',
          borderBottomWidth: divider ? 1 : 0,
          borderBottomColor: theme.colors.border,
        },
        style,
      ]}
    >
      {typeof leading === 'string' ? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radius.md,
            backgroundColor: selected ? theme.colors.surface : theme.colors.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={leading as IconName} size={22} color="text" />
        </View>
      ) : (
        leading ?? null
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" weight={500} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color="textMuted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View>{trailing}</View> : value ? <Text variant="label" color="textMuted" tabular>{value}</Text> : null}
      {/* Selected is marked by a check, not only the pale fill (audit S-04: tint vs white is 1.17:1). */}
      {selected ? <Icon name="check" size={20} color="accentText" strokeWidth={2.4} /> : null}
      {showChevron && !selected ? <Icon name="chevron-forward" size={18} color="textMuted" /> : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{content(false)}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}، ${subtitle}` : title}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      onPress={onPress}
    >
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}
