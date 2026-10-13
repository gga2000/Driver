import { useMemo, useRef, useState, type RefObject } from 'react';
import type { MapRef } from '@maplibre/maplibre-react-native';
import { houseWindows, housesFromFeatures, WINDOW_MINZOOM, windowLayers } from '@driver/map/pieces/windows';
import { NO_WINDOWS, windowsKey } from './house-windows';

type Light = Parameters<typeof windowLayers>[0];

/**
 * Phones: windows, doors and roof walls on the houses up close, built from the risen houses on screen each
 * time the map has finished drawing. `layers` and `data` go in a GeoJSON source with `WINDOW_TOLERANCE`.
 */
export function useHouseWindows(map: RefObject<MapRef | null>, light: Light) {
  const [data, setData] = useState<GeoJSON.FeatureCollection>(NO_WINDOWS);
  const last = useRef('');
  const layers = useMemo(() => windowLayers(light), [light]);
  const dress = () => {
    const m = map.current;
    if (!m) return;
    void Promise.all([m.getZoom(), m.getCenter()])
      .then(async ([zoom, centre]) => {
        if (zoom < WINDOW_MINZOOM - 0.3) {
          if (last.current !== 'off') setData(NO_WINDOWS);
          last.current = 'off';
          return;
        }
        const fs = await m.queryRenderedFeatures({ layers: ['golden-houses-3d'] });
        const houses = housesFromFeatures(fs as never, [centre[0], centre[1]]);
        const key = windowsKey(zoom, [centre[0], centre[1]], houses.length);
        if (key === last.current) return;
        last.current = key;
        setData(houseWindows(houses));
      })
      .catch(() => undefined);
  };
  return { data, layers, dress };
}
