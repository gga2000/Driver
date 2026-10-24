import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap, Marker, StyleSpecification } from 'maplibre-gl';
import { RTL_TEXT_PLUGIN_URL } from '@driver/map';
import type { GoldenLight } from '@driver/map/golden';
import { demandGlowLayers } from '@driver/map/pieces/demand';
import { ICONS, useLiteMode, useTheme, type IconName } from '@driver/ui';
import { goldenLightFor, MAP_URLS } from '@/features/map/base/golden-map';
import { useMapColors } from '@/features/map/base/mapColors';
import { useGlowCells } from '@/features/map/HeatLayer';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { FlatTownMap } from './FlatTownMap';
import { boundsOf, CAM, DAY_CAM, dayLines, EMPTY, glowRings, LIFE_MS, livePadding, RIPPLE_MS, rippleAt, rippleLayers, RISE_MS, SRC, trailLayers, TURN_MS, turnBearing } from './live-map-shared';
import type { LiveTownMapProps } from './live-map-types';
import { LiveCredit } from './LiveCredit';
import { coinSides, framingZoom, justReady, newRipples } from './pulse-logic';
import { buildStreetGraph, type LngLat as Pt, type StreetGraph } from './street-route';

type Golden = typeof import('@driver/map/golden');

/** The 3D Golden map needs our tiles and letters (set at build time). */
const GOLDEN = Boolean(MAP_URLS.tilesUrl && MAP_URLS.glyphsUrl);

/**
 * «المدينة حيّة» on the web: the concept Ali picked (A, 2026-10-21 board; built 2026-10-22), on the
 * Golden hour map with its houses in 3D. A close tilted view on him; the kitchens near him stand as
 * 3D shops with a bubble over them («يطبخ» with a filling ring, saffron «جاهز»); a ring and «طلب جديد»
 * rise where an area got new orders; «3 سواق» counts drivers per part of town (never a dot per
 * driver); cars and people on the street. The camera turns slowly once and stops; the street moves
 * for a while and parks. With reduce motion, nothing moves. Low-data mode, a failed map or a build
 * without our tiles: the flat map (`FlatTownMap`).
 */
export function LiveTownMap(props: LiveTownMapProps) {
  const lite = useLiteMode();
  const [failed, setFailed] = useState(false);
  const { night } = useMapColors();
  if (!GOLDEN || lite || failed) return <FlatTownMap {...props} />;
  // A new light (sunset, «شكل الشاشة») builds the map again with that light's style and pieces.
  return <Golden3D key={goldenLightFor(night)} {...props} light={goldenLightFor(night)} onFail={() => setFailed(true)} />;
}

let goldenReady: Promise<void> | null = null;
/** Once per page: the `pmtiles://` protocol and right-to-left shaping for the Arabic street names. */
function prepare(maplibregl: typeof import('maplibre-gl')): Promise<void> {
  goldenReady ??= import('pmtiles').then(({ Protocol }) => {
    try {
      maplibregl.addProtocol('pmtiles', new Protocol().tile);
    } catch {
      // Already added by another map on this page.
    }
    if (maplibregl.getRTLTextPluginStatus() === 'unavailable') void maplibregl.setRTLTextPlugin(RTL_TEXT_PLUGIN_URL, true).catch(() => undefined);
  });
  return goldenReady;
}

function svg(name: IconName, size = 15): string {
  const parts = (ICONS[name] ?? []) as ReadonlyArray<{ d?: string; circle?: number[]; rect?: number[] }>;
  const inner = parts
    .map((s) => (s.d ? `<path d="${s.d}"/>` : s.circle ? `<circle cx="${s.circle[0]}" cy="${s.circle[1]}" r="${s.circle[2]}"/>` : s.rect ? `<rect x="${s.rect[0]}" y="${s.rect[1]}" width="${s.rect[2]}" height="${s.rect[3]}" rx="${s.rect[4]}"/>` : ''))
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** A marker's element: a bare wrapper MapLibre positions (its transform), holding our styled, animated piece. */
function el(html: string, label?: string): HTMLElement {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  if (label) {
    d.setAttribute('role', 'img');
    d.setAttribute('aria-label', label);
  }
  return d;
}

interface Golden3DProps extends LiveTownMapProps {
  light: GoldenLight;
  onFail: () => void;
}

function Golden3D({ self, online, pulse, day, glow, topInset, bottomInset, light, onFail }: Golden3DProps) {
  const theme = useTheme();
  const t = useT();
  const reduce = theme.reduceMotion;
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const libRef = useRef<typeof import('maplibre-gl') | null>(null);
  const goldenRef = useRef<Golden | null>(null);
  const graphRef = useRef<StreetGraph | null>(null);
  const roadsRef = useRef<Array<{ cls: string; coords: Pt[] }>>([]);
  const [ready, setReady] = useState(false);
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const live = useRef({ self, topInset, bottomInset, day: day !== null });
  live.current = { self, topInset, bottomInset, day: day !== null };
  const cells = useGlowCells(glow);

  // Words on the map, in the app's language.
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

  // The map, once.
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden')])
      .then(async ([mod, golden]) => {
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        await prepare(maplibregl);
        if (cancelled || !container.current) return;
        libRef.current = maplibregl;
        goldenRef.current = golden;
        const { style } = golden.chooseMapStyle({ ...MAP_URLS, mode: 'courier', light });
        const at = live.current.self ?? { lat: 32.905, lng: 45.06 };
        try {
          map = new maplibregl.Map({
            container: container.current,
            style: style as unknown as StyleSpecification,
            center: [at.lng, at.lat],
            ...CAM,
            attributionControl: false,
            fadeDuration: 0,
            dragRotate: false,
            touchPitch: false,
          });
        } catch {
          failRef.current();
          return;
        }
        mapRef.current = map;
        const m = map;
        m.setPadding(livePadding(container.current.clientHeight, live.current.topInset, live.current.bottomInset));
        m.on('styleimagemissing', (e: { id: string }) => {
          const img = golden.goldenImages(light)[e.id];
          if (img && !m.hasImage(e.id)) m.addImage(e.id, img);
        });
        // Our tiles did not answer: the flat map instead.
        const stop = golden.fallBackToOriginalMap(m as never, { onFallback: () => failRef.current() });
        m.on('remove', stop);
        m.on('error', () => undefined);
        m.once('load', () => {
          const under = m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined;
          m.addSource(SRC.glow, { type: 'geojson', data: EMPTY });
          for (const l of demandGlowLayers({ source: SRC.glow, light, id: 'live-glow' })) m.addLayer(l as never, under);
          m.addSource(SRC.ripples, { type: 'geojson', data: EMPTY });
          for (const l of rippleLayers(light === 'night')) m.addLayer(l as never, under);
          m.addSource(SRC.trail, { type: 'geojson', lineMetrics: true, data: EMPTY });
          for (const l of trailLayers(light === 'night')) m.addLayer(l as never, under);
          for (const id of Object.values(golden.RESTAURANT_SOURCES)) m.addSource(id, { type: 'geojson', data: EMPTY });
          for (const l of golden.restaurantLayers(light)) m.addLayer(l as never, under);
          // The streets on screen: for the shops' fronts, the street life and «يومي»'s way along the streets.
          m.once('idle', () => {
            const feats = m.querySourceFeatures(golden.GOLDEN_SOURCE, { sourceLayer: 'roads' });
            const roads = golden.roadsFromFeatures(feats);
            roadsRef.current = roads as never;
            graphRef.current = buildStreetGraph(roads.filter((r) => r.cls !== 'alley') as never);
            if (!cancelled) setReady(true);
          });
        });
      })
      .catch(() => failRef.current());
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // The map is built once per light (the parent keys it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The covered top and bottom move the centre into the band he sees.
  useEffect(() => {
    mapRef.current?.setPadding(livePadding(container.current?.clientHeight ?? 800, topInset, bottomInset));
  }, [topInset, bottomInset]);

  // Him: the saffron dot with a soft breathing ring while he works.
  const meRef = useRef<Marker | null>(null);
  const framed = useRef(false);
  /**
   * The camera has ONE mover while it follows him: this loop glides centre, zoom and tilt to where they
   * should be and plays the opening turn by the clock. MapLibre's own eases cancel each other (a GPS fix
   * would stop the turn half way, or the turn the centring), so the home never stacks them. «يومي» and his
   * own finger pause it; the next fix picks it up again.
   */
  const cam = useRef({ follow: true, center: null as Pt | null, zoom: CAM.zoom as number, turnStart: 0, raf: 0, last: 0 });
  const kick = () => {
    const m = mapRef.current;
    const c = cam.current;
    if (!m || !c.follow || !c.center) return;
    const bearingNow = (now: number) => turnBearing(c.turnStart, now);
    if (reduce) {
      m.jumpTo({ center: c.center, zoom: c.zoom, pitch: CAM.pitch, bearing: bearingNow(performance.now()) });
      return;
    }
    if (c.raf) return;
    c.last = performance.now();
    const step = (now: number) => {
      c.raf = 0;
      if (!c.follow || !c.center || mapRef.current !== m) return;
      const k = 1 - Math.exp(-(now - c.last) / 280);
      c.last = now;
      const at = m.getCenter();
      const lng = at.lng + (c.center[0] - at.lng) * k;
      const lat = at.lat + (c.center[1] - at.lat) * k;
      const zoom = m.getZoom() + (c.zoom - m.getZoom()) * k;
      const pitch = m.getPitch() + (CAM.pitch - m.getPitch()) * k;
      // The short way round (MapLibre keeps bearings within ±180).
      const turn = ((((bearingNow(now) - m.getBearing()) % 360) + 540) % 360) - 180;
      const bearing = m.getBearing() + turn * k;
      m.jumpTo({ center: [lng, lat], zoom, pitch, bearing });
      const turning = c.turnStart > 0 && now - c.turnStart < TURN_MS;
      const settled = Math.abs(c.center[0] - lng) < 1e-6 && Math.abs(c.center[1] - lat) < 1e-6 && Math.abs(c.zoom - zoom) < 0.005 && Math.abs(CAM.pitch - pitch) < 0.05 && Math.abs(turn * (1 - k)) < 0.05;
      if (turning || !settled) c.raf = requestAnimationFrame(step);
    };
    c.raf = requestAnimationFrame(step);
  };
  const pause = () => {
    cam.current.follow = false;
    cancelAnimationFrame(cam.current.raf);
    cam.current.raf = 0;
  };
  // His finger on the map: he looks around; the next fix brings the camera back to him.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const off = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) pause();
    };
    const c = cam.current;
    m.on('dragstart', off);
    m.on('zoomstart', off);
    return () => {
      m.off('dragstart', off);
      m.off('zoomstart', off);
      cancelAnimationFrame(c.raf);
    };
  }, [ready]);
  useEffect(() => {
    const m = mapRef.current;
    const lib = libRef.current;
    if (!m || !lib || !ready) return;
    if (!self) {
      meRef.current?.remove();
      meRef.current = null;
      return;
    }
    if (!meRef.current) meRef.current = new lib.Marker({ element: el(`<div class="lv-me ${online ? 'on' : ''}" data-testid="live-me"><div class="lv-ring"></div><div class="lv-dot">${svg('location-arrow', 16)}</div></div>`), anchor: 'center' });
    meRef.current.getElement().firstElementChild?.classList.toggle('on', online);
    meRef.current.setLngLat([self.lng, self.lat]).addTo(m);
    cam.current.center = [self.lng, self.lat];
    if (live.current.day) return;
    cam.current.follow = true;
    kick();
  }, [self?.lat, self?.lng, online, ready, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  // One slow turn and a while of street life when the home opens.
  useEffect(() => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    if (!m || !golden || !ready) return;
    if (!reduce) {
      cam.current.turnStart = performance.now();
      kick();
    }
    const life = golden.streetLife(roadsRef.current as never, { light, moving: !reduce, seed: 3 });
    m.addSource(SRC.life, { type: 'geojson', data: golden.lifeFrame(life, 0) as never });
    for (const l of golden.goldenLifeLayers({ source: SRC.life })) m.addLayer({ ...(l as object), minzoom: 15.4 } as never, m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined);
    if (reduce) return;
    const t0 = performance.now();
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const t = now - t0;
      // About 15 frames a second is enough for cars at walking pace on a phone screen.
      if (now - last > 66 && document.visibilityState === 'visible') {
        last = now;
        m.getSource<GeoJSONSource>(SRC.life)?.setData(golden.lifeFrame(life, t / 1000) as never);
      }
      if (t < LIFE_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once, when the first kitchens arrive: step back just enough to see the nearest two cooking.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || framed.current || !self || !pulse || day) return;
    framed.current = true;
    cam.current.zoom = framingZoom(self, pulse.kitchens, (container.current?.clientWidth ?? 390) / 2);
    kick();
  }, [ready, self, pulse, day, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  // The faint busy-area glow.
  useEffect(() => {
    if (!ready) return;
    mapRef.current?.getSource<GeoJSONSource>(SRC.glow)?.setData((day ? EMPTY : glowRings(online ? cells : [])) as never);
  }, [cells, online, day, ready]);

  // The kitchens: 3D shops with their bubbles.
  const kitchenMarkers = useRef(new Map<string, Marker>());
  const prevKitchens = useRef<NonNullable<typeof pulse>['kitchens'] | null>(null);
  useEffect(() => {
    const m = mapRef.current;
    const lib = libRef.current;
    const golden = goldenRef.current;
    if (!m || !lib || !golden || !ready) return;
    const list = day || !pulse ? [] : pulse.kitchens;
    const scene = golden.restaurantScene(
      list.map((k) => ({ id: k.id, at: [k.at.lng, k.at.lat] as [number, number], facing: golden.faceRoad([k.at.lng, k.at.lat], roadsRef.current as never), kind: 'grill' as const })),
      { light },
    );
    m.getSource<GeoJSONSource>(golden.RESTAURANT_SOURCES.solid)?.setData(scene.solid as never);
    m.getSource<GeoJSONSource>(golden.RESTAURANT_SOURCES.soft)?.setData(scene.soft as never);
    m.getSource<GeoJSONSource>(golden.RESTAURANT_SOURCES.glow)?.setData(scene.glow as never);
    const popped = justReady(prevKitchens.current, list);
    if (pulse && !day) prevKitchens.current = pulse.kitchens;
    const seen = new Set<string>();
    for (const k of list) {
      seen.add(k.id);
      const html =
        k.state === 'ready'
          ? `<div class="lv-bub ready ${popped.has(k.id) ? 'pop' : ''}" data-testid="live-kitchen-ready">${svg('check')}${words.ready}</div>`
          : `<div class="lv-bub ring" data-testid="live-kitchen-cooking"><div class="lv-prog" style="--p:${Math.round((k.progress ?? 0) * 100)}%"><i></i></div><span class="fl">${svg('flame')}</span>${words.cooking}</div>`;
      const label = k.state === 'ready' ? words.readyA11y : words.cookingA11y;
      const old = kitchenMarkers.current.get(k.id);
      const key = `${k.state}:${k.progress ?? ''}`;
      if (old && old.getElement().dataset.key === key) continue;
      old?.remove();
      const node = el(html, label);
      node.dataset.key = key;
      kitchenMarkers.current.set(k.id, new lib.Marker({ element: node, anchor: 'bottom', offset: [0, -16] }).setLngLat([k.at.lng, k.at.lat]).addTo(m));
    }
    for (const [id, mk] of kitchenMarkers.current) {
      if (!seen.has(id)) {
        mk.remove();
        kitchenMarkers.current.delete(id);
      }
    }
  }, [pulse, day, ready, words, light]);

  // Drivers per part of town: a small count, never a dot per driver.
  const driverMarkers = useRef<Marker[]>([]);
  useEffect(() => {
    const m = mapRef.current;
    const lib = libRef.current;
    if (!m || !lib || !ready) return;
    for (const mk of driverMarkers.current) mk.remove();
    driverMarkers.current = (day || !pulse ? [] : pulse.drivers).map((d) =>
      new lib.Marker({ element: el(`<div class="lv-drv" data-testid="live-drivers">${svg('bike', 13)}<span>${words.drivers(d.n)}</span></div>`), anchor: 'center' }).setLngLat([d.at.lng, d.at.lat]).addTo(m),
    );
  }, [pulse, day, ready, words]);

  // New orders by area: a ring on the map and «طلب جديد» rising, once per rise.
  const prevAreas = useRef<NonNullable<typeof pulse>['areas'] | null>(null);
  const ripples = useRef<Array<{ at: Pt; t0: number }>>([]);
  useEffect(() => {
    const m = mapRef.current;
    const lib = libRef.current;
    if (!m || !lib || !ready || !pulse || day) return;
    const fresh = newRipples(prevAreas.current, pulse.areas, pulse.at.getTime());
    prevAreas.current = pulse.areas;
    if (fresh.length === 0) return;
    const now = performance.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    fresh.forEach((r, i) => {
      const at: Pt = [r.at.lng, r.at.lat];
      const start = now + i * 700;
      ripples.current.push({ at, t0: start });
      timers.push(
        setTimeout(() => {
          const mk = new lib.Marker({ element: el(`<div class="lv-rise ${reduce ? 'still' : ''}" data-testid="live-ripple">${words.newOrder}</div>`), anchor: 'bottom', offset: [0, -10] }).setLngLat(at).addTo(m);
          timers.push(setTimeout(() => mk.remove(), reduce ? 4000 : RISE_MS));
        }, i * 700),
      );
    });
    let raf = 0;
    const tick = (tNow: number) => {
      ripples.current = ripples.current.filter((r) => tNow - r.t0 < RIPPLE_MS);
      const feats = ripples.current
        .filter((r) => tNow >= r.t0)
        .map((r) => {
          return { type: 'Feature' as const, properties: rippleAt(tNow - r.t0, reduce), geometry: { type: 'Point' as const, coordinates: r.at } };
        });
      m.getSource<GeoJSONSource>(SRC.ripples)?.setData({ type: 'FeatureCollection', features: feats } as never);
      if (ripples.current.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const x of timers) clearTimeout(x);
    };
  }, [pulse, day, ready, words, reduce]);

  // «يومي»: each kitchen to its door along the streets, a bag where he picked up, money at each door.
  const dayMarkers = useRef<Marker[]>([]);
  const wasDay = useRef(false);
  useEffect(() => {
    const m = mapRef.current;
    const lib = libRef.current;
    if (!m || !lib || !ready) return;
    for (const mk of dayMarkers.current) mk.remove();
    dayMarkers.current = [];
    const src = m.getSource<GeoJSONSource>(SRC.trail);
    if (!day) {
      src?.setData(EMPTY as never);
      // Only coming back from «يومي» moves the camera (on open, the turn has it).
      if (!wasDay.current) return;
      wasDay.current = false;
      meRef.current?.getElement().firstElementChild?.classList.remove('lv-faded');
      cam.current.follow = true;
      kick();
      return;
    }
    wasDay.current = true;
    // His day is the picture now: he steps back so the money at the doors reads.
    meRef.current?.getElement().firstElementChild?.classList.add('lv-faded');
    pause();
    const lines = dayLines(day, graphRef.current);
    src?.setData({ type: 'FeatureCollection', features: lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) } as never);
    const sides = coinSides(day);
    day.forEach((s, i) => {
      if (s.pickup) dayMarkers.current.push(new lib.Marker({ element: el(`<div class="lv-pick" data-testid="live-day-pickup">${svg('bag', 14)}</div>`), anchor: 'center' }).setLngLat([s.pickup.lng, s.pickup.lat]).addTo(m));
      if (s.dropoff) {
        dayMarkers.current.push(new lib.Marker({ element: el(`<div class="lv-pin"></div>`), anchor: 'center' }).setLngLat([s.dropoff.lng, s.dropoff.lat]).addTo(m));
        const below = sides[i] === 'below';
        dayMarkers.current.push(
          new lib.Marker({ element: el(`<div class="lv-coin" style="animation-delay:${reduce ? 0 : 600 + i * 450}ms" data-testid="live-day-coin">${words.coin(s.earnedIqd)}</div>`), anchor: below ? 'top' : 'bottom', offset: [0, below ? 12 : -12] })
            .setLngLat([s.dropoff.lng, s.dropoff.lat])
            .addTo(m),
        );
      }
    });
    const bb = boundsOf(lines.flat());
    // On top of the map's own padding (the band between the cards).
    if (bb) m.fitBounds(bb as LngLatBoundsLike, { padding: { top: 56, bottom: 24, left: 64, right: 64 }, ...DAY_CAM, duration: reduce ? 0 : 1200 });
  }, [day, ready, words, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const ink = theme.colors;
  return (
    <View style={StyleSheet.absoluteFill} testID="driver-map-home">
      <style>{css}</style>
      <div
        ref={container}
        data-testid="live-map-3d"
        style={
          {
            position: 'absolute',
            inset: 0,
            background: light === 'night' ? '#1B120B' : '#EFE3CC',
            '--lv-card': ink.surface,
            '--lv-ink': ink.text,
            '--lv-bg': ink.bg,
            '--lv-muted': ink.textMuted,
            '--lv-tint': ink.accentTint,
            '--lv-accent-text': ink.accentText,
            '--lv-saffron': ink.accent,
            '--lv-on-saffron': ink.onAccent,
            '--lv-sunk': ink.surfaceSunken,
          } as React.CSSProperties
        }
      />
      <LiveCredit bottom={bottomInset} />
    </View>
  );
}

const css = `
.maplibregl-ctrl-attrib, .maplibregl-ctrl-logo { display: none !important; }
.lv-faded { opacity: .35; transition: opacity .4s; }
.lv-me { width: 64px; height: 64px; position: relative; display: grid; place-items: center; }
.lv-me .lv-ring { position: absolute; inset: 0; border-radius: 50%; background: rgba(243,138,27,.22); transform: scale(.7); }
.lv-me.on .lv-ring { animation: lv-breathe 2.6s ease-in-out 6; }
.lv-dot { width: 30px; height: 30px; border-radius: 50%; background: var(--lv-saffron); color: var(--lv-on-saffron); border: 3px solid #FFFCF7; box-shadow: 0 4px 12px rgba(84,52,20,.35); display: grid; place-items: center; }
.lv-me:not(.on) .lv-dot { background: var(--lv-muted); color: #FFFCF7; }
@keyframes lv-breathe { 0%,100% { transform: scale(.7); opacity: .9; } 50% { transform: scale(1); opacity: .45; } }
.lv-bub { display: flex; align-items: center; gap: 5px; background: var(--lv-card); color: var(--lv-ink); border-radius: 999px; padding: 4px 10px 4px 8px; font: 700 12.5px "IBM Plex Sans Arabic", system-ui, sans-serif; box-shadow: 0 10px 30px rgba(84,52,20,.18), 0 2px 6px rgba(84,52,20,.10); white-space: nowrap; position: relative; direction: rtl; animation: lv-pop .5s cubic-bezier(.2,1.4,.4,1) both; }
.lv-bub::after { content: ""; position: absolute; bottom: -5px; left: 50%; margin-left: -5px; border: 5px solid transparent; border-bottom: 0; border-top-color: var(--lv-card); }
.lv-bub .fl { color: #D9540F; display: grid; }
.lv-bub.ready { background: var(--lv-saffron); color: var(--lv-on-saffron); }
.lv-bub.ready::after { border-top-color: var(--lv-saffron); }
.lv-bub.ready.pop { animation: lv-pop .6s cubic-bezier(.2,1.6,.4,1) both; }
.lv-bub.ring { padding-inline-start: 4px; }
.lv-prog { width: 20px; height: 20px; border-radius: 50%; background: conic-gradient(#D9540F var(--p), var(--lv-sunk) 0); display: grid; place-items: center; }
.lv-prog i { width: 13px; height: 13px; border-radius: 50%; background: var(--lv-card); }
@keyframes lv-pop { from { transform: scale(.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.lv-rise { font: 700 12px "IBM Plex Sans Arabic", system-ui, sans-serif; color: var(--lv-accent-text); background: var(--lv-tint); border-radius: 999px; padding: 3px 9px; white-space: nowrap; box-shadow: 0 10px 30px rgba(84,52,20,.18); animation: lv-rise 2.6s ease-out forwards; }
.lv-rise.still { animation: none; }
@keyframes lv-rise { 0% { transform: translateY(8px) scale(.7); opacity: 0; } 15% { transform: none; opacity: 1; } 75% { opacity: 1; } 100% { transform: translateY(-26px); opacity: 0; } }
.lv-drv { display: flex; align-items: center; gap: 3px; direction: rtl; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--lv-card) 88%, transparent); color: var(--lv-muted); font: 600 11px "IBM Plex Sans Arabic", system-ui, sans-serif; white-space: nowrap; box-shadow: 0 2px 6px rgba(84,52,20,.12); }
.lv-pick { width: 26px; height: 26px; border-radius: 8px; background: var(--lv-card); color: var(--lv-accent-text); display: grid; place-items: center; box-shadow: 0 6px 16px rgba(84,52,20,.2); }
.lv-pin { width: 14px; height: 14px; border-radius: 50%; background: var(--lv-ink); border: 3px solid #FFFCF7; box-shadow: 0 4px 10px rgba(84,52,20,.25); }
.lv-coin { background: var(--lv-ink); color: var(--lv-bg); border-radius: 999px; padding: 4px 10px; font: 700 13px "IBM Plex Sans Arabic", system-ui, sans-serif; box-shadow: 0 10px 30px rgba(84,52,20,.25); white-space: nowrap; direction: rtl; animation: lv-pop .5s cubic-bezier(.2,1.4,.4,1) both; font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { .lv-me .lv-ring, .lv-bub, .lv-rise, .lv-coin { animation: none !important; } }
`;
