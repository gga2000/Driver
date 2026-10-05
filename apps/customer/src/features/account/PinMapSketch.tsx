import { useState } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { AZIZIYAH_ZONES, type LatLng } from '@driver/contracts';
import { useTheme, withAlpha } from '@driver/ui';
import { useLocale } from '@/lib/i18n';
import { zoneName } from '@/lib/profile';
import { AZIZIYAH_BOX, project, unproject } from './geo';

export interface PinMapProps {
  pin: LatLng | null;
  zoneId: string | null;
  onPin: (p: LatLng) => void;
  accessibilityLabel: string;
  testID?: string;
}

export const PIN_MAP_HEIGHT = 300;

/**
 * The pin picker's "simple map": the 34 zones as soft discs on a schematic of Aziziyah. Tap to drop
 * the pin; the chosen zone is highlighted. Native uses it until `@maplibre/maplibre-react-native` is in
 * a dev-client build (same as the tracking map); the web uses it only when WebGL is unavailable.
 */
export function PinMapSketch({ pin, zoneId, onPin, accessibilityLabel, testID }: PinMapProps) {
  const theme = useTheme();
  const locale = useLocale();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const onPress = (e: GestureResponderEvent) => {
    if (!width) return;
    const { locationX, locationY } = e.nativeEvent;
    onPin(unproject(locationX, locationY, width, PIN_MAP_HEIGHT));
  };
  // px per metre across the box (longitude span × ~93.4 km per degree here)
  const scale = width ? width / ((AZIZIYAH_BOX.maxLng - AZIZIYAH_BOX.minLng) * 93_400) : 0;
  const selected = zoneId ? AZIZIYAH_ZONES.find((z) => z.id === zoneId) : undefined;
  const label = selected && width ? project({ lat: selected.lat, lng: selected.lng }, width, PIN_MAP_HEIGHT) : null;
  const marker = pin && width ? project(pin, width, PIN_MAP_HEIGHT) : null;

  return (
    <View
      testID={testID}
      onLayout={onLayout}
      style={{ height: PIN_MAP_HEIGHT, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken, borderWidth: 1, borderColor: theme.colors.border }}
    >
      <Pressable accessibilityRole="adjustable" accessibilityLabel={accessibilityLabel} onPress={onPress} style={{ flex: 1 }}>
        {width ? (
          <Svg width={width} height={PIN_MAP_HEIGHT} pointerEvents="none">
            <Rect x={0} y={0} width={width} height={PIN_MAP_HEIGHT} fill={theme.colors.surfaceSunken} />
            {/* The Tigris runs along the town's south-west edge: a cue for orientation, not geography. */}
            <Path d={`M ${-10} ${PIN_MAP_HEIGHT * 0.86} C ${width * 0.3} ${PIN_MAP_HEIGHT * 0.78}, ${width * 0.55} ${PIN_MAP_HEIGHT * 1.02}, ${width + 10} ${PIN_MAP_HEIGHT * 0.9}`} stroke={withAlpha(theme.colors.info, 0.35)} strokeWidth={10} fill="none" />
            {AZIZIYAH_ZONES.map((z) => {
              const c = project({ lat: z.lat, lng: z.lng }, width, PIN_MAP_HEIGHT);
              const on = z.id === zoneId;
              return (
                <G key={z.id}>
                  <Circle
                    cx={c.x}
                    cy={c.y}
                    r={Math.max(6, z.radiusM * scale)}
                    fill={on ? withAlpha(theme.colors.accent, 0.28) : withAlpha(theme.colors.text, 0.06)}
                    stroke={on ? theme.colors.accent : withAlpha(theme.colors.text, 0.14)}
                    strokeWidth={on ? 1.5 : 1}
                  />
                </G>
              );
            })}
            {label && selected ? (
              <G>
                {/* halo under the label, then the label */}
                <SvgText x={label.x} y={label.y + Math.max(6, selected.radiusM * scale) + 16} fontSize={13} fontWeight="700" fontFamily="IBM Plex Sans Arabic" fill={theme.colors.surfaceSunken} stroke={theme.colors.surfaceSunken} strokeWidth={4} textAnchor="middle">
                  {zoneName(selected.id, locale)}
                </SvgText>
                <SvgText x={label.x} y={label.y + Math.max(6, selected.radiusM * scale) + 16} fontSize={13} fontWeight="700" fontFamily="IBM Plex Sans Arabic" fill={theme.colors.accentText} textAnchor="middle">
                  {zoneName(selected.id, locale)}
                </SvgText>
              </G>
            ) : null}
            {marker ? (
              <G x={marker.x} y={marker.y}>
                <Circle cx={0} cy={0} r={14} fill={withAlpha(theme.colors.accent, 0.22)} />
                <Path d="M0 0 C -9 -12 -11 -16 -11 -21 a11 11 0 0 1 22 0 c0 5 -2 9 -11 21z" fill={theme.colors.accent} stroke={theme.colors.text} strokeWidth={1.5} />
                <Circle cx={0} cy={-21} r={4} fill={theme.colors.surface} />
              </G>
            ) : null}
          </Svg>
        ) : null}
      </Pressable>
    </View>
  );
}
