import { View } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';

/**
 * The torn top edge of a paper ticket (redesign step 1, idea j2): a row of small scallops in the
 * ticket's own colour rising above its top, so the screen ticket matches the printed 80 mm one.
 * Decorative only: hidden from screen readers and never catches a tap.
 */
export function TornEdge({ color, height = 6 }: { color: string; height?: number }) {
  const id = `tear-${color.replace('#', '')}`;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: -height, start: 0, end: 0, height }}>
      <Svg width="100%" height={height}>
        <Defs>
          <Pattern id={id} x={0} y={0} width={10} height={height} patternUnits="userSpaceOnUse">
            <Circle cx={5} cy={height} r={height - 1.2} fill={color} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height={height} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
