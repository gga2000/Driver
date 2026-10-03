import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';

export interface ChoiceCardProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Small label at the end of the title row ("الافتراضي"). */
  tag?: string;
  selected: boolean;
  onPress: () => void;
  /** `tile`: icon over the title, for grids of short options; `row`: icon, text, radio. */
  layout?: 'tile' | 'row';
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** One option of a single-choice question, big enough for a thumb in the street. */
export function ChoiceCard({ title, subtitle, icon, tag, selected, onPress, layout = 'row', trailing, style, testID }: ChoiceCardProps) {
  const theme = useTheme();
  const frame: ViewStyle = {
    borderRadius: theme.radius.lg,
    borderWidth: selected ? 2 : 1,
    borderColor: selected ? theme.colors.accent : theme.colors.border,
    backgroundColor: selected ? theme.colors.accentTint : theme.colors.surface,
  };
  if (layout === 'tile') {
    return (
      <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[frame, { alignItems: 'center', justifyContent: 'center', gap: theme.space[1], paddingVertical: theme.space[3], paddingHorizontal: theme.space[2], minHeight: 88 }, style]}>
        {icon ? <Icon name={icon} size={26} color={selected ? 'accentText' : 'text'} strokeWidth={2} /> : null}
        <Text variant="label" weight={selected ? 600 : 500} color={selected ? 'accentText' : 'text'} align="center" numberOfLines={1}>
          {title}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[frame, { flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4] }, style]}>
      {icon ? (
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: selected ? theme.colors.surface : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={22} color={selected ? 'accentText' : 'text'} strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
            {title}
          </Text>
          {tag ? (
            <View style={{ backgroundColor: selected ? theme.colors.surface : theme.colors.surfaceSunken, borderRadius: theme.radius.pill, paddingHorizontal: 8 }}>
              <Text variant="caption" weight={600} color="textMuted">
                {tag}
              </Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text variant="footnote" color="textMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ?? (
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: selected ? 7 : 2, borderColor: selected ? theme.colors.accent : theme.colors.borderStrong, backgroundColor: theme.colors.surface }} />
      )}
    </Pressable>
  );
}
