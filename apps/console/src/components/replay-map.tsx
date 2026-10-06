'use client';

import maplibregl, { type GeoJSONSource, type Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { OrderReplay } from '@driver/contracts';
import { t } from '@driver/i18n';
import { AZIZIYAH_MAX_BOUNDS, buildMapStyle, MAP_COLORS, MAP_COLORS_LIGHT } from '@driver/map';
import { useEffect, useRef, useState } from 'react';
import { pathUntil, positionAt, type ReplayPoint } from '@/lib/replay';

const SRC = { full: 'replay-full', driven: 'replay-driven' } as const;

const line = (coords: Array<[number, number]>) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: coords } });

/**
 * The replay's map (maps program o2): the whole path faint, the part driven by `t` bright, the
 * courier where he was at `t`, the kitchen and the door. Framed on the path once; the camera then
 * stays where the agent leaves it.
 */
export default function ReplayMap({ replay, path, t: at, theme }: { replay: OrderReplay; path: readonly ReplayPoint[]; t: number; theme: 'light' | 'dark' }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const courier = useRef<maplibregl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const C = theme === 'light' ? MAP_COLORS_LIGHT : MAP_COLORS;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let map: MlMap;
    try {
      map = new maplibregl.Map({ container: el, style: buildMapStyle({ theme }) as StyleSpecification, maxBounds: AZIZIYAH_MAX_BOUNDS, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.on('load', () => {
      map.addSource(SRC.full, { type: 'geojson', data: line([]) });
      map.addSource(SRC.driven, { type: 'geojson', data: line([]) });
      map.addLayer({ id: SRC.full, type: 'line', source: SRC.full, paint: { 'line-color': C.muted, 'line-width': 3, 'line-opacity': 0.55, 'line-dasharray': [1, 1.5] }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: SRC.driven, type: 'line', source: SRC.driven, paint: { 'line-color': C.accent, 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      setReady(true);
    });
    return () => {
      setReady(false);
      courier.current = null;
      mapRef.current = null;
      map.remove();
    };
    // The style is rebuilt with the theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // The whole path, the stops, the frame: once per replay.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const coords = path.map((p) => [p.lng, p.lat] as [number, number]);
    map.getSource<GeoJSONSource>(SRC.full)?.setData(line(coords));
    const stops = replay.legs.flatMap((l) => l.stops);
    const markers = stops.map((s) => {
      const node = document.createElement('div');
      node.className = 'ops-label';
      node.dataset['kind'] = 'garage';
      node.textContent = s.type === 'dropoff' ? t('console.replay_dropoff') : t('console.replay_pickup');
      return new maplibregl.Marker({ element: node, anchor: 'bottom' }).setLngLat([s.lng, s.lat]).addTo(map);
    });
    const all = [...coords, ...stops.map((s) => [s.lng, s.lat] as [number, number])];
    if (all.length > 0) {
      const b = new maplibregl.LngLatBounds(all[0]!, all[0]!);
      for (const c of all) b.extend(c);
      map.fitBounds(b, { padding: 48, maxZoom: 16, duration: 0 });
    }
    return () => {
      for (const m of markers) m.remove();
    };
  }, [ready, replay, path]);

  // The moment `t`: the driven path and the courier.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource<GeoJSONSource>(SRC.driven)?.setData(line(pathUntil(path, at)));
    const here = positionAt(path, at);
    if (!here) return;
    if (!courier.current) {
      const node = document.createElement('div');
      node.setAttribute('data-testid', 'replay-courier');
      node.className = 'replay-courier';
      courier.current = new maplibregl.Marker({ element: node }).setLngLat([here.lng, here.lat]).addTo(map);
    } else courier.current.setLngLat([here.lng, here.lat]);
  }, [ready, path, at]);

  if (failed) {
    return (
      <p role="status" className="px-3 py-2 text-sm text-muted">
        {t('console.map_failed')}
      </p>
    );
  }
  return <div ref={box} className="h-full w-full" aria-label={t('console.replay_label')} />;
}
