import { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Polygon } from 'react-native-svg';
import type { LatLng } from '@driver/contracts';
import { fitProjection, svgPoints } from '@driver/map';
import { useTheme } from '@driver/ui';
import { mapPoints, MIN_RING_POINTS, type ZoneShade } from './logic';

/** The geometry a zone needs on the map (both the fee map and the customers' map pass their zones). */
export interface MapZone {
  key: string;
  ring: readonly LatLng[];
  centre: LatLng;
}

/** Radius of a zone that has no outline yet (a dot at its centre), px. */
const CENTRE_DOT_R = 6;
/** The kitchen pin: an ink disc with a cream core, like the courier radar's centre. */
const KITCHEN_R = 7;
const KITCHEN_CORE_R = 3;
/** Zone fill strength: the cream between zones still reads as the border. */
const FILL_OPACITY = 0.92;
const SELECTED_STROKE = 3;
const BORDER_STROKE = 1.25;

/**
 * Aziziyah's zones as a plain SVG (no map tiles: the Merchant app has no basemap and a counter tablet
 * stays light), north up and to scale, the kitchen as a pin. Each zone is painted by `shade` — fee bands
 * on «منطقة التوصيل», customers per zone on «منين زبائنك» — and tapping one selects it; the screens
 * also list every zone in rows of 44 px or more, so the small zones are never only a tiny tap target.
 */
export function ZoneMap<Z extends MapZone>({
  zones,
  kitchen,
  shade,
  selectedKey,
  onSelect,
  label,
  testID,
}: {
  zones: readonly Z[];
  kitchen: LatLng | null;
  shade: (zone: Z) => ZoneShade;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  label: string;
  testID?: string;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const projection = useMemo(() => (width > 0 ? fitProjection(mapPoints(zones, kitchen), width) : null), [zones, kitchen, width]);
  // The selected zone is drawn last so its outline sits on top of its neighbours'.
  const ordered = useMemo(() => [...zones].sort((a, b) => Number(a.key === selectedKey) - Number(b.key === selectedKey)), [zones, selectedKey]);
  return (
    // Physical directions (east is right) inside the RTL app.
    <View testID={testID} onLayout={onLayout} accessibilityRole="image" accessibilityLabel={label} style={{ width: '100%', direction: 'ltr' }}>
      {projection ? (
        <Svg width={projection.width} height={projection.height}>
          {ordered.map((z) => {
            const s = shade(z);
            const selected = z.key === selectedKey;
            const stroke = selected ? theme.colors.text : s.dashed ? theme.colors.textMuted : theme.colors.surface;
            const strokeWidth = selected ? SELECTED_STROKE : BORDER_STROKE;
            const press = onSelect ? () => onSelect(z.key) : undefined;
            return (
              <G key={z.key} testID={`zone-${z.key}`}>
                {z.ring.length >= MIN_RING_POINTS ? (
                  <Polygon
                    points={svgPoints(z.ring, projection)}
                    fill={s.fill}
                    fillOpacity={FILL_OPACITY}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    strokeDasharray={s.dashed && !selected ? '4 3' : undefined}
                    strokeLinejoin="round"
                    onPress={press}
                  />
                ) : (
                  <Circle cx={projection.x(z.centre.lng)} cy={projection.y(z.centre.lat)} r={CENTRE_DOT_R} fill={s.fill} stroke={stroke} strokeWidth={strokeWidth} onPress={press} />
                )}
              </G>
            );
          })}
          {kitchen ? (
            <G testID="zone-map-kitchen">
              <Circle cx={projection.x(kitchen.lng)} cy={projection.y(kitchen.lat)} r={KITCHEN_R} fill={theme.colors.text} stroke={theme.colors.surface} strokeWidth={2} />
              <Circle cx={projection.x(kitchen.lng)} cy={projection.y(kitchen.lat)} r={KITCHEN_CORE_R} fill={theme.colors.surface} />
            </G>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
