import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import { sunriseTour } from '@driver/map/pieces';
import { useTheme } from '@driver/ui';
import { nativeGoldenImages, nativeGoldenStyle, nativeMapLibre } from '@/features/track/map/native-maplibre';
import { useProfile } from '@/lib/profile';
import { sunriseCameraAt, sunriseEnd, sunriseLanding, sunriseLegs, sunriseLightAt } from './sunrise';
import { SunriseFrame, SunrisePin } from './SunriseFrame';
import type { WelcomeHomeProps } from './WelcomeDrawing';

/**
 * «الشمس تطلع على العزيزية» (map idea N4) on phones, through MapLibre Native: the same flight as the web
 * (WelcomeSunrise.web.tsx), the map's own `sunriseTour` from the Tigris over the real town, night to day,
 * landing over the person's place. The phone hands each leg of the flight to the map to ease itself, so
 * no camera frame crosses the bridge; the light steps on time and the home pin is the map's own marker.
 * A tap during the flight lands at once; with reduced motion it opens landed on the day map. Shown only
 * where the build has the native map (WelcomeHome.tsx).
 */
export function WelcomeSunrise({ onFail, ...props }: WelcomeHomeProps & { onFail: () => void }) {
  const ml = nativeMapLibre()!;
  const theme = useTheme();
  const prof = useProfile();
  const door = prof.places.find((p) => p.label === 'home' && p.pin)?.pin ?? null;
  const landing = useMemo(() => sunriseLanding(door, props.zoneId), [door, props.zoneId]);
  const tour = useMemo(() => sunriseTour(landing), [landing]);
  const end = useMemo(() => sunriseEnd(tour), [tour]);
  const [landed, setLanded] = useState(theme.reduceMotion);
  const [light, setLight] = useState(() => (theme.reduceMotion ? end.light : sunriseLightAt(tour, 0)));
  const style = useMemo(() => nativeGoldenStyle(golden, light), [light]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  const camera = useRef<CameraRef>(null);
  const first = useRef(theme.reduceMotion ? end.camera : sunriseCameraAt(tour, 0)).current;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const started = useRef(theme.reduceMotion);
  const done = useRef(theme.reduceMotion);

  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => stop, []);

  /** The landing: at the end of the flight the map is already there; a tap mid-flight jumps to it. */
  const land = (skipped: boolean) => {
    if (done.current) return;
    done.current = true;
    stop();
    if (skipped) camera.current?.jumpTo(end.camera);
    setLight(end.light);
    setLanded(true);
  };

  // The flight starts once the first map is in (a later light's map loading again doesn't restart it).
  const fly = () => {
    if (started.current) return;
    started.current = true;
    for (const leg of sunriseLegs(tour)) timers.current.push(setTimeout(() => camera.current?.easeTo({ ...leg.to, duration: leg.durationMs, easing: 'ease' }), leg.atMs));
    for (const step of tour.lights) if (step.atMs > 0) timers.current.push(setTimeout(() => setLight(step.light), step.atMs));
    timers.current.push(setTimeout(() => land(false), tour.totalMs));
  };

  const map = (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.bg }]}>
      <ml.Map
        style={StyleSheet.absoluteFill}
        mapStyle={style}
        attribution={false}
        logo={false}
        compass={false}
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        doubleTapHoldZoom={false}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingMap={fly}
        onDidFailLoadingMap={onFail}
      >
        <ml.Camera ref={camera} initialViewState={first} />
        <ml.Images images={images} />
        <ml.Marker id="welcome-home-pin" lngLat={landing} anchor="bottom">
          <SunrisePin landed={landed} />
        </ml.Marker>
      </ml.Map>
    </View>
  );
  return <SunriseFrame {...props} door={door} landed={landed} onLand={() => land(true)} map={map} />;
}
