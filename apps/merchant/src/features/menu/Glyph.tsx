import { memo } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';

/**
 * Menu and deals glyphs on the same 24-px grid and 1.75-px round stroke as MIcon (camera, photo,
 * pencil, sections, percent…). Any MIcon name works too. Kept in the feature so the shared icon
 * file stays untouched; candidates for MIcon once a second screen needs them.
 */
type Shape = { d: string } | { circle: [number, number, number] } | { rect: [number, number, number, number, number] };

const GLYPHS = {
  camera: [{ d: 'M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.6-2.5h5.4L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z' }, { circle: [12, 12.75, 3.25] }],
  photo: [{ rect: [3.5, 4.5, 17, 15, 2.5] }, { circle: [9, 9.5, 1.75] }, { d: 'm4 17.5 4.8-4.6a1.5 1.5 0 0 1 2.1 0l2.6 2.6 1.6-1.5a1.5 1.5 0 0 1 2.1 0L20 16.8' }],
  pencil: [{ d: 'M4 20h4L19.3 8.7a2.1 2.1 0 0 0 0-3L18.3 4.7a2.1 2.1 0 0 0-3 0L4 16z' }, { d: 'M13.5 6.5l4 4' }],
  trash: [{ d: 'M4.5 7h15' }, { d: 'M9.5 7V4.8a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V7' }, { d: 'M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7' }],
  calendar: [{ rect: [3.5, 5, 17, 15.5, 2.5] }, { d: 'M3.5 10h17M8 3v4M16 3v4' }],
  percent: [{ d: 'M18.5 5.5l-13 13' }, { circle: [7.5, 7.5, 2.5] }, { circle: [16.5, 16.5, 2.5] }],
  layers: [{ d: 'm12 3.5 8.5 4.5-8.5 4.5L3.5 8z' }, { d: 'm3.5 12 8.5 4.5 8.5-4.5' }, { d: 'm3.5 16 8.5 4.5 8.5-4.5' }],
  sort: [{ d: 'M8 4v16M4.5 7.5 8 4l3.5 3.5' }, { d: 'M16 20V4M12.5 16.5 16 20l3.5-3.5' }],
  scan: [{ d: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16' }, { d: 'M8 9h8M8 12h8M8 15h5' }],
  'arrow-up': [{ d: 'M12 19V5M6 11l6-6 6 6' }],
  'arrow-down': [{ d: 'M12 5v14M6 13l6 6 6-6' }],
  history: [{ d: 'M3.5 12a8.5 8.5 0 1 0 2.5-6' }, { d: 'M3.5 4.5V8h3.5' }, { d: 'M12 8v4.25l2.75 1.75' }],
  'trend-up': [{ d: 'm4 16 5-5 3.5 3.5L20 7' }, { d: 'M15 7h5v5' }],
  'trend-down': [{ d: 'm4 8 5 5 3.5-3.5L20 17' }, { d: 'M15 17h5v-5' }],
  pause: [{ rect: [6.5, 5, 3.5, 14, 1] }, { rect: [14, 5, 3.5, 14, 1] }],
  play: [{ d: 'M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L8.7 4.5a.8.8 0 0 0-1.2.7z' }],
  info: [{ circle: [12, 12, 8.5] }, { d: 'M12 11v5.5M12 7.75h.01' }],
  sparkle: [{ d: 'M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z' }, { d: 'M18.5 16v4M16.5 18h4' }],
} satisfies Record<string, Shape[]>;

export type GlyphName = keyof typeof GLYPHS | MIconName;

export const Glyph = memo(function Glyph({ name, size = 24, color = 'text', strokeWidth = 1.75, style }: { name: GlyphName; size?: number; color?: string; strokeWidth?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  if (!(name in GLYPHS)) return <MIcon name={name as MIconName} size={size} color={color} strokeWidth={strokeWidth} style={style} />;
  const shapes: readonly Shape[] = GLYPHS[name as keyof typeof GLYPHS];
  const stroke = (theme.colors as unknown as Record<string, string>)[color] ?? color;
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
        if ('d' in shape) return <Path key={i} d={shape.d} />;
        if ('circle' in shape) return <Circle key={i} cx={shape.circle[0]} cy={shape.circle[1]} r={shape.circle[2]} />;
        const [x, y, w, h, r] = shape.rect;
        return <Rect key={i} x={x} y={y} width={w} height={h} rx={r} />;
      })}
    </Svg>
  );
});
