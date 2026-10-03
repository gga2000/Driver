import { forwardRef } from 'react';
import { Platform, Text as RNText, type TextProps as RNTextProps } from 'react-native';
import type { TypeVariant } from '@driver/design-tokens';
import { resolveColor, type ColorValue } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: ColorValue;
  /** Override the variant's weight. */
  weight?: 400 | 500 | 600 | 700;
  align?: 'start' | 'center' | 'end';
  /** Tabular digits for prices, timers and plates so columns don't jitter. */
  tabular?: boolean;
}

/**
 * Arabic-first text. Alignment defaults to the natural (start) side, which is the right in RTL
 * on both native and web; `end` is resolved against the theme direction.
 */
export const Text = forwardRef<RNText, TextProps>(function Text(
  { variant = 'body', color = 'text', weight, align, tabular, style, ...rest },
  ref,
) {
  const theme = useTheme();
  const t = theme.type[variant];
  const w = (weight ?? t.weight) as 400 | 500 | 600 | 700;
  // Native with I18nManager RTL swaps left/right, so 'left' already means start there; the web
  // has no swap, so resolve against the theme direction.
  const physical = Platform.OS === 'web' && theme.isRTL;
  const textAlign =
    align === 'center' ? 'center' : align === 'end' ? (physical ? 'left' : 'right') : align === 'start' ? (physical ? 'right' : 'left') : undefined;
  return (
    <RNText
      ref={ref}
      style={[
        {
          fontSize: t.size,
          lineHeight: t.lineHeight,
          color: resolveColor(theme, color),
          writingDirection: theme.direction,
          ...theme.font(w),
        },
        textAlign ? { textAlign } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
      {...rest}
    />
  );
});
