import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { AnimatedPressable, usePressScale } from '../motion/motion';
import { useTheme, type HapticKind } from '../theme/ThemeProvider';
import { Badge } from './Badge';

/** `stepper`: the stepper's "+" (an accent blob in light, a neutral key with a strong ring in istikan). */
export type IconButtonVariant = 'plain' | 'tonal' | 'accent' | 'outline' | 'stepper';

export interface IconButtonProps {
  icon: IconName;
  /** Required: an icon-only control has no other name for screen readers. */
  accessibilityLabel: string;
  onPress?: () => void;
  variant?: IconButtonVariant;
  size?: 36 | 44 | 52;
  /** Count bubble (cart) or `true` for a dot (unread). */
  badge?: number | boolean;
  disabled?: boolean;
  haptic?: HapticKind | false;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const PALETTE: Record<IconButtonVariant, { bg?: ThemeColorKey; fg: ThemeColorKey; border?: ThemeColorKey }> = {
  plain: { fg: 'text' },
  tonal: { bg: 'surfaceSunken', fg: 'text' },
  accent: { bg: 'accent', fg: 'onAccent' },
  outline: { bg: 'surface', fg: 'text', border: 'border' },
  stepper: { bg: 'stepperPlus', fg: 'onStepperPlus', border: 'stepperPlusBorder' },
};

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'tonal',
  size = 44,
  badge,
  disabled,
  haptic = 'selection',
  style,
  testID,
}: IconButtonProps) {
  const theme = useTheme();
  const press = usePressScale(0.92);
  const p = PALETTE[variant];
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      aria-disabled={!!disabled}
      disabled={disabled}
      hitSlop={size < 44 ? (44 - size) / 2 : undefined}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        if (haptic) theme.haptic(haptic);
        onPress?.();
      }}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: p.bg ? theme.colors[p.bg] : 'transparent',
          borderWidth: p.border ? (variant === 'stepper' ? 1.5 : 1) : 0,
          borderColor: p.border ? theme.colors[p.border] : undefined,
          opacity: disabled ? theme.state.disabledOpacity : 1,
        },
        press.style,
        style,
      ]}
    >
      <Icon name={icon} size={size >= 52 ? 24 : size >= 44 ? 22 : 18} color={p.fg} strokeWidth={size >= 44 ? 1.9 : 2} />
      {badge ? (
        <View style={{ position: 'absolute', top: -2, end: -2 }}>
          <Badge count={typeof badge === 'number' ? badge : undefined} />
        </View>
      ) : null}
    </AnimatedPressable>
  );
}
