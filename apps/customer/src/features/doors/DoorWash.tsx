import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@driver/ui';

/** The pale wash at the top of a door's page (or the food home), fading into the page: you are behind that door. */
export function DoorWash({ color, height = 320 }: { color: string; height?: number }) {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, start: 0, end: 0, height }}
      aria-hidden
      accessible={false}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="door-wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="0.6" stopColor={color} stopOpacity={0.55} />
            <Stop offset="1" stopColor={theme.colors.bg} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#door-wash)" />
      </Svg>
    </View>
  );
}
