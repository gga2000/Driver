import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { AnimatedPressable, usePressScale, useSelectSpring } from '../motion/motion';
import { useTheme } from '../theme/ThemeProvider';
import { Avatar, type AvatarTone } from './Avatar';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Person chip ("لمن؟"): shows an avatar and switches to the soft selected style. */
  avatar?: { name?: string; icon?: IconName; tone?: AvatarTone };
  /** `radio` inside single-select groups, `checkbox` otherwise. */
  role?: 'radio' | 'checkbox' | 'button';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Chip({ label, selected = false, onPress, icon, avatar, role = 'checkbox', disabled, style, testID }: ChipProps) {
  const theme = useTheme();
  const press = usePressScale(0.95);
  const pop = useSelectSpring(selected);
  const soft = !!avatar;
  const bg = selected ? (soft ? theme.colors.accentTint : theme.colors.accent) : theme.colors.surface;
  const fg = selected && !soft ? theme.colors.onAccent : theme.colors.text;
  const border = selected ? theme.colors.accent : theme.colors.border;
  const height = soft ? 44 : 36;

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={label}
      aria-checked={role === 'button' ? undefined : selected}
      aria-disabled={!!disabled}
      disabled={disabled}
      hitSlop={soft ? undefined : { top: 4, bottom: 4 }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        theme.haptic('selection');
        onPress?.();
      }}
      style={[press.style, { opacity: disabled ? theme.state.disabledOpacity : 1 }, style]}
    >
      <Animated.View
        style={[
          {
            height,
            borderRadius: height / 2,
            backgroundColor: bg,
            borderWidth: selected && soft ? 1.5 : 1,
            borderColor: border,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
            paddingStart: avatar ? 4 : theme.space[4],
            paddingEnd: theme.space[4],
          },
          pop,
        ]}
      >
        {avatar ? <Avatar name={avatar.name ?? label} icon={avatar.icon} tone={avatar.tone} size={34} /> : null}
        {icon && !avatar ? <Icon name={icon} size={16} color={fg} strokeWidth={2} /> : null}
        <Text variant="label" weight={selected ? 600 : 500} color={fg} numberOfLines={1}>
          {label}
        </Text>
        {selected && soft ? (
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={12} color="onAccent" strokeWidth={2.6} />
          </View>
        ) : null}
      </Animated.View>
    </AnimatedPressable>
  );
}

/** Next selection for a chip group tap. `required` single groups can't be emptied. */
export function nextChipSelection(value: readonly string[], id: string, mode: 'single' | 'multi', required = false): string[] {
  const has = value.includes(id);
  if (mode === 'single') {
    if (has) return required ? [...value] : [];
    return [id];
  }
  if (has) return required && value.length === 1 ? [...value] : value.filter((v) => v !== id);
  return [...value, id];
}

export interface ChipGroupItem {
  id: string;
  label: string;
  icon?: IconName;
  avatar?: ChipProps['avatar'];
}

export interface ChipGroupProps {
  items: readonly ChipGroupItem[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  mode?: 'single' | 'multi';
  required?: boolean;
  /** Group label read by screen readers (e.g. "هذا الطلب لمنو؟"). */
  accessibilityLabel?: string;
  /** Trailing action chip, e.g. "ضيف شخص". */
  action?: { label: string; icon?: IconName; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}

export function ChipGroup({ items, value, onChange, mode = 'single', required, accessibilityLabel, action, style }: ChipGroupProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole={mode === 'single' ? 'radiogroup' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }, style]}
    >
      {items.map((it) => (
        <Chip
          key={it.id}
          testID={`chip-${it.id}`}
          label={it.label}
          icon={it.icon}
          avatar={it.avatar}
          role={mode === 'single' ? 'radio' : 'checkbox'}
          selected={value.includes(it.id)}
          onPress={() => onChange(nextChipSelection(value, it.id, mode, required))}
        />
      ))}
      {action ? (
        <Chip
          label={action.label}
          role="button"
          avatar={items.some((i) => i.avatar) ? { icon: action.icon ?? 'plus', tone: 'accent' } : undefined}
          icon={action.icon ?? 'plus'}
          onPress={action.onPress}
        />
      ) : null}
    </View>
  );
}
