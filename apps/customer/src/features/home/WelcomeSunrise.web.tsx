import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatRange } from '@driver/i18n';
import { Button, Icon, Text, useMotionPresets, useTheme, withAlpha } from '@driver/ui';
import { MapCredit } from '@/features/places/PinPicker';
import { prepareGolden } from '@/features/track/map/golden-setup';
import { ensureMaplibreCss } from '@/features/track/map/maplibre-css';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { useLocale, useT } from '@/lib/i18n';
import { useProfile, zoneName } from '@/lib/profile';
import { useSeason } from '@/lib/use-season';
import { sunriseCameraAt, sunriseEnd, sunriseLanding, sunriseLightAt } from './sunrise';
import type { WelcomeHomeProps } from './WelcomeDrawing';
import { nearestOpen, PIN_LAND_MS, welcomeLines } from './welcome-home';

type Golden = typeof import('@driver/map/golden');
type Pieces = typeof import('@driver/map/pieces');
type SunriseLight = import('@driver/map/golden').GoldenLight;

/** The home pin's size (px) and how far above the street it starts falling when the camera lands. */
const PIN = 40;
const DROP_FROM = -120;

/**
 * «الشمس تطلع على العزيزية» (map idea N4, Ali said yes 2026-10-11), web: the welcome-home moment after
 * sign-up, once. The camera rises from the Tigris over the real town while the light warms from night to
 * day (about 8 s, played once), «هلا بيك علي / هذي العزيزية» over the sky, and it lands over the
 * person's own street: the line becomes «هذا حيّك: شارع 30», the home pin drops onto it, and a sheet
 * asks for the door («وين بيتك؟ / حدّد بيتي / بعدين»; «يلا» when the door is already saved). A tap
 * during the flight lands at once; with reduced motion it opens landed. The camera path and the light
 * steps are the map's own `sunriseTour`, landing on the person's place; it ends on the day map.
 */
export function WelcomeSunrise({ name, zoneId, kitchens, onDone, onFail }: WelcomeHomeProps & { onFail: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const presets = useMotionPresets();
  const today = useSeason();
  const prof = useProfile();
  const door = prof.places.find((p) => p.label === 'home' && p.pin)?.pin ?? null;
  const landing = useMemo(() => sunriseLanding(door, zoneId), [door, zoneId]);
  const [hello, where] = welcomeLines(name, zoneId);
  const nearest = useMemo(() => nearestOpen(kitchens), [kitchens]);
  const [landed, setLanded] = useState(theme.reduceMotion);
  const [sheetH, setSheetH] = useState(0);
  const container = useRef<HTMLDivElement | null>(null);
  const pinEl = useRef<HTMLElement | null>(null);
  const land = useRef<() => void>(() => undefined);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  const y = useSharedValue(theme.reduceMotion ? 0 : DROP_FROM);
  const pinShown = useSharedValue(theme.reduceMotion ? 1 : 0);
  const pinStyle = useAnimatedStyle(() => ({ opacity: pinShown.value, transform: [{ translateY: y.value }] }));

  // The landing: the pin drops onto the street with a success buzz (never on a quiet day).
  useEffect(() => {
    if (!landed) return;
    if (!theme.reduceMotion) {
      pinShown.value = withTiming(1, { duration: 120 });
      y.value = withSpring(0, theme.motion.spring.settle);
    }
    const id = setTimeout(() => {
      if (today.celebrations) theme.haptic('success');
    }, theme.reduceMotion ? 0 : PIN_LAND_MS);
    return () => clearTimeout(id);
    // Once, when it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);

  // ── the map and the flight, once ──
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let raf = 0;
    let stopFallback: (() => void) | undefined;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden'), import('@driver/map/pieces')])
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

  const setDoor = () => {
    onDone();
    router.push({ pathname: '/places/new', params: { label: 'home' } });
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => (landed ? onDone() : land.current())} statusBarTranslucent>
      <Pressable
        testID="welcome-home"
        accessibilityRole="button"
        accessibilityLabel={t('home.welcome_skip_a11y')}
        // During the flight a tap lands at once; once landed, it closes like the drawing did.
        onPress={() => (landed ? onDone() : land.current())}
        style={{ flex: 1, backgroundColor: theme.colors.bg }}
      >
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden' }]} testID="welcome-sunrise-map">
          <div ref={container} style={{ position: 'absolute', inset: 0 }} />
          {/* The sky the words sit on: the page's cream fading into the map. */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insets.top + 220, background: `linear-gradient(${withAlpha(theme.colors.bg, 0.94)} 0%, ${withAlpha(theme.colors.bg, 0.7)} 45%, ${withAlpha(theme.colors.bg, 0)} 100%)` }} />
          <View ref={pinEl as never} style={{ position: 'absolute', left: 0, top: 0, width: PIN, alignItems: 'center' }}>
            <Animated.View testID="welcome-home-pin" style={[{ alignItems: 'center' }, pinStyle]}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.accent, borderWidth: 3, borderColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(40,24,8,0.35)' }}>
                <Icon name="home" size={17} color="onAccent" strokeWidth={2.4} />
              </View>
              <View style={{ width: 3, height: 10, backgroundColor: theme.colors.accent }} />
            </Animated.View>
          </View>
        </View>

        <View pointerEvents="none" style={{ paddingTop: insets.top + theme.space[6], paddingHorizontal: theme.space[6], gap: theme.space[1] }}>
          <Animated.View entering={presets.fadeIn(400)}>
            <Text variant="title" color="textMuted">
              {t(hello, { name: name ?? '' })}
            </Text>
          </Animated.View>
          <Animated.View key={landed ? 'here' : 'town'} entering={presets.fadeIn(landed ? 0 : 900)}>
            <Text variant="display" face="display" accessibilityRole="header" testID="welcome-home-zone">
              {landed ? t(where, { zone: zoneId ? zoneName(zoneId, locale) : '' }) : t('home.welcome_town')}
            </Text>
          </Animated.View>
        </View>

        <MapCredit bottom={landed ? sheetH : insets.bottom} />

        {landed ? (
          <Animated.View
            entering={presets.panelIn(PIN_LAND_MS)}
            onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              gap: theme.space[3],
              paddingTop: theme.space[5],
              paddingHorizontal: theme.space[5],
              paddingBottom: Math.max(insets.bottom, theme.space[5]),
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radius['2xl'],
              borderTopRightRadius: theme.radius['2xl'],
              boxShadow: '0 -6px 24px rgba(40,24,8,0.14)',
            }}
          >
            {door ? (
              <>
                {nearest ? (
                  <Text variant="body" color="textMuted" tabular>
                    {t('home.welcome_eta', { range: formatRange(nearest.etaMinMinutes, nearest.etaMaxMinutes, locale) })}
                  </Text>
                ) : null}
                <Button testID="welcome-home-go" label={t('home.welcome_go')} size="lg" fullWidth onPress={onDone} />
              </>
            ) : (
              <>
                <View style={{ gap: theme.space[1] }}>
                  <Text variant="heading" face="display">
                    {t('simple.set_home_title')}
                  </Text>
                  <Text variant="body" color="textMuted">
                    {t('home.welcome_door_body')}
                  </Text>
                </View>
                <Button testID="welcome-home-door" label={t('home.welcome_door_set')} icon="map-pin" size="lg" fullWidth onPress={setDoor} />
                <Button testID="welcome-home-go" label={t('auth.setup_later')} variant="ghost" fullWidth onPress={onDone} />
              </>
            )}
          </Animated.View>
        ) : null}
      </Pressable>
    </Modal>
  );
}
