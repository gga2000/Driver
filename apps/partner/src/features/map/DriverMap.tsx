import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { decodePolyline } from '@driver/map';
import { Icon, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import type { DemandLevel } from '@driver/contracts';
import { BaseMap } from './base/BaseMap';
import { HeatLayer } from './HeatLayer';
import type { CameraValues } from './base/types';
import { fitCamera, pathD, project, type Camera, type LngLat, type Size } from './geo';
import { color as palette } from '@driver/design-tokens';

const AZIZIYAH: Camera = { lat: 32.905, lng: 45.062, zoom: 13.6 };
const ease = { duration: 700, easing: Easing.inOut(Easing.cubic) };

export interface MapPin {
  at: LngLat;
  /** `garage` and numbered `stop`s: the الرجعة pickup run (maps program d7). */
  kind: 'pickup' | 'dropoff' | 'garage' | 'stop';
  label: string;
  /** The stop's place in the run ("2"), shown instead of an icon. */
  badge?: string;
}

export interface DriverMapProps {
  /** The driver's own position; null hides the puck (no fix yet). */
  self: LngLat | null;
  vehicleIcon: IconName;
  /** Online: accent puck with a radar pulse. Offline: muted puck, no pulse. */
  online: boolean;
  pins?: readonly MapPin[];
  /** Dashed line through these points: straight and honest when there is no road shape. */
  route?: readonly LngLat[];
  /** The road shape (polyline, precision 6; maps program d2): drawn solid instead of the dashed line. */
  road?: string | null;
  /** Busy zones (maps program d5), filled under the puck. */
  heat?: ReadonlyArray<{ zoneId: string; level: DemandLevel }>;
  /** Space covered by overlays at the top and bottom; the camera frames what's between. */
  topInset?: number;
  bottomInset?: number;
  /** Zoom when only the puck is shown. */
  soloZoom?: number;
  /** Closest zoom when framing several points (two pins on the same street stay readable). */
  maxZoom?: number;
  testID?: string;
}

/**
 * The Partner map: base map (MapLibre with the @driver/map style on web, SVG zones on native)
 * plus the driver's puck, job pins and a dashed route, all projected from one camera held in
 * shared values so overlays never drift from the tiles.
 */
export function DriverMap({ self, vehicleIcon, online, pins = [], route = [], road = null, heat, topInset = 0, bottomInset = 0, soloZoom = 15, maxZoom = 16, testID = 'driver-map' }: DriverMapProps) {
  const roadPoints = useMemo(() => (road ? decodePolyline(road) : null), [road]);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const sizeSV = useSharedValue<Size>({ w: 1, h: 1 });
  const lng = useSharedValue(AZIZIYAH.lng);
  const lat = useSharedValue(AZIZIYAH.lat);
  const zoom = useSharedValue(AZIZIYAH.zoom);
  const cam = useMemo(() => ({ lng, lat, zoom }), [lng, lat, zoom]);
  const [drawn, setDrawn] = useState<Camera>(AZIZIYAH);
  const [placed, setPlaced] = useState(false);

  const focus = useMemo(() => [...(self ? [self] : []), ...pins.map((p) => p.at)], [self, pins]);
  const focusKey = focus.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');

  useEffect(() => {
    if (size.w === 0) return;
    const pad = { top: topInset + 56, bottom: bottomInset + 40, left: 56, right: 56 };
    let target: Camera;
    if (focus.length === 0) target = AZIZIYAH;
    else if (focus.length === 1) {
      // Centre the puck in the visible band between the overlays.
      const solo = fitCamera(focus, size, pad, [soloZoom, soloZoom]);
      target = solo;
    } else target = fitCamera(focus, size, pad, [12.5, maxZoom]);
    if (!placed) {
      lng.value = target.lng;
      lat.value = target.lat;
      zoom.value = target.zoom;
      setDrawn(target);
      setPlaced(true);
      return;
    }
    lng.value = withTiming(target.lng, ease);
    lat.value = withTiming(target.lat, ease);
    zoom.value = withTiming(target.zoom, ease);
    const id = setTimeout(() => setDrawn(target), ease.duration + 20);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, size.w, size.h, topInset, bottomInset]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeSV.value = { w: width, h: height };
    setSize({ w: width, h: height });
  };

  return (
    // Map maths are physical (x grows rightwards): lay the map out LTR inside the RTL app.
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden' }]} onLayout={onLayout} testID={testID}>
      {size.w > 0 ? (
        <>
          <BaseMap drawn={drawn} cam={cam} size={size} onUserGestureStart={() => undefined} onUserCamera={setDrawn} />
          {heat && heat.length > 0 ? <HeatLayer drawn={drawn} cam={cam} size={size} zones={heat} /> : null}
          {roadPoints && roadPoints.length > 1 ? <RouteLine cam={cam} size={sizeSV} points={roadPoints} solid /> : route.length > 1 ? <RouteLine cam={cam} size={sizeSV} points={route} /> : null}
          {/* The puck under the pins: a pin's label must never hide behind him. */}
          {self ? <SelfPuck cam={cam} size={sizeSV} at={self} icon={vehicleIcon} online={online} /> : null}
          {pins.map((p) => (
            <Pin key={`${p.kind}-${p.at.lat}-${p.at.lng}`} cam={cam} size={sizeSV} pin={p} />
          ))}
        </>
      ) : null}
    </View>
  );
}

interface LayerProps {
  cam: CameraValues;
  size: SharedValue<Size>;
}

function RouteLine({ cam, size, points, solid = false }: LayerProps & { points: readonly LngLat[]; solid?: boolean }) {
  const theme = useTheme();
  const props = useAnimatedProps(() => {
    const c = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    return { d: pathD(points.map((p) => project(p.lat, p.lng, c, size.value))) };
  }, [points]);
  return (
    <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <AnimatedPath animatedProps={props} stroke={palette.neutral[0]} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeOpacity={0.95} />
      {solid ? (
        // The real road (maps program d2): a solid line on a white casing.
        <AnimatedPath animatedProps={props} stroke={theme.colors.accent} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ) : (
        <AnimatedPath animatedProps={props} stroke={theme.colors.text} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 9" fill="none" />
      )}
    </Svg>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

const PUCK = 120;

function SelfPuck({ cam, size, at, icon, online }: LayerProps & { at: LngLat; icon: IconName; online: boolean }) {
  const theme = useTheme();
  const wave = useSharedValue(0);
  useEffect(() => {
    if (!online || theme.reduceMotion) {
      wave.value = 0;
      return;
    }
    wave.value = 0;
    wave.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1, false);
  }, [online, theme.reduceMotion, wave]);

  const place = useAnimatedStyle(() => {
    const p = project(at.lat, at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - PUCK / 2 }, { translateY: p.y - PUCK / 2 }] };
  }, [at.lat, at.lng]);
  const ring = useAnimatedStyle(() => ({ opacity: online ? 0.55 * (1 - wave.value) : 0, transform: [{ scale: 0.35 + wave.value * 0.65 }] }), [online]);
  const color = online ? theme.colors.accent : theme.colors.textMuted;
  return (
    <Animated.View pointerEvents="none" testID="self-puck" style={[styles.anchor, { width: PUCK, height: PUCK, alignItems: 'center', justifyContent: 'center' }, place]}>
      <Animated.View style={[{ position: 'absolute', width: PUCK, height: PUCK, borderRadius: PUCK / 2, backgroundColor: withAlpha(color, 0.35), borderWidth: 2, borderColor: withAlpha(color, 0.6) }, ring]} />
      <View style={{ position: 'absolute', width: 54, height: 54, borderRadius: 27, backgroundColor: withAlpha(color, 0.18) }} />
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: color,
          borderWidth: 3,
          borderColor: theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: palette.neutral[1000],
          shadowOpacity: 0.22,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        }}
      >
        <Icon name={icon} size={21} color={online ? 'onAccent' : 'surface'} strokeWidth={2.2} />
      </View>
    </Animated.View>
  );
}

const PIN_W = 150;
const PIN_H = 66;

function Pin({ cam, size, pin }: LayerProps & { pin: MapPin }) {
  const theme = useTheme();
  const place = useAnimatedStyle(() => {
    const p = project(pin.at.lat, pin.at.lng, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - PIN_W / 2 }, { translateY: p.y - PIN_H }] };
  }, [pin.at.lat, pin.at.lng]);
  // Light pins (to collect: a kitchen, a garage, a rider on the run); the dark one is the door.
  const pickup = pin.kind !== 'dropoff';
  const fill = pickup ? theme.colors.surface : theme.colors.text;
  const icon: IconName = pin.kind === 'garage' ? 'garage' : pin.kind === 'dropoff' ? 'home' : 'bag';
  return (
    <Animated.View pointerEvents="none" testID={`pin-${pin.kind}${pin.badge ? `-${pin.badge}` : ''}`} style={[styles.anchor, { width: PIN_W, height: PIN_H, alignItems: 'center', justifyContent: 'flex-end' }, place]}>
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 10,
            height: 30,
            borderRadius: 15,
            backgroundColor: fill,
            borderWidth: pickup ? 1.5 : 0,
            borderColor: theme.colors.borderStrong,
            shadowColor: palette.neutral[1000],
            shadowOpacity: 0.16,
            shadowRadius: 5,
            shadowOffset: { width: 0, height: 2 },
            elevation: 3,
            direction: 'rtl',
          }}
        >
          {pin.badge ? (
            <View style={{ minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent }}>
              <Text variant="caption" weight={700} color="onAccent" tabular style={{ fontSize: 11, lineHeight: 14 }}>
                {pin.badge}
              </Text>
            </View>
          ) : (
            <Icon name={icon} size={15} color={pickup ? 'text' : 'surface'} strokeWidth={2.2} />
          )}
          <Text variant="caption" weight={600} color={pickup ? 'text' : 'surface'} numberOfLines={1} style={{ maxWidth: PIN_W - 44 }}>
            {pin.label}
          </Text>
        </View>
        <View style={{ width: 2, height: 10, backgroundColor: pickup ? theme.colors.borderStrong : fill }} />
        <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: -3, backgroundColor: pickup ? theme.colors.text : theme.colors.accent, borderWidth: 2, borderColor: theme.colors.surface }} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({ anchor: { position: 'absolute', left: 0, top: 0 } });
