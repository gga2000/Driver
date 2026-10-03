'use client';

import maplibregl, { type GeoJSONSource, type Map as MlMap, type MapGeoJSONFeature, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AZIZIYAH_ZONES } from '@driver/contracts';
import { t } from '@driver/i18n';
import { AZIZIYAH_BOUNDS, AZIZIYAH_MAX_BOUNDS, buildMapStyle, GARAGES, LAYER, SOURCE } from '@driver/map';
import { useEffect, useRef, useState } from 'react';
import { featureId, type LiveGeoJSON } from '@/lib/live-map';
import { ZonesSvg } from './zones-svg';

export type MapSelection =
  | { kind: 'driver'; id: string; tripId: string }
  | { kind: 'trip'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'garage'; id: string };

export interface LiveMapCanvasProps {
  live: LiveGeoJSON;
  selected: MapSelection | null;
  onSelect: (s: MapSelection | null) => void;
  /** Bump to fit the map back to Aziziyah. */
  fitKey: number;
  /** Centre the map here (list selection). */
  focus: { lng: number; lat: number } | null;
}

const CLICKABLE = [LAYER.drivers, LAYER.tripStops, LAYER.tripLines, LAYER.garages, LAYER.zoneFill];

function toSelection(f: MapGeoJSONFeature): MapSelection | null {
  const p = f.properties as Record<string, unknown>;
  switch (f.layer.id) {
    case LAYER.drivers:
      return { kind: 'driver', id: String(p['driverId']), tripId: String(p['tripId']) };
    case LAYER.tripLines:
    case LAYER.tripStops:
      return { kind: 'trip', id: String(p['tripId']) };
    case LAYER.garages:
      return { kind: 'garage', id: String(p['key']) };
    case LAYER.zoneFill:
      return { kind: 'zone', id: String(p['id']) };
    default:
      return null;
  }
}

/**
 * The MapLibre canvas (client only; loaded with `ssr: false`). Static layers come from the
 * @driver/map style; the three live sources are replaced on every poll with `setData`.
 */
export default function LiveMapCanvas({ live, selected, onSelect, fitKey, focus }: LiveMapCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: el,
        style: buildMapStyle() as StyleSpecification,
        bounds: AZIZIYAH_BOUNDS,
        fitBoundsOptions: { padding: 24 },
        maxBounds: AZIZIYAH_MAX_BOUNDS,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    // Zone names and garage names as HTML labels: the browser shapes Arabic natively, so the raster
    // fallback needs no glyph server or RTL plugin. Zone names appear from zoom 13.
    const markers: maplibregl.Marker[] = [];
    for (const z of AZIZIYAH_ZONES) {
      const label = document.createElement('div');
      label.className = 'map-zone-label';
      label.textContent = z.name_ar;
      label.setAttribute('aria-hidden', 'true');
      markers.push(new maplibregl.Marker({ element: label }).setLngLat([z.lng, z.lat]).addTo(map));
    }
    for (const g of GARAGES.filter((x) => x.inCity)) {
      const label = document.createElement('div');
      label.className = 'map-garage-label';
      label.textContent = g.name_ar;
      label.setAttribute('aria-hidden', 'true');
      markers.push(new maplibregl.Marker({ element: label, offset: [0, -16] }).setLngLat([g.lng, g.lat]).addTo(map));
    }
    const syncLabels = () => el.classList.toggle('map-show-zone-labels', map.getZoom() >= 13);
    map.on('zoom', syncLabels);
    syncLabels();

    let hoverId: number | string | undefined;
    map.on('mousemove', (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: CLICKABLE });
      map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
      const zone = hits.find((h) => h.layer.id === LAYER.zoneFill);
      if (hoverId !== undefined && hoverId !== zone?.id) map.setFeatureState({ source: SOURCE.zones, id: hoverId }, { hover: false });
      hoverId = zone?.id;
      if (hoverId !== undefined) map.setFeatureState({ source: SOURCE.zones, id: hoverId }, { hover: true });
    });
    map.on('click', (e) => {
      const [top] = map.queryRenderedFeatures(e.point, { layers: CLICKABLE });
      onSelectRef.current(top ? toSelection(top) : null);
    });
    map.on('load', () => setReady(true));
    // Tile errors (offline, OSM throttling) must not take the console down; the zones still draw.
    map.on('error', () => undefined);

    return () => {
      markers.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Live data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(SOURCE.trips) as GeoJSONSource | undefined)?.setData(live.trips);
    (map.getSource(SOURCE.stops) as GeoJSONSource | undefined)?.setData(live.stops);
    (map.getSource(SOURCE.drivers) as GeoJSONSource | undefined)?.setData(live.drivers);
  }, [live, ready]);

  // Selected driver halo.
  const selectedDriver = selected?.kind === 'driver' ? selected.id : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedDriver) return;
    const id = featureId(selectedDriver);
    map.setFeatureState({ source: SOURCE.drivers, id }, { selected: true });
    return () => {
      if (mapRef.current?.getSource(SOURCE.drivers)) mapRef.current.setFeatureState({ source: SOURCE.drivers, id }, { selected: false });
    };
  }, [selectedDriver, ready, live]);

  useEffect(() => {
    if (fitKey > 0) mapRef.current?.fitBounds(AZIZIYAH_BOUNDS, { padding: 24 });
  }, [fitKey]);

  useEffect(() => {
    if (focus) mapRef.current?.easeTo({ center: [focus.lng, focus.lat], zoom: Math.max(mapRef.current.getZoom(), 14) });
  }, [focus]);

  if (failed) {
    return (
      <div className="flex h-full flex-col">
        <p role="status" className="px-3 py-2 text-sm text-muted">
          {t('console.map_failed')}
        </p>
        <ZonesSvg className="min-h-0 flex-1" />
      </div>
    );
  }

  return <div ref={container} className="h-full w-full" role="region" aria-label={t('console.map_title')} />;
}
