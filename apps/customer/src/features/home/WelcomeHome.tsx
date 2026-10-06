import { useEffect, useMemo } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatRange } from '@driver/i18n';
import { Button, Icon, SketchScene, Text, useMotionPresets, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { useSeason } from '@/lib/use-season';
import { zoneName } from '@/lib/profile';
import type { RestaurantSummary } from './restaurant-summary';
import { PIN_LAND_MS, pinSpot, welcomeLines } from './welcome-home';

/** Pin marker size (px) and how far above its spot it starts falling. */
const PIN = 40;
const DROP_FROM = -140;

/**
 * «هلا بيك بحيّك» (joy h7, discovery D-15, idea 4-5): the end of sign-up, once. The J4 drawing of
 * Aziziyah, a pin dropping onto the person's zone, «هلا بيك أم علي، هذا حيّك: شارع 30», the nearest open
 * kitchen's real time to the door, and «يلا». A tap anywhere skips it. The pin lands with a success buzz
 * unless today is a quiet day; under reduced motion the frame is still (pin in place, no buzz delay).
 */
export function WelcomeHome({ name, zoneId, kitchens, onDone }: { name: string | null; zoneId: string | null; kitchens: readonly RestaurantSummary[] | undefined; onDone: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const presets = useMotionPresets();
  const today = useSeason();
  const spot = pinSpot(zoneId);
  const [hello, where] = welcomeLines(name, zoneId);
  // Real numbers only: the quickest open kitchen's own range to this door.
  const nearest = useMemo(
    () =>
      (kitchens ?? [])
        .filter((k) => k.open && k.etaMinMinutes !== null && k.etaMaxMinutes !== null)
        .sort((a, b) => (a.etaMinMinutes ?? 0) - (b.etaMinMinutes ?? 0))[0] ?? null,
    [kitchens],
  );

  const y = useSharedValue(theme.reduceMotion ? 0 : DROP_FROM);
  const shadow = useSharedValue(theme.reduceMotion ? 1 : 0.2);
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const shadowStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: shadow.value }], opacity: 0.25 * shadow.value }));

  useEffect(() => {
    if (!theme.reduceMotion) {
      y.value = withSpring(0, theme.motion.spring.settle);
      shadow.value = withTiming(1, { duration: PIN_LAND_MS });
    }
    // The landing buzz: celebratory, so never on a quiet day.
    const id = setTimeout(() => {
      if (today.celebrations) theme.haptic('success');
    }, theme.reduceMotion ? 0 : PIN_LAND_MS);
    return () => clearTimeout(id);
    // Once, when the moment opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onDone} statusBarTranslucent>
      <Pressable
        testID="welcome-home"
        accessibilityRole="button"
        accessibilityLabel={t('home.welcome_skip_a11y')}
        onPress={onDone}
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space[5],
          paddingTop: insets.top + theme.space[6],
          paddingBottom: Math.max(insets.bottom, theme.space[6]),
          paddingHorizontal: theme.space[6],
        }}
      >
        <View style={{ width: '100%', maxWidth: 360 }}>
          <SketchScene name="welcome" label={t('art.scene.welcome')} />
          {/* Physical left/top: the drawing is not mirrored in RTL, east stays on the right. */}
          <View pointerEvents="none" style={{ position: 'absolute', left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: PIN, height: PIN, marginLeft: -PIN / 2, marginTop: -PIN }}>
            <Animated.View style={[{ position: 'absolute', bottom: -4, left: PIN / 2 - 9, width: 18, height: 6, borderRadius: 9, backgroundColor: theme.colors.text }, shadowStyle]} />
            <Animated.View testID="welcome-home-pin" style={[{ width: PIN, height: PIN, alignItems: 'center', justifyContent: 'center' }, pinStyle]}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accent, borderWidth: 2, borderColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="home" size={16} color="onAccent" strokeWidth={2.4} />
              </View>
              <View style={{ width: 3, height: 8, backgroundColor: theme.colors.accent }} />
            </Animated.View>
          </View>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[2], maxWidth: 360 }}>
          <Animated.View entering={presets.fadeIn(PIN_LAND_MS)}>
            <Text variant="voice" face="voice" align="center" accessibilityRole="header">
              {t(hello, { name: name ?? '' })}
            </Text>
          </Animated.View>
          <Animated.View entering={presets.fadeIn(PIN_LAND_MS + 240)}>
            <Text variant="title" align="center" testID="welcome-home-zone">
              {t(where, { zone: zoneId ? zoneName(zoneId, locale) : '' })}
            </Text>
          </Animated.View>
          {nearest ? (
            <Animated.View entering={presets.fadeIn(PIN_LAND_MS + 480)}>
              <Text variant="body" color="textMuted" align="center" tabular>
                {t('home.welcome_eta', { range: formatRange(nearest.etaMinMinutes!, nearest.etaMaxMinutes!, locale) })}
              </Text>
            </Animated.View>
          ) : null}
        </View>
        <Animated.View entering={presets.panelIn(PIN_LAND_MS + 600)} style={{ width: '100%', maxWidth: 360 }}>
          <Button testID="welcome-home-go" label={t('home.welcome_go')} size="lg" fullWidth onPress={onDone} />
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
