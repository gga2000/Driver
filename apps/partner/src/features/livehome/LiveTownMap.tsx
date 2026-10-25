import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { CameraRef, LayerProps, MapRef } from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import type { GoldenLight } from '@driver/map/golden';
import { demandGlowLayers } from '@driver/map/pieces/demand';
import { useLiteMode, useTheme } from '@driver/ui';
import { goldenLightFor, LIGHT_CHECK_MS } from '@/features/map/base/golden-map';
import { useMapColors } from '@/features/map/base/mapColors';
import { useGlowCells } from '@/features/map/HeatLayer';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { FlatTownMap } from './FlatTownMap';
import { boundsOf, CAM, DAY_CAM, dayLines, EMPTY, glowRings, livePadding, RIPPLE_MS, rippleAt, rippleLayers, RISE_MS, SRC, trailLayers, TURN_DEG, TURN_MS, turnBearing } from './live-map-shared';
import type { LiveTownMapProps } from './live-map-types';
import { LiveCredit } from './LiveCredit';
import { DayCoin, DayDoor, DayPick, DriverCount, KitchenBubble, MeDot, RiseChip } from './LiveMarkers';
import { nativeCourierStyle, nativeGolden, nativeGoldenImages, nativeMapLibre } from './native-maplibre';
import { coinSides, framingZoom, justReady, newRipples } from './pulse-logic';
import { buildStreetGraph, type LngLat as Pt, type StreetGraph } from './street-route';

/** Phones draw the live home in 3D when the build has the native map and our map's files are set up. */
const GOLDEN = nativeGolden();

/**
 * «المدينة حيّة» on phones: the same 3D Golden map as the web (LiveTownMap.web.tsx) on MapLibre Native.
 * Low-data mode, a build without the native map or our files, or a map that failed: the flat map.
 */
export function LiveTownMap(props: LiveTownMapProps) {
  const lite = useLiteMode();
  const [failed, setFailed] = useState(false);
  const { night } = useMapColors();
  const [light, setLight] = useState<GoldenLight>(() => goldenLightFor(night));
  useEffect(() => {
    setLight(goldenLightFor(night));
    const id = setInterval(() => setLight(goldenLightFor(night)), LIGHT_CHECK_MS);
    return () => clearInterval(id);
  }, [night]);
  if (!GOLDEN || lite || failed) return <FlatTownMap {...props} />;
  return <Golden3DNative {...props} light={light} onFail={() => setFailed(true)} />;
}

type Kitchen = NonNullable<LiveTownMapProps['pulse']>['kitchens'][number];
type Road = { cls: string; coords: Pt[] };

function Golden3DNative({ self, online, pulse, day, glow, topInset, bottomInset, light, onFail }: LiveTownMapProps & { light: GoldenLight; onFail: () => void }) {
  const ml = nativeMapLibre()!;
  const theme = useTheme();
  const t = useT();
  const reduce = theme.reduceMotion;
  const camera = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [roads, setRoads] = useState<Road[]>([]);
  const graph = useRef<StreetGraph | null>(null);
  const cells = useGlowCells(glow);
  const night = light === 'night';

  const style = useMemo(() => nativeCourierStyle(golden, light), [light]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  const roadLayers = useMemo(() => style.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'roads').map((l) => l.id), [style]);
  const under = golden.GOLDEN_FIRST_LABEL;
  const props = (l: object) => ({ ...l, beforeId: under }) as unknown as LayerProps;

  const words = useMemo(
    () => ({
      cooking: t('partner.live_cooking'),
      ready: t('partner.live_ready'),
      cookingA11y: t('partner.live_cooking_a11y'),
      readyA11y: t('partner.live_ready_a11y'),
      newOrder: t('partner.live_new_order'),
      drivers: (n: number) => t(n > 10 ? 'partner.live_drivers_many' : 'partner.live_drivers', { n }),
      coin: (iqd: number) => t('partner.live_coin', { amount: amountParam(iqd, { sign: true }) }),
    }),
    [t],
  );

  /**
   * The camera follows him with native eases, one at a time: a new one stops the one running, so
   * each carries its share of the opening turn and then hands the rest of the turn back. «يومي» and
   * his own finger pause it; the next fix picks it up again.
   */
  const cam = useRef({ follow: true, center: self ? ([self.lng, self.lat] as Pt) : null, zoom: CAM.zoom as number, turnStart: 0, framed: false, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const live = useRef({ size, topInset, bottomInset, reduce });
  live.current = { size, topInset, bottomInset, reduce };
  const padding = () => livePadding(live.current.size.h || 800, live.current.topInset, live.current.bottomInset);
  const move = (ms: number) => {
    const c = cam.current;
    if (!c.follow || !c.center || !camera.current) return;
    clearTimeout(c.timer);
    const quick = live.current.reduce ? 0 : ms;
    const end = Date.now() + quick;
    camera.current.easeTo({ center: c.center, zoom: c.zoom, pitch: CAM.pitch, bearing: turnBearing(c.turnStart, end), padding: padding(), duration: quick, easing: 'ease' });
    const left = c.turnStart + TURN_MS - end;
    if (c.turnStart && left > 300) {
      c.timer = setTimeout(() => {
        if (!c.follow || !c.center) return;
        camera.current?.easeTo({ center: c.center, zoom: c.zoom, pitch: CAM.pitch, bearing: CAM.bearing + TURN_DEG, padding: padding(), duration: Math.max(0, c.turnStart + TURN_MS - Date.now()), easing: 'linear' });
      }, quick + 50);
    }
  };
  useEffect(() => () => clearTimeout(cam.current.timer), []);

  // Open: on him, then the one slow turn.
  useEffect(() => {
    if (!ready || !size.h) return;
    if (!reduce) cam.current.turnStart = Date.now();
    move(600);
  }, [ready, size.h > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each fix: glide to him (unless «يومي» is open).
  useEffect(() => {
    if (!self) return;
    cam.current.center = [self.lng, self.lat];
    if (!ready || day) return;
    cam.current.follow = true;
    move(900);
  }, [self?.lat, self?.lng, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once, when the first kitchens arrive: step back just enough to see the nearest two cooking.
  useEffect(() => {
    const c = cam.current;
    if (!ready || c.framed || !self || !pulse || day || !size.w) return;
    c.framed = true;
    c.zoom = framingZoom(self, pulse.kitchens, size.w / 2);
    move(1200);
  }, [ready, self, pulse, day, size.w]); // eslint-disable-line react-hooks/exhaustive-deps

  // The streets on screen: the shops face them and «يومي» follows them.
  const findRoads = () => {
    if (!roadLayers.length) return;
    void map.current
      ?.queryRenderedFeatures({ layers: roadLayers })
      .then((fs) => {
        const out = golden.roadsFromFeatures(fs) as Road[];
        if (out.length === 0) return;
        setRoads(out);
        graph.current = buildStreetGraph(out.filter((r) => r.cls !== 'alley') as never);
      })
      .catch(() => undefined);
  };

  // The kitchens as 3D shops; their bubbles are markers below.
  const kitchens = useMemo<readonly Kitchen[]>(() => (day || !pulse ? [] : pulse.kitchens), [day, pulse]);
  const scene = useMemo(
    () => golden.restaurantScene(kitchens.map((k) => ({ id: k.id, at: [k.at.lng, k.at.lat] as Pt, facing: golden.faceRoad([k.at.lng, k.at.lat], roads), kind: 'grill' as const })), { light }),
    [kitchens, roads, light],
  );
  const shopLayers = useMemo(() => golden.restaurantLayers(light), [light]);
  const prevKitchens = useRef<Kitchen[] | null>(null);
  const [popped, setPopped] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!pulse || day) return;
    setPopped(justReady(prevKitchens.current, pulse.kitchens));
    prevKitchens.current = pulse.kitchens;
  }, [pulse, day]);

  // New orders by area: a widening ring and «طلب جديد» rising, once per rise.
  const prevAreas = useRef<NonNullable<typeof pulse>['areas'] | null>(null);
  const [rises, setRises] = useState<Array<{ id: string; at: Pt }>>([]);
  const [rings, setRings] = useState<GeoJSON.FeatureCollection>(EMPTY);
  useEffect(() => {
    if (!ready || !pulse || day) return;
    const fresh = newRipples(prevAreas.current, pulse.areas, pulse.at.getTime());
    prevAreas.current = pulse.areas;
    if (fresh.length === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const t0 = Date.now();
    const list = fresh.map((r, i) => ({ id: `${pulse.at.getTime()}-${i}`, at: [r.at.lng, r.at.lat] as Pt, start: t0 + i * 700 }));
    list.forEach((r, i) => {
      timers.push(setTimeout(() => setRises((xs) => [...xs, { id: r.id, at: r.at }]), i * 700));
      timers.push(setTimeout(() => setRises((xs) => xs.filter((x) => x.id !== r.id)), i * 700 + (reduce ? 4000 : RISE_MS)));
    });
    // The ring moves about 15 times a second for a couple of seconds (each step crosses the bridge).
    const id = setInterval(() => {
      const now = Date.now();
      const on = list.filter((r) => now >= r.start && now - r.start < RIPPLE_MS);
      setRings({ type: 'FeatureCollection', features: on.map((r) => ({ type: 'Feature', properties: rippleAt(now - r.start, reduce), geometry: { type: 'Point', coordinates: r.at } })) });
      if (now - t0 > RIPPLE_MS + list.length * 700) {
        clearInterval(id);
        setRings(EMPTY);
      }
    }, 66);
    return () => {
      clearInterval(id);
      for (const x of timers) clearTimeout(x);
    };
  }, [pulse, day, ready, reduce]);

  // «يومي»: each kitchen to its door along the streets, money at each door, the camera over the day.
  const lines = useMemo(() => (day ? dayLines(day, graph.current) : []), [day, roads]); // eslint-disable-line react-hooks/exhaustive-deps
  const sides = useMemo(() => (day ? coinSides(day) : []), [day]);
  const wasDay = useRef(false);
  useEffect(() => {
    if (!ready) return;
    const c = cam.current;
    if (!day) {
      if (!wasDay.current) return;
      wasDay.current = false;
      c.follow = true;
      move(1000);
      return;
    }
    wasDay.current = true;
    c.follow = false;
    clearTimeout(c.timer);
    const bb = boundsOf(lines.flat());
    const pad = padding();
    if (bb) camera.current?.fitBounds([bb[0][0], bb[0][1], bb[1][0], bb[1][1]], { padding: { top: pad.top + 56, bottom: pad.bottom + 24, left: 64, right: 64 }, pitch: DAY_CAM.pitch, bearing: DAY_CAM.bearing, duration: reduce ? 0 : 1200 });
  }, [day, ready, lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const glowData = useMemo(() => (day ? EMPTY : glowRings(online ? cells : [])), [day, online, cells]);
  const trail = useMemo<GeoJSON.FeatureCollection>(() => ({ type: 'FeatureCollection', features: lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) }), [lines]);
  const glowLayers = useMemo(() => demandGlowLayers({ source: SRC.glow, light, id: 'live-glow' }), [light]);
  const bySource = (id: string) => shopLayers.filter((l) => 'source' in l && l.source === id);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const at = self ? ([self.lng, self.lat] as Pt) : null;

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: night ? '#1B120B' : '#EFE3CC' }]} onLayout={onLayout} testID="driver-map-home">
      <ml.Map
        ref={map}
        testID="live-map-3d"
        style={StyleSheet.absoluteFill}
        mapStyle={style}
        attribution={false}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingMap={() => setReady(true)}
        onDidFailLoadingMap={onFail}
        onDidFinishRenderingMapFully={findRoads}
        onRegionWillChange={(e) => {
          if (e.nativeEvent.userInteraction) {
            cam.current.follow = false;
            clearTimeout(cam.current.timer);
          }
        }}
      >
        <ml.Camera ref={camera} maxZoom={19} initialViewState={{ center: cam.current.center ?? [45.06, 32.905], zoom: CAM.zoom, pitch: CAM.pitch, bearing: CAM.bearing }} />
        <ml.Images images={images} />
        <ml.GeoJSONSource id={SRC.glow} data={glowData as GeoJSON.FeatureCollection}>
          {glowLayers.map((l) => (
            <ml.Layer key={l.id} {...props(l)} />
          ))}
        </ml.GeoJSONSource>
        <ml.GeoJSONSource id={SRC.ripples} data={rings}>
          {rippleLayers(night).map((l) => (
            <ml.Layer key={l.id} {...props(l)} />
          ))}
        </ml.GeoJSONSource>
        <ml.GeoJSONSource id={SRC.trail} data={trail} lineMetrics>
          {trailLayers(night).map((l) => (
            <ml.Layer key={l.id} {...props(l)} />
          ))}
        </ml.GeoJSONSource>
        <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.solid} data={scene.solid as GeoJSON.FeatureCollection}>
          {bySource(golden.RESTAURANT_SOURCES.solid).map((l) => (
            <ml.Layer key={l.id} {...props(l)} />
          ))}
        </ml.GeoJSONSource>
        <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.soft} data={scene.soft as GeoJSON.FeatureCollection}>
          {bySource(golden.RESTAURANT_SOURCES.soft).map((l) => (
            <ml.Layer key={l.id} {...props(l)} />
          ))}
        </ml.GeoJSONSource>
        <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.glow} data={scene.glow as GeoJSON.FeatureCollection}>
          {bySource(golden.RESTAURANT_SOURCES.glow).map((l) => (
            <ml.Layer key={l.id} {...props(l)} />
          ))}
        </ml.GeoJSONSource>
        {kitchens.map((k) => (
          <ml.Marker key={`k-${k.id}-${k.state}`} id={`live-kitchen-${k.id}`} lngLat={[k.at.lng, k.at.lat]} anchor="bottom">
            <KitchenBubble ready={k.state === 'ready'} progress={k.progress} popped={popped.has(k.id)} label={k.state === 'ready' ? words.readyA11y : words.cookingA11y} word={k.state === 'ready' ? words.ready : words.cooking} />
          </ml.Marker>
        ))}
        {(day || !pulse ? [] : pulse.drivers).map((d, i) => (
          <ml.Marker key={`d-${i}-${d.at.lat}-${d.at.lng}`} id={`live-drivers-${i}`} lngLat={[d.at.lng, d.at.lat]} anchor="center">
            <DriverCount text={words.drivers(d.n)} />
          </ml.Marker>
        ))}
        {rises.map((r) => (
          <ml.Marker key={r.id} id={`live-rise-${r.id}`} lngLat={r.at} anchor="bottom">
            <RiseChip text={words.newOrder} />
          </ml.Marker>
        ))}
        {(day ?? []).flatMap((s, i) => [
          ...(s.pickup
            ? [
                <ml.Marker key={`p-${s.tripId}`} id={`live-day-pick-${s.tripId}`} lngLat={[s.pickup.lng, s.pickup.lat]} anchor="center">
                  <DayPick />
                </ml.Marker>,
              ]
            : []),
          ...(s.dropoff
            ? [
                <ml.Marker key={`d-${s.tripId}`} id={`live-day-door-${s.tripId}`} lngLat={[s.dropoff.lng, s.dropoff.lat]} anchor="center">
                  <DayDoor />
                </ml.Marker>,
                <ml.Marker key={`c-${s.tripId}`} id={`live-day-coin-${s.tripId}`} lngLat={[s.dropoff.lng, s.dropoff.lat]} anchor={sides[i] === 'below' ? 'top' : 'bottom'}>
                  <DayCoin text={words.coin(s.earnedIqd)} index={i} below={sides[i] === 'below'} />
                </ml.Marker>,
              ]
            : []),
        ])}
        {at ? (
          <ml.Marker id="live-me" lngLat={at} anchor="center">
            <MeDot online={online} faded={day !== null} />
          </ml.Marker>
        ) : null}
      </ml.Map>
      <LiveCredit bottom={bottomInset} />
    </View>
  );
}
