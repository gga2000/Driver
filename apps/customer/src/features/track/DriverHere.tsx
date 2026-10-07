import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import type { CourierCard } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { Avatar, Button, CallSoonButton, CountdownRing, Icon, PlateChip, Text, useTheme } from '@driver/ui';
import { LightButton, StartCode } from '@/features/ride/ArrivalParts';
import { FREE_WAIT_SEC, WaitCounter } from '@/features/ride/LiveParts';
import type { RideVertical } from '@/features/ride/logic';
import { rideSwatch } from '@/features/ride/swatch';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { apiPhoto } from '@/lib/photo';
import { CALLS_LIVE } from '@/features/chat/useMaskedCall';

/**
 * "عباس وصل" over the map when the driver is at the pickup (L-02, ride idea d5): the top in the
 * service's own colour (taxi yellow, tuktuk plum) with his face, the car in words, where he has
 * stopped and the plate large (the thing to find at the kerb); under it the free wait as a ring,
 * then "طالع هسة" (tells him in the chat), "اتصل", and at night «ضوّي الشاشة». The free wait is
 * already running, so this is the loudest card a ride shows.
 */
export function DriverHereCard({
  courier,
  vehicle,
  vertical,
  top,
  standsM,
  arrivedAt,
  waitPerIqd,
  now,
  clock,
  night,
  startCode,
  sent,
  sending,
  canReply,
  onComingOut,
  onCall,
  onLight,
  onClose,
  onHeight,
}: {
  courier: CourierCard;
  /** "باجاج · أحمر" (model and colour), or the vehicle class. */
  vehicle: string | null;
  vertical: RideVertical;
  top: number;
  /** Metres from the rider's pickup pin where he stopped (0 = on it); null when unknown. */
  standsM: number | null;
  /** When he pressed "وصلت" at the pickup: the free wait runs from here. */
  arrivedAt: Date | null;
  /** What each 5 minutes of paid wait costs after the free 3 (city pricing). */
  waitPerIqd: number;
  /** Server-corrected time. */
  now: number;
  clock: () => number;
  night: boolean;
  /** Night rides (s1): the 4 digits the driver needs before the trip can start. */
  startCode: string | null;
  /** "طالع هسة" already went: the button turns into a quiet confirmation. */
  sent: boolean;
  sending: boolean;
  /** The chat is open (the coming-out message goes through it). */
  canReply: boolean;
  onComingOut: () => void;
  onCall: () => void;
  onLight: () => void;
  onClose: () => void;
  /** The card's height, so the map frames the pickup and «وجهتك» below it (f1). */
  onHeight?: (h: number) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const name = courier.firstName ?? t('track.driver_fallback');
  const swatch = rideSwatch(vertical, theme.scheme);
  const free = arrivedAt ? now - arrivedAt.getTime() < FREE_WAIT_SEC * 1000 : false;
  return (
    <Animated.View
      testID="driver-here"
      onLayout={onHeight ? (e) => onHeight(e.nativeEvent.layout.height) : undefined}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      entering={theme.reduceMotion ? undefined : FadeInDown.springify().damping(18)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(theme.motion.duration.fast)}
      style={{
        position: 'absolute',
        top,
        left: theme.space[4],
        right: theme.space[4],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      <View testID="driver-here-top" style={{ backgroundColor: swatch.fill, padding: theme.space[4], paddingEnd: theme.space[2], gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar name={name} uri={apiPhoto(courier.photoUrl) ?? undefined} size={52} ring={Boolean(courier.verifiedTodayAt)} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title" style={{ color: swatch.on }} testID="driver-here-title">
              {t('ride.here_title', { name })}
            </Text>
            {vehicle ? (
              <Text variant="footnote" weight={600} style={{ color: swatch.on }} numberOfLines={1} testID="driver-here-vehicle">
                {vehicle}
              </Text>
            ) : null}
            {standsM !== null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="map-pin" size={14} strokeWidth={2.2} color={swatch.on} />
                <Text variant="footnote" style={{ color: swatch.on }} testID="driver-here-stands">
                  {standsM === 0 ? t('ride.stands_here') : t('ride.stands_away', { meters: standsM })}
                </Text>
              </View>
            ) : null}
          </View>
          {/* The plain close button, inked for the service colour it sits on. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('action.close')}
            onPress={onClose}
            testID="driver-here-close"
            style={({ pressed }) => ({ alignSelf: 'flex-start', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
          >
            <Icon name="x" size={22} color={swatch.on} strokeWidth={2} />
          </Pressable>
        </View>
        {courier.plate ? <PlateChip plate={courier.plate} accessibilityLabel={t('driver.plate')} size="xl" testID="driver-here-plate" /> : null}
      </View>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        {startCode ? <StartCode code={startCode} compact /> : null}
        {arrivedAt ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            {free ? (
              <CountdownRing mode="accept" startedAt={arrivedAt.getTime()} durationMs={FREE_WAIT_SEC * 1000} format="clock" urgentMs={30_000} size={64} strokeWidth={6} clock={clock} testID="driver-here-ring" />
            ) : (
              <WaitCounter arrivedAt={arrivedAt} now={now} />
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" weight={700} color={free ? 'successText' : 'warningText'}>
                {t(free ? 'ride.wait_free_label' : 'ride.free_wait_over')}
              </Text>
              <Text variant="footnote" color="textMuted">
                {t('ride.free_wait_then', { amount: amountParam(waitPerIqd) })}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {sent ? (
            <View style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }} testID="driver-here-sent">
              <Icon name="check" size={18} color="successText" strokeWidth={2.4} />
              <Text variant="label" weight={600} color="successText">
                {t('ride.coming_out_sent')}
              </Text>
            </View>
          ) : canReply ? (
            <Button label={t('ride.coming_out')} icon="user" loading={sending} onPress={onComingOut} style={{ flex: 1 }} testID="driver-here-coming-out" />
          ) : null}
          {CALLS_LIVE ? (
            <Button label={t('ride.call')} icon="phone" variant="secondary" onPress={onCall} style={sent || canReply ? undefined : { flex: 1 }} testID="driver-here-call" />
          ) : (
            <CallSoonButton locale={locale} onPress={onCall} style={sent || canReply ? undefined : { flex: 1 }} testID="driver-here-call" />
          )}
        </View>
        {night ? <LightButton onPress={onLight} /> : null}
      </View>
    </Animated.View>
  );
}
