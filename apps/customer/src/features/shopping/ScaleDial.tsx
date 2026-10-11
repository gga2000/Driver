import { useMemo, useRef } from 'react';
import { PanResponder, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@driver/ui';
import { useShopping } from './palette';
import { kilosLabel, snapWeight, WEIGHT_MAX_G, WEIGHT_STEP_G } from './weight';

const W = 320;
const H = 184;
const CX = W / 2;
const CY = 168;
const R = 140;

/** The point on the dial for `grams`: 0 sits on the right (where Arabic starts), the most on the left. */
function pointAt(grams: number, radius = R): { x: number; y: number } {
  const angle = (grams / WEIGHT_MAX_G) * Math.PI;
  return { x: CX + radius * Math.cos(angle), y: CY - radius * Math.sin(angle) };
}

/** The arc from the empty end to `grams`, as an SVG path (always the upper half, never a full turn). */
function arcTo(grams: number): string {
  const start = pointAt(0);
  const end = pointAt(grams);
  return `M ${start.x} ${start.y} A ${R} ${R} 0 0 0 ${end.x} ${end.y}`;
}

/** The weight a touch on the dial means: its angle round the hub, snapped to a quarter kilo. */
function gramsAt(x: number, y: number): number {
  const angle = Math.atan2(Math.max(0, CY - y), x - CX);
  return snapWeight((Math.min(Math.PI, Math.max(0, angle)) / Math.PI) * WEIGHT_MAX_G);
}

export interface ScaleDialProps {
  grams: number;
  onChange: (grams: number) => void;
  /** Read by screen readers before the value («ميزان»). */
  accessibilityLabel: string;
  /** The value as words («كيلو ونص»), for screen readers. */
  valueText: string;
}

/**
 * The stall's scale (round 2, Ali 2026-10-11): a half dial from nothing on the right to 3 kilos on the
 * left. Drag the knob, or anywhere on the dial; it snaps to a quarter kilo with a tick of the phone at
 * each step. Screen readers get it as an adjustable control (swipe up/down a quarter kilo). The SVG is
 * drawn in physical coordinates, so it reads the same on phones (forced RTL) and the web.
 */
export function ScaleDial({ grams, onChange, accessibilityLabel, valueText }: ScaleDialProps) {
  const theme = useTheme();
  const shop = useShopping();
  const width = useRef(W);
  const last = useRef(grams);
  last.current = grams;

  const pan = useMemo(() => {
    const move = (e: GestureResponderEvent) => {
      const scale = W / (width.current || W);
      const next = gramsAt(e.nativeEvent.locationX * scale, e.nativeEvent.locationY * scale);
      if (next !== last.current) {
        last.current = next;
        theme.haptic('selection');
        onChange(next);
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: move,
      onPanResponderMove: move,
    });
  }, [onChange, theme]);

  const ticks = useMemo(() => {
    const out: { g: number; major: boolean }[] = [];
    for (let g = 0; g <= WEIGHT_MAX_G; g += WEIGHT_STEP_G) out.push({ g, major: g % 500 === 0 });
    return out;
  }, []);
  const face = theme.font(700);
  const knob = pointAt(grams);
  const needle = pointAt(grams, R - 64);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: valueText }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const step = e.nativeEvent.actionName === 'increment' ? WEIGHT_STEP_G : -WEIGHT_STEP_G;
        onChange(snapWeight(grams + step));
      }}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
      }}
      style={{ width: '100%', maxWidth: W, aspectRatio: W / H, alignSelf: 'center' }}
      {...pan.panHandlers}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
        <Path
          d={arcTo(WEIGHT_MAX_G)}
          fill="none"
          stroke={theme.colors.border}
          strokeWidth={12}
          strokeLinecap="round"
        />
        {grams > 0 ? (
          <Path
            d={arcTo(grams)}
            fill="none"
            stroke={shop.fill}
            strokeWidth={12}
            strokeLinecap="round"
          />
        ) : null}
        {ticks.map(({ g, major }) => {
          const a = pointAt(g, R - 14);
          const b = pointAt(g, R - (major ? 34 : 24));
          return (
            <Line
              key={g}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={g <= grams ? shop.fill : theme.colors.borderStrong}
              strokeWidth={major ? 3 : 2}
              strokeLinecap="round"
            />
          );
        })}
        {ticks
          .filter((t) => t.g % 500 === 0)
          .map(({ g }) => {
            const p = pointAt(g, R - 54);
            return (
              <SvgText
                key={`l${g}`}
                x={p.x}
                y={p.y + 5}
                textAnchor="middle"
                fontSize={14}
                fontWeight={face.fontWeight}
                fontFamily={face.fontFamily}
                fill={theme.colors.textMuted}
              >
                {kilosLabel(g)}
              </SvgText>
            );
          })}
        <Line
          x1={CX}
          y1={CY}
          x2={needle.x}
          y2={needle.y}
          stroke={theme.colors.text}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <Circle cx={CX} cy={CY} r={9} fill={theme.colors.text} />
        <Circle
          cx={knob.x}
          cy={knob.y}
          r={15}
          fill={theme.colors.surface}
          stroke={shop.fill}
          strokeWidth={5}
        />
      </Svg>
    </View>
  );
}
