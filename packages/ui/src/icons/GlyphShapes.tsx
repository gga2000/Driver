import { memo, type ReactElement } from 'react';
import { Circle, G, Path, Rect } from 'react-native-svg';

/** A stroke shape on the 24 × 24 icon grid (an `IconShape`, or a map glyph from `@driver/map`). */
export type GlyphShape = { d: string } | { circle: readonly [number, number, number] } | { rect: readonly [number, number, number, number, number] };

/** The shapes as react-native-svg elements; `fill` closes them (selected icons). */
export function glyphElements(shapes: readonly GlyphShape[], fill: string): ReactElement[] {
  return shapes.map((shape, i) => {
    if ('d' in shape) return <Path key={i} d={shape.d} fill={fill} />;
    if ('circle' in shape) {
      const [cx, cy, r] = shape.circle;
      return <Circle key={i} cx={cx} cy={cy} r={r} fill={fill} />;
    }
    const [x, y, w, h, r] = shape.rect;
    return <Rect key={i} x={x} y={y} width={w} height={h} rx={r} fill={fill} />;
  });
}

export interface GlyphShapesProps {
  shapes: readonly GlyphShape[];
  /** Centre of the glyph in the parent `<Svg>`, px. */
  x: number;
  y: number;
  /** Drawn size, px (the 24-px grid is scaled to it). */
  size: number;
  /** A resolved colour (the caller picks it from design tokens). */
  color: string;
  /** In grid units, like `Icon`'s (it scales with the glyph). */
  strokeWidth?: number;
}

/**
 * Icon shapes drawn inside an existing `<Svg>` — many small glyphs in one map layer (maps program b3:
 * landmark badges) without an `<Svg>` element each, as `Icon` would need.
 */
export const GlyphShapes = memo(function GlyphShapes({ shapes, x, y, size, color, strokeWidth = 1.75 }: GlyphShapesProps) {
  const scale = size / 24;
  return (
    <G transform={`translate(${x - size / 2} ${y - size / 2}) scale(${scale})`} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {glyphElements(shapes, 'none')}
    </G>
  );
});
