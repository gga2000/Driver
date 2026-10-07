import type { ReactNode } from 'react';
import { ActivityIndicator, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { AnimatedPressable, usePressScale } from '../motion/motion';
import { useTheme, type HapticKind } from '../theme/ThemeProvider';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (start side). */
  icon?: IconName;
  /**
   * Secondary value pinned to the end side, e.g. the order total on "اطلب هسة". Rendered in
   * tabular digits after a hairline divider.
   */
  trailing?: ReactNode;
  loading?: boolean;
  /** Shown instead of `label` while loading ("دنرسل طلبك…"). */
  loadingLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Haptic fired on press; false to silence. Defaults: destructive → warning, primary → light, others → the theme's `secondaryButtonHaptic`. */
  haptic?: HapticKind | false;
  /** What a screen reader says instead of `label` (e.g. why the button is waiting). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 48, lg: 56 };

const PALETTE: Record<ButtonVariant, { bg: ThemeColorKey | 'transparent'; fg: ThemeColorKey; border?: ThemeColorKey }> = {
  primary: { bg: 'accent', fg: 'onAccent' },
  secondary: { bg: 'surface', fg: 'text', border: 'borderStrong' },
  ghost: { bg: 'transparent', fg: 'accentText' },
  destructive: { bg: 'danger', fg: 'onDanger' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  trailing,
  loading = false,
  loadingLabel,
  disabled = false,
  fullWidth = false,
  haptic,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const press = usePressScale();
  const p = PALETTE[variant];
  const fg = theme.colors[p.fg];
  const inactive = disabled || loading;
  // Haptics only mean something when rare (joy S2-18): the theme decides whether secondary and ghost
  // buttons buzz (istikan: no; light: today's light tap).
  const hapticKind = haptic ?? (variant === 'destructive' ? 'warning' : variant === 'primary' ? 'light' : theme.secondaryButtonHaptic);
  const textVariant = size === 'sm' ? 'label' : 'button';

  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={loading && loadingLabel ? loadingLabel : (accessibilityLabel ?? label)}
      accessibilityHint={accessibilityHint}
      aria-disabled={inactive}
      aria-busy={loading}
      disabled={inactive}
      hitSlop={size === 'sm' ? { top: 4, bottom: 4 } : undefined}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={(e) => {
        if (hapticKind) theme.haptic(hapticKind);
        onPress?.(e);
      }}
      style={[
        {
          minHeight: HEIGHT[size],
          paddingHorizontal: size === 'sm' ? theme.space[3] : theme.space[5],
          borderRadius: size === 'lg' ? theme.radius.lg : theme.radius.md,
          backgroundColor: p.bg === 'transparent' ? 'transparent' : theme.colors[p.bg],
          borderWidth: p.border ? 1.5 : 0,
          borderColor: p.border ? theme.colors[p.border] : undefined,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: trailing ? 'space-between' : 'center',
          gap: theme.space[2],
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: disabled ? theme.state.disabledOpacity : 1,
        },
        press.style,
        style,
      ]}
    >
      {/* The label gives way (ellipsis) before the trailing amount does, so a long label never pushes it off the button. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexShrink: 1, minWidth: 0 }}>
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : icon ? (
          <Icon name={icon} size={size === 'sm' ? 18 : 20} color={fg} strokeWidth={2} />
        ) : null}
        <Text variant={textVariant} color={fg} numberOfLines={1}>
          {loading && loadingLabel ? loadingLabel : label}
        </Text>
      </View>
      {trailing != null && !loading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], flexShrink: 0 }}>
          <View style={{ width: 1, alignSelf: 'stretch', marginVertical: 2, backgroundColor: fg, opacity: 0.25 }} />
          {typeof trailing === 'string' ? (
            <Text variant={textVariant} color={fg} tabular>
              {trailing}
            </Text>
          ) : (
            trailing
          )}
        </View>
      ) : null}
    </AnimatedPressable>
  );
}
