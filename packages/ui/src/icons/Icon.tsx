import { memo } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Svg from 'react-native-svg';
import type { ThemeColorKey } from '@driver/design-tokens';
import { useTheme } from '../theme/ThemeProvider';
import { glyphElements } from './GlyphShapes';
import { MIRRORED, iconShapes, type IconName } from './paths';

export interface IconProps {
  name: IconName;
  size?: number;
  /** A theme role (`accentText`) or a raw colour. Defaults to `text`. */
  color?: ThemeColorKey | (string & {});
  strokeWidth?: number;
  /** Fill closed shapes (selected star, active tab). */
  filled?: boolean;
  /** Fill in another colour than the stroke (with `filled`): the ink-outlined saffron star (joy S2-01). */
  fillColor?: ThemeColorKey | (string & {});
  style?: StyleProp<ViewStyle>;
  /** Icons are decorative by default; pass a label only when the icon stands alone. */
  accessibilityLabel?: string;
}

export const Icon = memo(function Icon({ name, size = 24, color = 'text', strokeWidth = 1.75, filled, fillColor, style, accessibilityLabel }: IconProps) {
  const theme = useTheme();
  const colors = theme.colors as unknown as Record<string, string>;
  const stroke = colors[color] ?? color;
  const mirror = theme.isRTL && MIRRORED.has(name);
  const fill = filled ? (fillColor ? (colors[fillColor] ?? fillColor) : stroke) : 'none';
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={[mirror ? { transform: [{ scaleX: -1 }] } : null, style]}
      {...(accessibilityLabel
        ? { accessible: true, accessibilityLabel, accessibilityRole: 'image' as const }
        : // react-native-svg forwards unknown props to the DOM on web; hide via aria only.
          Platform.OS === 'web'
          ? ({ 'aria-hidden': true } as object)
          : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
    >
      {glyphElements(iconShapes(name), fill)}
    </Svg>
  );
});
