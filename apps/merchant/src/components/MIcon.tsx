import { memo } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Icon, ICONS, useTheme, type IconName } from '@driver/ui';

/**
 * Kitchen glyphs @driver/ui doesn't have yet (printer, menu, insights…), drawn on the same 24-px grid
 * for 1.75-px round strokes so they sit next to the shared set. Any shared icon name works too.
 * Candidates for the shared set once a second app needs them.
 */
type Shape = { d: string } | { circle: [number, number, number] } | { rect: [number, number, number, number, number] };

const LOCAL = {
  printer: [{ d: 'M7 9V3.5h10V9' }, { rect: [3.5, 9, 17, 8, 2] }, { d: 'M7 14h10v6.5H7z' }, { d: 'M16.5 11.75h.01' }],
  utensils: [{ d: 'M7 3v6.5a2 2 0 0 0 2 2V21' }, { d: 'M11 3v6.5a2 2 0 0 1-2 2' }, { d: 'M9 3v5.5' }, { d: 'M17.5 21V3c-2.2 1.4-3.5 4.2-3.5 7.5V13h3.5' }],
  chart: [{ d: 'M4 20.5h16' }, { rect: [5.5, 12, 3, 5.5, 1] }, { rect: [10.5, 6.5, 3, 11, 1] }, { rect: [15.5, 9.5, 3, 8, 1] }],
  grid: [{ rect: [4, 4, 6.5, 6.5, 1.75] }, { rect: [13.5, 4, 6.5, 6.5, 1.75] }, { rect: [4, 13.5, 6.5, 6.5, 1.75] }, { rect: [13.5, 13.5, 6.5, 6.5, 1.75] }],
  store: [
    { d: 'M4 9.5 5.6 4h12.8L20 9.5' },
    { d: 'M4 9.5a2.67 2.67 0 0 0 5.33 0 2.67 2.67 0 0 0 5.34 0 2.67 2.67 0 0 0 5.33 0' },
    { d: 'M5.5 12.2V20h13v-7.8' },
    { d: 'M10 20v-4.5h4V20' },
  ],
  flame: [{ d: 'M12 21c3.6 0 6-2.4 6-5.6 0-3.6-2.7-5.6-3.7-8.9-.3-1-.4-2.1-.3-3.5-2.8 1.6-4.4 4.2-4.4 7 0 .9.2 1.7.5 2.4-1.1-.4-2-1.3-2.4-2.6C6.6 11.3 6 13.2 6 15.4 6 18.6 8.4 21 12 21z' }],
  power: [{ d: 'M12 3.5v8' }, { d: 'M7.2 6.6a7.5 7.5 0 1 0 9.6 0' }],
  cash: [{ rect: [2.5, 6, 19, 12, 2] }, { circle: [12, 12, 2.6] }, { d: 'M6 9.5v5M18 9.5v5' }],
  volume: [{ d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z' }, { d: 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11' }],
  'volume-off': [{ d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z' }, { d: 'm16 9.5 5 5M21 9.5l-5 5' }],
  screen: [{ rect: [4, 3, 16, 18, 2.5] }, { d: 'M10.5 17.5h3' }, { circle: [12, 10, 2.25] }],
  note: [{ d: 'M5 4h14v10.5L13.5 20H5z' }, { d: 'M13.5 20v-5.5H19' }, { d: 'M8.5 8.5h7M8.5 12h4' }],
  /** Overflow ("more"): the phone board header's store menu (M-06). */
  more: [{ circle: [5.5, 12, 1.4] }, { circle: [12, 12, 1.4] }, { circle: [18.5, 12, 1.4] }],
  /** Allergy / must-read warning (M-09). */
  alert: [{ d: 'M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z' }, { d: 'M12 9.5v4.5' }, { d: 'M12 17.25h.01' }],
  'sign-out': [{ d: 'M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14' }, { d: 'M9.5 8 5.5 12l4 4M5.5 12H15' }],
  people: [{ circle: [9, 8.5, 3.25] }, { d: 'M3 19.5a6 6 0 0 1 12 0' }, { d: 'M15.5 5.4a3.25 3.25 0 0 1 0 6.2M17.5 14a6 6 0 0 1 3.5 5.5' }],
  tag: [{ d: 'M3.5 12.4V4.5a1 1 0 0 1 1-1h7.9l8 8a1.4 1.4 0 0 1 0 2l-7 7a1.4 1.4 0 0 1-2 0z' }, { circle: [8, 8, 1.5] }],
  sliders: [{ d: 'M4 7h9M17 7h3M4 17h3M11 17h9' }, { circle: [15, 7, 2] }, { circle: [9, 17, 2] }],
  bluetooth: [{ d: 'M7 7.5 17 16.5 12 21V3l5 4.5L7 16.5' }],
  swap: [{ d: 'M7 4 4 7l3 3M4 7h12' }, { d: 'M17 14l3 3-3 3M20 17H8' }],
  hourglass: [{ d: 'M6.5 3.5h11M6.5 20.5h11' }, { d: 'M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5' }],
} satisfies Record<string, Shape[]>;

export type LocalIconName = keyof typeof LOCAL;
export type MIconName = LocalIconName | IconName;

export interface MIconProps {
  name: MIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const MIcon = memo(function MIcon({ name, size = 24, color = 'text', strokeWidth = 1.75, filled, style }: MIconProps) {
  const theme = useTheme();
  if (name in ICONS) return <Icon name={name as IconName} size={size} color={color} strokeWidth={strokeWidth} filled={filled} style={style} />;
  const shapes: readonly Shape[] = LOCAL[name as LocalIconName];
  const stroke = (theme.colors as unknown as Record<string, string>)[color] ?? color;
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
      style={style}
      {...(Platform.OS === 'web' ? ({ 'aria-hidden': true } as object) : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
    >
      {shapes.map((shape, i) => {
        if ('d' in shape) return <Path key={i} d={shape.d} fill={fill} />;
        if ('circle' in shape) return <Circle key={i} cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} fill={fill} />;
        const [x, y, w, h, r] = shape.rect;
        return <Rect key={i} x={x} y={y} width={w} height={h} rx={r} fill={fill} />;
      })}
    </Svg>
  );
});
