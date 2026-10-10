import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { buildPlacedZonesGeoJSON, MAP_COLORS_LIGHT, SOURCE } from '@driver/map';
import { useLiteMode } from '@driver/ui';
import { useApi } from '@/lib/api';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { GOLDEN_MAP } from './credit';
import { CUSTOMER_MAP_STYLE } from './customerStyle';
import { LIGHT_CHECK_MS, prepareGolden } from './golden-setup';
import { ensureMaplibreCss } from './maplibre-css';
import { LandmarkLayer } from './LandmarkLayer';
import { SvgBase } from './SvgBase';
import type { BaseMapProps } from './types';
import { ZoneLayer } from './ZoneLayer';
import { ZONE_SHAPES_QUERY } from './zone-query';

/**
 * Web: MapLibre GL with the Golden hour map when its files are set up (`GOLDEN_MAP`), else the
 * `@driver/map` light style; the SVG base if WebGL is unavailable.
 */
export function BaseMap(props: BaseMapProps) {
  const [failed, setFailed] = useState(false);
  // Low-data mode (maps program q2): the drawn town instead of downloading map tiles.
  const lite = useLiteMode();
  if (failed || lite) return <SvgBase {...props} />;
  return <MapLibreBase {...props} onFail={() => setFailed(true)} />;
}

export const BASE_MAP_KIND: 'svg' | 'maplibre' = 'maplibre';

/**
 * The camera lives in the shared values (`cam`): every frame the map is jumped to them, so the
 * overlay (drawn from the same values) never drifts from the tiles, including during follow
 * animations. While the person drags or pinches, the map leads and writes the values instead.
 */
function MapLibreBase({ drawn, cam, size, onUserGestureStart, onUserCamera, labelAvoid, coveredTop, coveredBottom, alwaysDay, onFail }: BaseMapProps & { onFail: () => void }) {
  const api = useApi();
  const zonesQuery = useQuery(api.ops.zones.map.queryOptions({ cityId: 'aziziyah' }, ZONE_SHAPES_QUERY));
  const zonesRef = useRef(zonesQuery.data);
  zonesRef.current = zonesQuery.data;
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const driving = useRef(false);
  const labels = useSharedValue(1);
  const cbs = useRef({ onUserGestureStart, onUserCamera, onFail });
  cbs.current = { onUserGestureStart, onUserCamera, onFail };

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lightTimer: ReturnType<typeof setInterval> | undefined;
    let stopFallback: (() => void) | undefined;
    let map: MlMap | null = null;
    Promise.all([import('maplibre-gl'), GOLDEN_MAP ? import('@driver/map/golden') : null])
      .then(async ([mod, golden]) => {
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        if (golden) await prepareGolden(maplibregl);
        if (cancelled || !container.current) return;
        ensureMaplibreCss();
        // Golden hour when its files are set up; the original map otherwise and as the fallback.
        let light = golden?.resolveLight(alwaysDay ? { light: 'day' } : {}).light;
        const goldenStyle = () =>
          golden!.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: 'customer', light: light! }).style as unknown as StyleSpecification;
        let onGolden = !!golden;
        try {
          map = new maplibregl.Map({
            container: container.current,
            style: golden ? goldenStyle() : CUSTOMER_MAP_STYLE,
            center: [cam.lng.value, cam.lat.value],
            zoom: cam.zoom.value,
            attributionControl: false,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            fadeDuration: 0,
          });
        } catch {
          cbs.current.onFail();
          return;
        }
        mapRef.current = map;
        const m = map;
        // Every style load (first, fallback, new light): zones on the original map, palm pattern on ours.
        m.on('style.load', () => {
          if (zonesRef.current) m.getSource<GeoJSONSource>(SOURCE.zones)?.setData(buildPlacedZonesGeoJSON(zonesRef.current));
          if (onGolden && golden && light) {
            for (const [id, img] of Object.entries(golden.goldenImages(light))) {
              if (m.hasImage(id)) m.updateImage(id, img);
              else m.addImage(id, img);
            }
          }
        });
        if (golden) {
          // Our file failing or silent for 10 s → the original map, once (with the customer's layers only).
          stopFallback = golden.fallBackToOriginalMap(m as never, {
            onFallback: () => {
              onGolden = false;
              clearInterval(lightTimer);
              m.setStyle(CUSTOMER_MAP_STYLE);
            },
          });
          lightTimer = setInterval(() => {
            if (alwaysDay) return;
            const next = golden.resolveLight().light;
            if (!onGolden || next === light) return;
            light = next;
            m.setStyle(goldenStyle());
          }, LIGHT_CHECK_MS);
        }
        m.touchZoomRotate.disableRotation();
        m.keyboard.disableRotation();
        // Attribution is drawn by the screen (`MapAttribution`) above the sheet, not as a MapLibre control.
        // Tiles failing (offline, blocked) is expected: the background and zones still draw.
        m.on('error', () => undefined);
        m.on('movestart', (e) => {
          if (!(e as { originalEvent?: unknown }).originalEvent) return;
          driving.current = true;
          labels.value = 0;
          cbs.current.onUserGestureStart();
        });
        m.on('move', () => {
          if (!driving.current) return;
          const c = m.getCenter();
          cam.lng.value = c.lng;
          cam.lat.value = c.lat;
          cam.zoom.value = m.getZoom();
        });
        m.on('moveend', () => {
          if (!driving.current) return;
          driving.current = false;
          labels.value = 1;
          const c = m.getCenter();
          cbs.current.onUserCamera({ lng: c.lng, lat: c.lat, zoom: m.getZoom() });
        });
        const tick = () => {
          if (!driving.current) {
            const c = m.getCenter();
            const lng = cam.lng.value;
            const lat = cam.lat.value;
            const zoom = cam.zoom.value;
            if (Math.abs(c.lng - lng) > 1e-9 || Math.abs(c.lat - lat) > 1e-9 || Math.abs(m.getZoom() - zoom) > 1e-6) m.jumpTo({ center: [lng, lat], zoom });
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => cbs.current.onFail());
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearInterval(lightTimer);
      stopFallback?.();
      map?.remove();
      mapRef.current = null;
    };
    // The map is created once; the camera reaches it through the shared values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.resize();
  }, [size.w, size.h]);

  useEffect(() => {
    if (zonesQuery.data) mapRef.current?.getSource<GeoJSONSource>(SOURCE.zones)?.setData(buildPlacedZonesGeoJSON(zonesQuery.data));
  }, [zonesQuery.data]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: MAP_COLORS_LIGHT.background }]}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {/* MapLibre has no glyphs until the PMTiles basemap lands: neighbourhood names come from SVG. */}
      <ZoneLayer drawn={drawn} cam={cam} size={size} fills={false} labels opacity={labels} {...(labelAvoid ? { avoid: labelAvoid } : {})} />
      {/* Landmarks (maps b3) over the tiles and under every pin the screen draws. */}
      <LandmarkLayer drawn={drawn} cam={cam} size={size} opacity={labels} coveredTop={coveredTop ?? 0} coveredBottom={coveredBottom ?? 0} {...(labelAvoid ? { avoid: labelAvoid } : {})} />
    </View>
  );
}
