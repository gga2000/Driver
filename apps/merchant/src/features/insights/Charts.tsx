import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { color } from '@driver/design-tokens';
import { Text, useTheme } from '@driver/ui';
import { useDates } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { activeHours, heatLevel } from './logic';

/** Heat scale: cream well → brand orange → deep amber (five steps, level 0 = no orders). */
export const HEAT = ['', color.primary[100], color.primary[300], color.primary[500], color.primary[700]] as const;

function useWidth(initial = 0): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(initial);
  return [w, (e) => setW(Math.round(e.nativeEvent.layout.width))];
}

/** Ring showing a 0–1 share ("71% جاهز بوقته"). */
export function Ring({ value, size = 96, stroke = 10, tone }: { value: number; size?: number; stroke?: number; tone: string }) {
  const theme = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.colors.surfaceSunken} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={tone}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={`${c * v} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

/**
 * Orders per hour across opening hours (phone, and the strip under the heatmap). In RTL the day
 * reads from the right like the rest of the screen. The busiest window is drawn in brand orange.
 */
export function HourBars({ hours, highlight, height = 150 }: { hours: readonly number[]; highlight: { from: number; to: number } | null; height?: number }) {
  const theme = useTheme();
  const dates = useDates();
  const [width, onLayout] = useWidth();
  const shown = activeHours(hours);
  const max = Math.max(1, ...shown.map((h) => hours[h]!)) * 1.1;
  const labelH = 22;
  const top = 18;
  const plotH = height - labelH - top;
  // Side padding so the first and last hour labels aren't clipped.
  const pad = 24;
  const slot = width > 0 ? (width - 2 * pad) / shown.length : 0;
  const barW = Math.max(4, Math.min(28, slot * 0.62));
  const inWindow = (h: number) => highlight !== null && (highlight.from < highlight.to ? h >= highlight.from && h < highlight.to : h >= highlight.from || h < highlight.to);
  const x = (i: number) => (theme.isRTL ? width - pad - (i + 1) * slot : pad + i * slot) + (slot - barW) / 2;
  const labelEvery = shown.length > 14 ? 3 : 2;
  return (
    <View onLayout={onLayout} style={{ height }} accessibilityRole="image">
      {width > 0 ? (
        <Svg width={width} height={height}>
          {[0.5, 1].map((g) => (
            <Line key={g} x1={0} x2={width} y1={top + plotH * (1 - g)} y2={top + plotH * (1 - g)} stroke={theme.colors.border} strokeDasharray="3 4" strokeWidth={1} />
          ))}
          <Line x1={0} x2={width} y1={top + plotH} y2={top + plotH} stroke={theme.colors.borderStrong} strokeWidth={1} />
          {shown.map((h, i) => {
            const v = hours[h]!;
            const bh = v > 0 ? Math.max(3, (v / max) * plotH) : 0;
            const hot = inWindow(h);
            return (
              <Rect key={h} x={x(i)} y={top + plotH - bh} width={barW} height={bh} rx={Math.min(6, barW / 2)} fill={hot ? theme.colors.accent : color.primary[200]} />
            );
          })}
          {shown.map((h, i) =>
            i % labelEvery === 0 ? (
              <SvgText key={`l${h}`} x={x(i) + barW / 2} y={height - 4} fontSize={11} fill={theme.colors.textMuted} textAnchor="middle" fontFamily="IBM Plex Sans Arabic, system-ui">
                {dates.hour(h)}
              </SvgText>
            ) : null,
          )}
        </Svg>
      ) : null}
    </View>
  );
}

/** Weekday × hour heatmap (tablet). Rows Sunday → Saturday, columns the opening hours. */
export function Heatmap({ grid, hours }: { grid: readonly (readonly number[])[]; hours: readonly number[] }) {
  const theme = useTheme();
  const dates = useDates();
  const t = useT();
  const shown = activeHours(hours);
  const max = Math.max(1, ...grid.flatMap((row) => shown.map((h) => row[h] ?? 0)));
  const labelEvery = shown.length > 14 ? 2 : 1;
  return (
    <View style={{ gap: theme.space[2] }} accessibilityRole="image">
      {grid.map((row, d) => (
        <View key={d} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="caption" color="textMuted" style={{ width: 64 }} numberOfLines={1}>
            {dates.dow(d)}
          </Text>
          <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
            {shown.map((h) => {
              const level = heatLevel(row[h] ?? 0, max);
              return <View key={h} style={{ flex: 1, height: 26, borderRadius: 6, backgroundColor: level === 0 ? theme.colors.surfaceSunken : HEAT[level] }} />;
            })}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ width: 64 }} />
        <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
          {shown.map((h, i) => (
            <Text key={h} variant="caption" color="textMuted" align="center" numberOfLines={1} style={{ flex: 1, fontSize: 10 }}>
              {i % labelEvery === 0 ? dates.hour(h) : ''}
            </Text>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end' }}>
        <Text variant="caption" color="textMuted">
          {t('merchant.insights.peak_less')}
        </Text>
        {[0, 1, 2, 3, 4].map((l) => (
          <View key={l} style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: l === 0 ? theme.colors.surfaceSunken : HEAT[l] }} />
        ))}
        <Text variant="caption" color="textMuted">
          {t('merchant.insights.peak_more')}
        </Text>
      </View>
    </View>
  );
}

/** Weekly rejection rate as columns; the latest week solid, earlier ones lighter. */
export function TrendBars({ values, labels, tone, height = 110 }: { values: readonly (number | null)[]; labels: readonly string[]; tone: string; height?: number }) {
  const theme = useTheme();
  const [width, onLayout] = useWidth();
  const max = Math.max(0.05, ...values.map((v) => v ?? 0));
  const top = 20;
  const labelH = 20;
  const plotH = height - top - labelH;
  const slot = width > 0 ? width / values.length : 0;
  const barW = Math.min(36, slot * 0.5);
  const x = (i: number) => (theme.isRTL ? width - (i + 1) * slot : i * slot) + (slot - barW) / 2;
  return (
    <View onLayout={onLayout} style={{ height }} accessibilityRole="image">
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Line x1={0} x2={width} y1={top + plotH} y2={top + plotH} stroke={theme.colors.border} strokeWidth={1} />
          {values.map((v, i) => {
            const last = i === values.length - 1;
            const bh = v === null ? 0 : Math.max(2, (v / max) * plotH);
            return (
              <Rect key={i} x={x(i)} y={top + plotH - bh} width={barW} height={bh} rx={6} fill={last ? tone : color.neutral[300]} />
            );
          })}
          {values.map((v, i) => (
            <SvgText key={`v${i}`} x={x(i) + barW / 2} y={top + plotH - (v === null ? 0 : Math.max(2, (v / max) * plotH)) - 6} fontSize={11} fontWeight="600" fill={i === values.length - 1 ? theme.colors.text : theme.colors.textMuted} textAnchor="middle" fontFamily="IBM Plex Sans Arabic, system-ui">
              {v === null ? '–' : `${(Math.round(v * 1000) / 10).toString()}%`}
            </SvgText>
          ))}
          {labels.map((l, i) => (
            <SvgText key={`l${i}`} x={x(i) + barW / 2} y={height - 4} fontSize={10} fill={theme.colors.textMuted} textAnchor="middle" fontFamily="IBM Plex Sans Arabic, system-ui">
              {l}
            </SvgText>
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
