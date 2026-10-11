import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { useT } from '@/lib/i18n';
import { prepareGolden } from '@/features/track/map/golden-setup';
import { ensureMaplibreCss } from '@/features/track/map/maplibre-css';
import { GOLDEN_MAP } from '@/features/track/map/credit';
import type { CartsMapProps } from './carts-map-types';
import { cartPalette } from './palette';

export type { CartsMapProps } from './carts-map-types';

/** Whether this build can draw the carts map (web, with our map files set up). */
export const CARTS_MAP = GOLDEN_MAP;

const PIN = 40;
/** Close enough to read the street a cart stands on, far enough to see its neighbours. */
const FOCUS_ZOOM = 17.2;

/**
 * The carts on the Golden hour map, web (look A, golden light: the night map is Ali's after-launch
 * call). Each cart with a spot is a fuchsia pin (cream ring) with its name; a closed one is grey and
 * says so. Choosing one eases the camera to it (a fade with reduce motion). Pins are screen elements
 * placed from MapLibre's projection every frame. The 3D carts (`@driver/map/pieces/carts`) replace
 * the plain pins once the map thread's layer lands.
 */
export function CartsMap({ carts, selectedId, onSelect, topInset, bottomInset, onFail }: CartsMapProps) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const pins = useRef(new Map<string, HTMLElement>());
  const live = useRef({ carts, selectedId, topInset, bottomInset, reduce: theme.reduceMotion });
  live.current = { carts, selectedId, topInset, bottomInset, reduce: theme.reduceMotion };
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const placed = carts.filter((c) => c.spot);

  const placePins = () => {
    const m = mapRef.current;
    if (!m) return;
    const { width, height } = m.getContainer().getBoundingClientRect();
    for (const c of live.current.carts) {
      const el = pins.current.get(c.id);
      if (!el || !c.spot) continue;
      const p = m.project([c.spot.lng, c.spot.lat]);
      const off = p.x < -80 || p.y < -80 || p.x > width + 80 || p.y > height + 80;
      el.style.display = off ? 'none' : 'flex';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      el.style.zIndex = c.id === live.current.selectedId ? '3' : c.open ? '2' : '1';
    }
  };

  const frame = (animate: boolean) => {
    const m = mapRef.current;
    if (!m) return;
    const s = live.current;
    const padding = { top: s.topInset + 40, bottom: s.bottomInset + 24, left: 48, right: 48 };
    const chosen = s.carts.find((c) => c.id === s.selectedId && c.spot);
    const quiet = !animate || s.reduce;
    const go = (move: () => void) => {
      if (!animate || !s.reduce || !container.current) return move();
      const el = container.current;
      el.style.transition = 'opacity 160ms ease-out';
      el.style.opacity = '0';
      setTimeout(() => {
        move();
        el.style.opacity = '1';
      }, 170);
    };
    if (chosen?.spot) {
      const cam = { center: [chosen.spot.lng, chosen.spot.lat] as [number, number], zoom: FOCUS_ZOOM, pitch: 55, bearing: -20, padding };
      go(() => (quiet ? m.jumpTo(cam) : m.easeTo({ ...cam, duration: 1200 })));
      return;
    }
    const pts = s.carts.filter((c) => c.spot).map((c) => [c.spot!.lng, c.spot!.lat] as [number, number]);
    if (!pts.length) return;
    const lng = pts.map((p) => p[0]);
    const lat = pts.map((p) => p[1]);
    const fit = m.cameraForBounds([Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)], { padding, maxZoom: 16.5 });
    if (!fit) return;
    const cam = { center: fit.center, zoom: fit.zoom ?? 15.5, pitch: 45, bearing: -15 };
    go(() => (quiet ? m.jumpTo(cam) : m.easeTo({ ...cam, duration: 1200 })));
  };

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let stopFallback: (() => void) | undefined;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden')])
      .then(async ([mod, golden]) => {
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        await prepareGolden(maplibregl);
        if (cancelled || !container.current) return;
        ensureMaplibreCss();
        // Golden light at launch (the night map is Ali's after-launch decision).
        const light = 'golden' as const;
        const style = golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: 'customer', light }).style as unknown as StyleSpecification;
        const first = live.current.carts.find((c) => c.spot)?.spot;
        try {
          map = new maplibregl.Map({ container: container.current, style, ...(first ? { center: [first.lng, first.lat] as [number, number], zoom: 15.5 } : {}), attributionControl: false, fadeDuration: 0, maxPitch: 65 });
        } catch {
          failRef.current();
          return;
        }
        const m = map;
        mapRef.current = m;
        m.on('error', () => undefined);
        stopFallback = golden.fallBackToOriginalMap(m as never, { onFallback: () => failRef.current() });
        m.on('style.load', () => {
          for (const [id, img] of Object.entries(golden.goldenImages(light))) {
            if (m.hasImage(id)) m.updateImage(id, img);
            else m.addImage(id, img);
          }
          if (m.getLayer('golden-places')) m.setLayoutProperty('golden-places', 'visibility', 'none');
        });
        m.once('load', () => {
          frame(false);
          placePins();
        });
        m.on('render', placePins);
      })
      .catch(() => failRef.current());
    return () => {
      cancelled = true;
      stopFallback?.();
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    placePins();
    frame(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    placePins();
  }, [carts]);

  const asPin = (id: string) => (el: unknown) => {
    if (el) pins.current.set(id, el as HTMLElement);
    else pins.current.delete(id);
  };

  return (
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden', backgroundColor: theme.colors.bg }]} testID="carts-map-view">
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {placed.map((c) => {
        const chosen = c.id === selectedId;
        return (
          <Pressable
            key={c.id}
            ref={asPin(c.id) as never}
            onPress={() => onSelect(c.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: chosen }}
            accessibilityLabel={c.open ? t('carts.pin_open', { name: c.name }) : t('carts.pin_closed', { name: c.name })}
            testID={`carts-pin-${c.id}`}
            style={[styles.pin, { display: 'none' }]}
          >
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, marginBottom: 4, backgroundColor: withAlpha(theme.colors.surface, 0.96), borderWidth: chosen ? 2 : 0, borderColor: pal.fill, maxWidth: 170, boxShadow: '0 1px 4px rgba(40,24,8,0.25)' }}>
              <Text variant="caption" weight={700} numberOfLines={1} style={{ direction: 'rtl' }}>
                {c.name}
              </Text>
              {c.walkMin !== null && c.open ? (
                <Text variant="caption" color={pal.text} numberOfLines={1} tabular style={{ direction: 'rtl', marginTop: -4 }}>
                  {t('carts.walk_min', { n: c.walkMin })}
                </Text>
              ) : null}
            </View>
            {/* The cart's fuchsia disc in a cream ring; grey while closed. */}
            <View style={{ width: chosen ? PIN + 6 : PIN, height: chosen ? PIN + 6 : PIN, borderRadius: PIN, borderWidth: 4, borderColor: theme.colors.surface, backgroundColor: c.open ? pal.fill : theme.colors.borderStrong, boxShadow: '0 2px 6px rgba(40,24,8,0.35)' }} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { position: 'absolute', left: 0, top: 0, alignItems: 'center', minWidth: 44, minHeight: 44 },
});
