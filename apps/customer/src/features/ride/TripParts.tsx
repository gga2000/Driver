import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Button, formatClock, Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { tripProgress, type RideVertical } from './logic';

/** Collapsed-sheet height the trip line adds (the line with its two ends, the words under it, the gap above). */
export const TRIP_PROGRESS_H = 60;

/**
 * Ride idea t1: in the collapsed sheet while riding — «باقي 6 دقيقة · توصل 11:55» over a line from
 * the pickup to the destination with the car riding along it (by time, from the one ETA). The line
 * holds its place when the ETA grows a little, so it never slides back.
 */
export function TripProgress({ orderId, startedAt, eta, now, vertical }: { orderId: string; startedAt: Date | null; eta: Date | null; now: number; vertical: RideVertical }) {
  const theme = useTheme();
  const t = useT();
  const floor = useRef<{ id: string; f: number }>({ id: orderId, f: 0 });
  if (floor.current.id !== orderId) floor.current = { id: orderId, f: 0 };
  const p = tripProgress({ startedAt, eta, now, floor: floor.current.f });
  if (p) floor.current.f = p.fraction;
  const w = useSharedValue(p?.fraction ?? 0);
  useEffect(() => {
    if (!p) return;
    w.value = theme.reduceMotion ? p.fraction : withTiming(p.fraction, { duration: 950, easing: Easing.linear });
  }, [p?.fraction, w, theme.reduceMotion, p]);
  const fill = useAnimatedStyle(() => ({ width: `${Math.round(w.value * 1000) / 10}%` }));
  const car = useAnimatedStyle(() => ({ start: `${Math.round(w.value * 1000) / 10}%` }));
  if (!p || !eta) return null;
  return (
    <View
      testID="ride-trip-progress"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('ride.trip_progress_a11y', { percent: Math.round(p.fraction * 100), minutes: p.leftMin })}
      style={{ gap: 6 }}
    >
      <View style={{ height: 22, justifyContent: 'center' }}>
        <View style={{ marginHorizontal: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.liveTint, overflow: 'hidden' }}>
          <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: theme.colors.live }, fill]} />
        </View>
        <View style={{ position: 'absolute', start: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.live }} />
        <View style={{ position: 'absolute', end: 0, width: 14, height: 14, borderRadius: 3, borderWidth: 3, borderColor: theme.colors.text, backgroundColor: theme.colors.surface }} />
        <Animated.View style={[{ position: 'absolute', marginStart: -11, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.live }, car]}>
          <Icon name={vertical === 'tuktuk' ? 'tuktuk' : 'car'} size={13} color="liveText" strokeWidth={2.2} />
        </Animated.View>
      </View>
      <Text variant="caption" weight={600} color="textMuted" tabular testID="ride-trip-left">
        {t('ride.trip_left', { minutes: p.leftMin, time: formatClock(eta) })}
      </Text>
    </View>
  );
}

/**
 * Ride idea t2: at the start of a night ride, a clear «شارك مشوارك ويا أهلك» in the sheet (the same
 * live link as the share button: opens without the app, stops when the ride ends). Once a link is
 * out it says so instead.
 */
export function NightShareCard({ shared, onShare }: { shared: boolean; onShare: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Animated.View
      testID="ride-night-share"
      entering={theme.reduceMotion ? undefined : FadeInDown.duration(240)}
      style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: shared ? theme.colors.successTint : theme.colors.accentTint }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}>
          <Icon name={shared ? 'check' : 'family'} size={20} color={shared ? 'successText' : 'accentText'} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" color={shared ? 'successText' : 'accentText'} testID="ride-night-share-title">
            {t(shared ? 'ride.night_share_on' : 'ride.night_share_title')}
          </Text>
          {shared ? null : (
            <Text variant="footnote" color="textMuted">
              {t('ride.night_share_body')}
            </Text>
          )}
        </View>
      </View>
      {shared ? null : <Button label={t('ride.night_share_button')} icon="share" fullWidth onPress={onShare} testID="ride-night-share-button" />}
    </Animated.View>
  );
}
