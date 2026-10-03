import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { resolveColor, type ColorValue } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';

export interface RuleProps {
  /** `dotted` receipt leader, `dashed` tear line, `solid` hairline. */
  kind?: 'solid' | 'dashed' | 'dotted';
  color?: ColorValue;
  thickness?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Horizontal rule drawn with SVG: single-side dashed borders don't render on iOS, so leaders
 * and tear lines can't be borders.
 */
export function Rule({ kind = 'solid', color = 'border', thickness = 1, style }: RuleProps) {
  const theme = useTheme();
  const stroke = resolveColor(theme, color);
  if (kind === 'solid') return <View style={[{ height: thickness, backgroundColor: stroke }, style]} />;
  const dash = kind === 'dotted' ? `0.1 ${thickness * 3.5}` : `${thickness * 4} ${thickness * 3}`;
  return (
    <View style={[{ height: thickness + 1 }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height={thickness + 1}>
        <Line
          x1="0"
          y1={(thickness + 1) / 2}
          x2="100%"
          y2={(thickness + 1) / 2}
          stroke={stroke}
          strokeWidth={thickness}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
