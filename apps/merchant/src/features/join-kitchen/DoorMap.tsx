import { useEffect, useMemo, useRef } from 'react';
import { TurboModuleRegistry, View } from 'react-native';
import type * as Mlrn from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import { useTheme } from '@driver/ui';
import { CITY_CENTRE, DOOR_MAP_URLS, DOOR_ZOOM, roundDoor, type DoorMapProps } from './door';
import { DoorPin } from './DoorPin';

let loaded: typeof Mlrn | null | undefined;
function nativeMapLibre(): typeof Mlrn | null {
  if (loaded !== undefined) return loaded;
  try {
    // A runtime require: importing it in a build without the native map throws at load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = TurboModuleRegistry.get('MLRNMapViewModule') ? (require('@maplibre/maplibre-react-native') as typeof Mlrn) : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

/**
 * Her door on the day map (phones and tablets with the native map): she drags the streets under the
 * fixed pin. Expo Go, builds without the map, missing map files or a failed load → a landmark instead.
 */
export function DoorMap({ value, onChange, onUnavailable, height }: DoorMapProps) {
  const ml = nativeMapLibre();
  const theme = useTheme();
  const start = useRef(value ?? CITY_CENTRE);
  const urls = DOOR_MAP_URLS;
  useEffect(() => {
    if (!ml || !urls) onUnavailable();
  }, [ml, urls, onUnavailable]);
  // Pin-setting maps are always the day map (Ali), whatever the hour.
  const style = useMemo(() => (urls ? golden.chooseMapStyle({ tilesUrl: urls.tilesUrl, glyphsUrl: urls.glyphsUrl, mode: 'lite', light: 'day', fallback: { theme: 'light' } }).style : null), [urls]);
  if (!ml || !style) return null;
  return (
    <View testID="door-map" style={{ height, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
      <ml.Map
        style={{ flex: 1 }}
        mapStyle={style}
        touchRotate={false}
        touchPitch={false}
        attribution={false}
        logo={false}
        onDidFailLoadingMap={onUnavailable}
        onRegionDidChange={(e) => {
          const [lng, lat] = e.nativeEvent.center;
          onChange(roundDoor({ lat, lng }));
        }}
      >
        <ml.Camera minZoom={12} maxZoom={19} initialViewState={{ center: [start.current.lng, start.current.lat], zoom: DOOR_ZOOM }} />
      </ml.Map>
      <DoorPin />
    </View>
  );
}
