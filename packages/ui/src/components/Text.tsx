import { forwardRef } from 'react';
import { Platform, Text as RNText, StyleSheet, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import type { BrandFace, TypeVariant } from '@driver/design-tokens';
import { scaleText } from '../logic/text-scale';
import { textOf, voiceAllowed } from '../logic/voice';
import { resolveColor, type ColorValue } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: ColorValue;
  /** Override the variant's weight. */
  weight?: 400 | 500 | 600 | 700;
  align?: 'start' | 'center' | 'end';
  /** Tabular digits for prices, timers and plates so columns don't jitter (always on for numerals). */
  tabular?: boolean;
  /**
   * Compact control label (chip, pill, badge, tab, segment): stops growing at 1.3× the OS text size
   * so its box can hold it (audit S-11). Body copy leaves this off and scales freely.
   */
  compact?: boolean;
  /**
   * Brand face (joy J-D2): `display` = Alexandria 700 (headings ≥ 22 px, hero numerals, tabular);
   * `voice` = Marhey 700 for brand lines of ≤ 6 words. A voice line with a digit or more words falls
   * back to `display`: Marhey never sets a number.
   */
  face?: BrandFace;
  /** A letter drawn inside a fixed box (an avatar's initial, a plate's number): the app's text size setting leaves it alone. */
  fixed?: boolean;
}

/**
 * Arabic-first text. Alignment defaults to the natural (start) side, which is the right in RTL
 * on both native and web; `end` is resolved against the theme direction.
 */
export const Text = forwardRef<RNText, TextProps>(function Text(
  { variant = 'body', color = 'text', weight, align, tabular, compact, face, fixed, style, ...rest },
  ref,
) {
  const theme = useTheme();
  const brand: BrandFace | null = face === 'voice' ? (voiceAllowed(textOf(rest.children) ?? '') ? 'voice' : 'display') : (face ?? null);
  const t = theme.type[variant];
  const w = (weight ?? t.weight) as 400 | 500 | 600 | 700;
  // Native with I18nManager RTL swaps left/right, so 'left' already means start there; the web
  // has no swap, so resolve against the theme direction.
  const physical = Platform.OS === 'web' && theme.isRTL;
  const textAlign =
    align === 'center' ? 'center' : align === 'end' ? (physical ? 'left' : 'right') : align === 'start' ? (physical ? 'right' : 'left') : undefined;
  const numeral = variant.startsWith('numeral') || variant === 'amount';
  const scale = fixed ? 1 : theme.textScale;
  const sized = scaleText({ fontSize: t.size, lineHeight: t.lineHeight }, scale, Boolean(compact), theme.fontScale.compact);
  return (
    <RNText
      ref={ref}
      maxFontSizeMultiplier={sized.maxFontSizeMultiplier}
      style={[
        {
          fontSize: sized.fontSize,
          lineHeight: sized.lineHeight,
          color: resolveColor(theme, color),
          writingDirection: theme.direction,
          ...(brand ? theme.face(brand) : theme.font(w)),
        },
        textAlign ? { textAlign } : null,
        tabular || numeral || brand === 'display' ? { fontVariant: ['tabular-nums'] } : null,
        scale === 1 ? style : scaledOverride(style, scale, Boolean(compact), theme.fontScale.compact),
      ]}
      {...rest}
    />
  );
});

/**
 * A caller's own fixed size or line height (a ring's number, a hero line) grows with the app's text size
 * too, so a scaled font never sits in an unscaled line box and clips.
 */
function scaledOverride(style: TextProps['style'], scale: number, compact: boolean, cap: number): TextProps['style'] {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!flat || (typeof flat.fontSize !== 'number' && typeof flat.lineHeight !== 'number')) return style;
  const factor = compact ? Math.min(scale, cap) : scale;
  return [
    style,
    {
      ...(typeof flat.fontSize === 'number' ? { fontSize: Math.round(flat.fontSize * factor * 2) / 2 } : null),
      ...(typeof flat.lineHeight === 'number' ? { lineHeight: Math.round(flat.lineHeight * factor * 2) / 2 } : null),
    },
  ];
}
