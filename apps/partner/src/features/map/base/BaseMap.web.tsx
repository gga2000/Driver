import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useLiteMode } from '@driver/ui';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { buildMapStyle, buildPlacedZonesGeoJSON, LAYER, MAP_COLORS_LIGHT, SOURCE } from '@driver/map';
import { SvgBase } from './SvgBase';
import type { BaseMapProps } from './types';
import { LandmarkLayer } from './LandmarkLayer';
import { ZoneLayer } from './ZoneLayer';
import { useZoneMap } from './useZoneMap';

/** Web: MapLibre GL with the `@driver/map` light style; the SVG base if WebGL is unavailable. */
export function BaseMap(props: BaseMapProps) {
  const [failed, setFailed] = useState(false);
  // Low-data mode (maps program q2): the drawn town instead of downloading map tiles.
  const lite = useLiteMode();
  if (failed || lite) return <SvgBase {...props} />;
  return <MapLibreBase {...props} onFail={() => setFailed(true)} />;
}

export const BASE_MAP_KIND: 'svg' | 'maplibre' = 'maplibre';

/**
 * Light OSM raster (dev) until the PMTiles basemap ships; zones and the background always draw.
 * The customer map has no use for the Console's garage and live-fleet layers.
 */
const CONSOLE_ONLY: ReadonlySet<string> = new Set([LAYER.garages, LAYER.tripLines, LAYER.tripStops, LAYER.drivers, LAYER.driverHalo]);
const LIGHT = buildMapStyle({ theme: 'light' });
const STYLE = { ...LIGHT, layers: LIGHT.layers.filter((l) => !CONSOLE_ONLY.has(l.id)) } as unknown as StyleSpecification;

/**
 * The camera lives in the shared values (`cam`): every frame the map is jumped to them, so the
 * overlay (drawn from the same values) never drifts from the tiles, including during follow
 * animations. While the person drags or pinches, the map leads and writes the values instead.
 */
function MapLibreBase({ drawn, cam, size, onUserGestureStart, onUserCamera, labelAvoid, coveredTop, coveredBottom, landmarkNameZoom, onFail }: BaseMapProps & { onFail: () => void }) {
  const zonesQuery = useZoneMap();
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
    let map: MlMap | null = null;
    import('maplibre-gl')
      .then((mod) => {
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        if (cancelled || !container.current) return;
        try {
          map = new maplibregl.Map({
            container: container.current,
            style: STYLE,
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
        m.once('load', () => {
          if (zonesRef.current) m.getSource<GeoJSONSource>(SOURCE.zones)?.setData(buildPlacedZonesGeoJSON(zonesRef.current));
        });
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
      <LandmarkLayer drawn={drawn} cam={cam} size={size} opacity={labels} coveredTop={coveredTop ?? 0} coveredBottom={coveredBottom ?? 0} {...(landmarkNameZoom !== undefined ? { nameZoom: landmarkNameZoom } : {})} {...(labelAvoid ? { avoid: labelAvoid } : {})} />
    </View>
  );
}
