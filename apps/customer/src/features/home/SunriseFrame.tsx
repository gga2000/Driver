import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { formatRange } from '@driver/i18n';
import { Button, Icon, Text, useMotionPresets, useTheme } from '@driver/ui';
import { MapCredit } from '@/features/places/PinPicker';
import { useLocale, useT } from '@/lib/i18n';
import { zoneName } from '@/lib/profile';
import { useSeason } from '@/lib/use-season';
import type { WelcomeHomeProps } from './WelcomeDrawing';
import { nearestOpen, PIN_LAND_MS, welcomeLines } from './welcome-home';

/** How far above the street the home pin starts falling when the camera lands, and the sky band's height under the words. */
const DROP_FROM = -120;
const SKY_H = 220;

/** The saffron home pin that drops onto the street once the camera lands; each platform's map stands it on the landing. */
export function SunrisePin({ landed }: { landed: boolean }) {
  const theme = useTheme();
  const y = useSharedValue(theme.reduceMotion ? 0 : DROP_FROM);
  const shown = useSharedValue(theme.reduceMotion ? 1 : 0);
  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: y.value }] }));
  useEffect(() => {
    if (!landed || theme.reduceMotion) return;
    shown.value = withTiming(1, { duration: 120 });
    y.value = withSpring(0, theme.motion.spring.settle);
    // Once, when it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);
  return (
    <Animated.View testID="welcome-home-pin" pointerEvents="none" style={[{ width: 40, alignItems: 'center' }, style]}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.accent, borderWidth: 3, borderColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 8px rgba(40,24,8,0.35)' }}>
        <Icon name="home" size={17} color="onAccent" strokeWidth={2.4} />
      </View>
      <View style={{ width: 3, height: 10, backgroundColor: theme.colors.accent }} />
    </Animated.View>
  );
}

/**
 * Everything of the sign-up sunrise but the map, the same on the web and phones: «هلا بيك علي / هذي
 * العزيزية» over a cream sky, «هذا حيّك: شارع 30» with a success buzz once it lands, and the sheet that
 * asks for the door («وين بيتك؟ / حدّد بيتي / بعدين»; «يلا» when the door is already saved). A tap during
 * the flight lands at once (`onLand`); once landed, a tap on the map closes it like the drawing did.
 */
export function SunriseFrame({ name, zoneId, kitchens, onDone, door, landed, onLand, map }: WelcomeHomeProps & { door: { lat: number; lng: number } | null; landed: boolean; onLand: () => void; map: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const presets = useMotionPresets();
  const today = useSeason();
  const [hello, where] = welcomeLines(name, zoneId);
  const nearest = useMemo(() => nearestOpen(kitchens), [kitchens]);
  const [sheetH, setSheetH] = useState(0);

  // The landing buzz, as the pin settles (never on a quiet day).
  useEffect(() => {
    if (!landed) return;
    const id = setTimeout(() => {
      if (today.celebrations) theme.haptic('success');
    }, theme.reduceMotion ? 0 : PIN_LAND_MS);
    return () => clearTimeout(id);
    // Once, when it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);

  const tap = () => (landed ? onDone() : onLand());
  const setDoor = () => {
    onDone();
    router.push({ pathname: '/places/new', params: { label: 'home' } });
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={tap} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        {/* The map and the words are one tap area; the sheet sits beside it, so its buttons are never inside another. */}
        <Pressable testID="welcome-home" accessibilityRole="button" accessibilityLabel={t('home.welcome_skip_a11y')} onPress={tap} style={StyleSheet.absoluteFill}>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden' }]} testID="welcome-sunrise-map">
            {map}
            {/* The sky the words sit on: the page's cream fading into the map. */}
            <Svg width="100%" height={insets.top + SKY_H} style={{ position: 'absolute', left: 0, top: 0 }}>
              <Defs>
                <LinearGradient id="sunrise-sky" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={theme.colors.bg} stopOpacity={0.94} />
                  <Stop offset="0.45" stopColor={theme.colors.bg} stopOpacity={0.7} />
                  <Stop offset="1" stopColor={theme.colors.bg} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#sunrise-sky)" />
            </Svg>
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
        </Pressable>

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
      </View>
    </Modal>
  );
}
