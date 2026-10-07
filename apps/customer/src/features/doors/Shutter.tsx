import { memo } from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { SKETCH } from '@driver/ui';

/**
 * A closed shop's shutter (idea p1, «سوق العزيزية»): the rolling metal shutter pulled most of the way
 * down over the shop's picture, the way the market looks at night, with a small padlock. Drawn over the
 * picture (which still peeks out below), in the sketchbook's fixed pigments. Decoration only: the row
 * says «مسدود · يفتح 5:00» in words.
 */
export const Shutter = memo(function Shutter({ size }: { size: number }) {
  const slats = Array.from({ length: 7 }, (_, i) => 14 + i * 18);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      style={{ position: 'absolute', top: 0, start: 0 }}
      pointerEvents="none"
      aria-hidden
      accessible={false}
    >
      <Rect x={0} y={0} width={200} height={14} fill={SKETCH.wood} />
      <Rect x={0} y={14} width={200} height={128} fill={SKETCH.metal} />
      <G>
        {slats.map((y) => (
          <Path
            key={y}
            d={`M0 ${y + 9}H200`}
            stroke={SKETCH.line}
            strokeWidth={2.4}
            opacity={0.35}
          />
        ))}
        {slats.map((y) => (
          <Path
            key={`l${y}`}
            d={`M0 ${y + 3}H200`}
            stroke={SKETCH.white}
            strokeWidth={2}
            opacity={0.25}
          />
        ))}
      </G>
      <Rect x={0} y={138} width={200} height={10} fill={SKETCH.line} opacity={0.75} />
      <Path d="M92 150v-6a8 8 0 0 1 16 0v6" stroke={SKETCH.line} strokeWidth={3.6} fill="none" />
      <Rect x={88} y={148} width={24} height={20} rx={3} fill={SKETCH.saffron} />
      <Circle cx={100} cy={158} r={2.6} fill={SKETCH.line} />
    </Svg>
  );
});
