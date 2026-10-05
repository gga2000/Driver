import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import { AZIZIYAH_ZONES, type LatLng } from '@driver/contracts';
import { useTheme } from '@driver/ui';
import { CUSTOMER_MAP_STYLE } from '../track/map/customerStyle';
import { AZIZIYAH_BOX } from './geo';
import { PIN_MAP_HEIGHT, PinMapSketch, type PinMapProps } from './PinMapSketch';

/** Zoom once a door is pinned: street level, so the person can nudge it onto the right house. */
const PIN_ZOOM = 16;
const ZONE_SOURCE = 'pin-zone';

/** The chosen zone's disc as a polygon (the zones are centre + radius, not shapes). */
function zoneDisc(zoneId: string | null): GeoJSON.FeatureCollection {
  const zone = zoneId ? AZIZIYAH_ZONES.find((z) => z.id === zoneId) : undefined;
  if (!zone) return { type: 'FeatureCollection', features: [] };
  const dLat = zone.radiusM / 110_900;
  const dLng = zone.radiusM / 93_400;
  const ring = Array.from({ length: 49 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI;
    return [zone.lng + dLng * Math.cos(a), zone.lat + dLat * Math.sin(a)];
  });
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
}

/**
 * Web pin picker: the real street map (the tracking map's style), so people can find their own
 * street. Tap drops the pin; the chosen zone is tinted. Falls back to the sketch without WebGL.
 */
export function PinMap(props: PinMapProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return <PinMapSketch {...props} />;
  return <MapLibrePinMap {...props} onFail={() => setFailed(true)} />;
}

function MapLibrePinMap({ pin, zoneId, onPin, accessibilityLabel, testID, onFail }: PinMapProps & { onFail: () => void }) {
  const theme = useTheme();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const makeMarker = useRef<((p: LatLng) => Marker) | null>(null);
  const [ready, setReady] = useState(false);
  const cbs = useRef({ onPin, onFail });
  cbs.current = { onPin, onFail };
  const colors = { accent: theme.colors.accent, ink: theme.colors.text, paper: theme.colors.surface };

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    import('maplibre-gl')
      .then((mod) => {
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        if (cancelled || !container.current) return;
        try {
          map = new maplibregl.Map({
            container: container.current,
            style: CUSTOMER_MAP_STYLE,
            ...(pin
              ? { center: [pin.lng, pin.lat] as [number, number], zoom: PIN_ZOOM }
              : { bounds: [[AZIZIYAH_BOX.minLng, AZIZIYAH_BOX.minLat], [AZIZIYAH_BOX.maxLng, AZIZIYAH_BOX.maxLat]] as [[number, number], [number, number]] }),
            attributionControl: { compact: true },
            // The map sits inside a scrolling form: the wheel scrolls the page, the buttons zoom.
            scrollZoom: false,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            fadeDuration: 0,
          });
        } catch {
          cbs.current.onFail();
          return;
        }
        const m = map;
        mapRef.current = m;
        m.touchZoomRotate.disableRotation();
        m.keyboard.disableRotation();
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
        m.getCanvas().style.cursor = 'crosshair';
        // Tiles failing (offline, blocked) is expected: the background and zones still draw.
        m.on('error', () => undefined);
        m.on('click', (e) => cbs.current.onPin({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
        makeMarker.current = (p) => {
          const el = document.createElement('div');
          el.innerHTML =
            `<svg width="30" height="38" viewBox="-15 -36 30 38" aria-hidden="true">` +
            `<circle cx="0" cy="0" r="7" fill="${colors.accent}" fill-opacity="0.25"/>` +
            `<path d="M0 0 C -9 -12 -11 -16 -11 -21 a11 11 0 0 1 22 0 c0 5 -2 9 -11 21z" fill="${colors.accent}" stroke="${colors.ink}" stroke-width="1.5"/>` +
            `<circle cx="0" cy="-21" r="4" fill="${colors.paper}"/></svg>`;
          return new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, 2] }).setLngLat([p.lng, p.lat]).addTo(m);
        };
        m.on('load', () => {
          m.addSource(ZONE_SOURCE, { type: 'geojson', data: zoneDisc(null) });
          m.addLayer({ id: `${ZONE_SOURCE}-fill`, type: 'fill', source: ZONE_SOURCE, paint: { 'fill-color': colors.accent, 'fill-opacity': 0.18 } });
          m.addLayer({ id: `${ZONE_SOURCE}-line`, type: 'line', source: ZONE_SOURCE, paint: { 'line-color': colors.accent, 'line-width': 1.5 } });
          setReady(true);
        });
      })
      .catch(() => cbs.current.onFail());
    return () => {
      cancelled = true;
      markerRef.current = null;
      makeMarker.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // The map is created once; pin and zone reach it through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The pin can also move from outside the map ("my location", picking a zone): follow it.
  useEffect(() => {
    const m = mapRef.current;
    if (!ready || !m) return;
    if (!pin) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (markerRef.current) markerRef.current.setLngLat([pin.lng, pin.lat]);
    else if (makeMarker.current) markerRef.current = makeMarker.current(pin);
    if (!m.getBounds().contains([pin.lng, pin.lat])) m.easeTo({ center: [pin.lng, pin.lat], zoom: Math.max(m.getZoom(), PIN_ZOOM - 1) });
  }, [ready, pin]);

  useEffect(() => {
    const source = ready ? mapRef.current?.getSource<GeoJSONSource>(ZONE_SOURCE) : undefined;
    source?.setData(zoneDisc(zoneId));
  }, [ready, zoneId]);

  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={{ height: PIN_MAP_HEIGHT, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken, borderWidth: 1, borderColor: theme.colors.border }}
    >
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
    </View>
  );
}
