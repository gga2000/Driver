import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { useTheme } from '@driver/ui';
import { prepareGolden } from '@/features/track/map/golden-setup';
import { ensureMaplibreCss } from '@/features/track/map/maplibre-css';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { useProfile } from '@/lib/profile';
import { sunriseCameraAt, sunriseEnd, sunriseLanding, sunriseLightAt } from './sunrise';
import { SunriseFrame, SunrisePin } from './SunriseFrame';
import type { WelcomeHomeProps } from './WelcomeDrawing';

type Golden = typeof import('@driver/map/golden');
type Pieces = typeof import('@driver/map/pieces/sunrise');
type SunriseLight = import('@driver/map/golden').GoldenLight;

/**
 * «الشمس تطلع على العزيزية» (map idea N4, Ali said yes 2026-10-11), web: the welcome-home moment after
 * sign-up, once. The camera rises from the Tigris over the real town while the light warms from night to
 * day (about 8 s, played once), «هلا بيك علي / هذي العزيزية» over the sky, and it lands over the
 * person's own street: the line becomes «هذا حيّك: شارع 30», the home pin drops onto it, and a sheet
 * asks for the door («وين بيتك؟ / حدّد بيتي / بعدين»; «يلا» when the door is already saved). A tap
 * during the flight lands at once; with reduced motion it opens landed. The camera path and the light
 * steps are the map's own `sunriseTour`, landing on the person's place; it ends on the day map. The
 * words, the pin and the sheet are `SunriseFrame`, shared with the phones (WelcomeSunrise.tsx).
 */
export function WelcomeSunrise({ onFail, ...props }: WelcomeHomeProps & { onFail: () => void }) {
  const theme = useTheme();
  const prof = useProfile();
  const door = prof.places.find((p) => p.label === 'home' && p.pin)?.pin ?? null;
  const landing = useMemo(() => sunriseLanding(door, props.zoneId), [door, props.zoneId]);
  const [landed, setLanded] = useState(theme.reduceMotion);
  const container = useRef<HTMLDivElement | null>(null);
  const pinEl = useRef<HTMLElement | null>(null);
  const land = useRef<() => void>(() => undefined);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  // ── the map and the flight, once ──
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let raf = 0;
    let stopFallback: (() => void) | undefined;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden'), import('@driver/map/pieces/sunrise')])
      .then(async ([mod, golden, pieces]: [unknown, Golden, Pieces]) => {
        const maplibregl = ((mod as { default?: unknown }).default ?? mod) as typeof import('maplibre-gl');
        await prepareGolden(maplibregl);
        if (cancelled || !container.current) return;
        ensureMaplibreCss();
        const tour = pieces.sunriseTour(landing);
        const end = sunriseEnd(tour);
        let light: SunriseLight = theme.reduceMotion ? end.light : sunriseLightAt(tour, 0);
        const styleFor = (l: SunriseLight) => golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: 'customer', light: l }).style as unknown as StyleSpecification;
        const camera = theme.reduceMotion ? end.camera : sunriseCameraAt(tour, 0);
        try {
          map = new maplibregl.Map({ container: container.current, style: styleFor(light), ...camera, interactive: false, attributionControl: false, fadeDuration: 0, maxPitch: 75 });
        } catch {
          failRef.current();
          return;
        }
        const m = map;
        m.on('error', () => undefined);
        stopFallback = golden.fallBackToOriginalMap(m as never, { onFallback: () => failRef.current() });
        // Each light has its own pattern images (roof tiles, palms' shade); a new style asks for them again.
        const addImages = () => {
          for (const [id, img] of Object.entries(golden.goldenImages(light))) {
            if (m.hasImage(id)) m.updateImage(id, img);
            else m.addImage(id, img);
          }
        };
        m.on('style.load', addImages);
        m.on('styleimagemissing', (e: { id: string }) => {
          const img = golden.goldenImages(light)[e.id];
          if (img && !m.hasImage(e.id)) m.addImage(e.id, img);
        });
        const setLight = (l: SunriseLight) => {
          if (l === light) return;
          light = l;
          m.setStyle(styleFor(l));
        };
        // The pin stands on the landing spot, placed from the map's own projection every frame.
        m.on('render', () => {
          const el = pinEl.current;
          if (!el) return;
          const p = m.project(landing);
          el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
        });
        land.current = () => {
          cancelAnimationFrame(raf);
          land.current = () => undefined;
          m.jumpTo(end.camera);
          setLight(end.light);
          setLanded(true);
        };
        if (theme.reduceMotion) return;
        m.once('load', () => {
          if (cancelled) return;
          const t0 = performance.now();
          const step = (now: number) => {
            const at = now - t0;
            if (at >= tour.totalMs) {
              land.current();
              return;
            }
            m.jumpTo(sunriseCameraAt(tour, at));
            setLight(sunriseLightAt(tour, at));
            raf = requestAnimationFrame(step);
          };
          raf = requestAnimationFrame(step);
        });
      })
      .catch(() => failRef.current());
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopFallback?.();
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const map = (
    <>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      <View ref={pinEl as never} style={{ position: 'absolute', left: 0, top: 0 }}>
        <SunrisePin landed={landed} />
      </View>
    </>
  );
  return <SunriseFrame {...props} door={door} landed={landed} onLand={() => land.current()} map={map} />;
}
