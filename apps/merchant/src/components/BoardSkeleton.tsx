import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Skeleton, Text, useTheme } from '@driver/ui';
import { COUNTER } from '@/lib/counter';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { Wordmark } from './Wordmark';

/** How long the plain logo may show before the start says what it is doing (day-one d10). */
export const SPLASH_SLOW_MS = 2000;

/** True once `ms` have passed since the splash appeared. */
export function useSlowSplash(ms: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return slow;
}

/**
 * A slow start (day-one d10): the shape of the orders board — the dark status bar, the three lanes on a
 * tablet or the segmented lanes on a phone — with «دا نجيب طلباتك…» on top, so a cold start on a weak
 * line looks like loading, not like a frozen tablet. Fades in once (opacity only; none with reduce motion).
 */
export function BoardSkeleton() {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const lane = (key: string, bg: string) => (
    <View key={key} style={{ flex: 1, gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius['2xl'], backgroundColor: bg }}>
      <Skeleton width={110} height={28} radius={10} />
      <Skeleton height={190} radius={20} />
      <Skeleton height={130} radius={20} />
    </View>
  );
  return (
    <Animated.View testID="splash-board" entering={theme.reduceMotion ? undefined : FadeIn.duration(240)} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>
      <View style={{ height: wide ? 72 : 56, backgroundColor: COUNTER.date }} />
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: theme.space[4], padding: theme.space[5] }}>
          {lane('new', COUNTER.laneNew)}
          {lane('cooking', COUNTER.laneCooking)}
          {lane('ready', COUNTER.laneReady)}
        </View>
      ) : (
        <View style={{ flex: 1, gap: theme.space[4], padding: theme.space[4] }}>
          <Skeleton height={48} radius={14} />
          <Skeleton height={220} radius={20} />
          <Skeleton height={160} radius={20} />
        </View>
      )}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[6], paddingVertical: theme.space[5], borderRadius: theme.radius['2xl'], backgroundColor: theme.colors.bg, borderWidth: 1, borderColor: theme.colors.border }}>
          <Wordmark />
          <Text testID="splash-loading" variant="bodyStrong" color="textMuted" align="center">
            {t('merchant.startup.loading')}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}
