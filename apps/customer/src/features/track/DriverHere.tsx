import { View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import type { CourierCard } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { Avatar, Button, Icon, IconButton, PlateChip, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';

/**
 * "عباس وصل" over the map when the driver is at the pickup (L-02): his face, the plate large (the
 * thing to find at the kerb), the car in words, then "طالع هسة" (tells him in the chat) and "اتصل".
 * The free wait is already running, so this is the loudest card a ride shows.
 */
export function DriverHereCard({
  courier,
  vehicle,
  top,
  sent,
  sending,
  canReply,
  onComingOut,
  onCall,
  onClose,
}: {
  courier: CourierCard;
  /** "باجاج · أحمر" (model and colour), or the vehicle class. */
  vehicle: string | null;
  top: number;
  /** "طالع هسة" already went: the button turns into a quiet confirmation. */
  sent: boolean;
  sending: boolean;
  /** The chat is open (the coming-out message goes through it). */
  canReply: boolean;
  onComingOut: () => void;
  onCall: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const name = courier.firstName ?? t('track.driver_fallback');
  return (
    <Animated.View
      testID="driver-here"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      entering={theme.reduceMotion ? undefined : FadeInDown.springify().damping(18)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(theme.motion.duration.fast)}
      style={{
        position: 'absolute',
        top,
        left: theme.space[4],
        right: theme.space[4],
        gap: theme.space[3],
        padding: theme.space[4],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 2,
        borderColor: theme.colors.success,
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Avatar name={name} uri={apiPhoto(courier.photoUrl) ?? undefined} size={48} ring={Boolean(courier.verifiedTodayAt)} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title" testID="driver-here-title">
            {t('ride.here_title', { name })}
          </Text>
          {vehicle ? (
            <Text variant="footnote" color="textMuted" testID="driver-here-vehicle">
              {vehicle}
            </Text>
          ) : null}
        </View>
        <IconButton icon="x" variant="plain" accessibilityLabel={t('action.close')} onPress={onClose} testID="driver-here-close" />
      </View>
      {courier.plate ? <PlateChip plate={courier.plate} accessibilityLabel={t('driver.plate')} size="xl" testID="driver-here-plate" /> : null}
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
        <Button label={t('ride.call')} icon="phone" variant="secondary" onPress={onCall} style={sent || canReply ? undefined : { flex: 1 }} testID="driver-here-call" />
      </View>
    </Animated.View>
  );
}
