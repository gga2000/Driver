import { memo } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { ThemeColorKey } from '@driver/design-tokens';
import { useTheme } from '../theme/ThemeProvider';
import { ICONS, MIRRORED, type IconName } from './paths';

export interface IconProps {
  name: IconName;
  size?: number;
  /** A theme role (`accentText`) or a raw colour. Defaults to `text`. */
  color?: ThemeColorKey | (string & {});
  strokeWidth?: number;
  /** Fill closed shapes (selected star, active tab). */
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Icons are decorative by default; pass a label only when the icon stands alone. */
  accessibilityLabel?: string;
}

export const Icon = memo(function Icon({ name, size = 24, color = 'text', strokeWidth = 1.75, filled, style, accessibilityLabel }: IconProps) {
  const theme = useTheme();
  const stroke = (theme.colors as unknown as Record<string, string>)[color] ?? color;
  const mirror = theme.isRTL && MIRRORED.has(name);
  const fill = filled ? stroke : 'none';
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
      {ICONS[name].map((shape, i) => {
        if ('d' in shape) return <Path key={i} d={shape.d} fill={fill} />;
        if ('circle' in shape) {
          const [cx, cy, r] = shape.circle;
          return <Circle key={i} cx={cx} cy={cy} r={r} fill={fill} />;
        }
        const [x, y, w, h, r] = shape.rect;
        return <Rect key={i} x={x} y={y} width={w} height={h} rx={r} fill={fill} />;
      })}
    </Svg>
  );
});
