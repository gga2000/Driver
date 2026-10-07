import { Pressable, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import type { RideOfferCard } from '@driver/contracts';
import { pluralKey } from '@driver/i18n';
import { Avatar, Icon, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { CarLine, FeatureTags } from './DriverParts';
import { useNudgeOffer, useRideOffers } from './driver-queries';

/**
 * Ride ideas n3/n4 (screen E): while the ride searches, the drivers who were sent it, nearest first —
 * photo, ★ rating, the car with its colour, minutes away and the car's tags — each with «نبّهه», a soft
 * chime and «راكب ينتظرك» on his phone. Once per driver, only drivers who were sent this ride; the first
 * to accept takes it. Drivers who passed or whose offer ran out stay listed, quietly.
 */
export function OfferedDrivers({ orderId, onProfile }: { orderId: string; onProfile: (offerId: string) => void }) {
  const theme = useTheme();
  const t = useT();
  const offers = useRideOffers(orderId, true);
  const list = offers.data?.offers ?? null;
  const open = list?.filter((o) => o.state === 'sent' || o.state === 'seen') ?? [];
  if (!list) {
    return offers.isError ? null : (
      <View style={{ gap: theme.space[2] }} testID="ride-offers-loading">
        <Skeleton height={20} width="60%" />
        <Skeleton height={84} />
      </View>
    );
  }
  if (list.length === 0) return null;
  return (
    <View testID="ride-offers" style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.live }} />
        <Text variant="title" testID="ride-offers-title">
          {open.length > 0 ? t(pluralKey('ride.offers_title', open.length), { n: open.length }) : t('ride.offers_title_none')}
        </Text>
      </View>
      {list.map((o) => (
        <OfferRow key={o.offerId} orderId={orderId} offer={o} onProfile={() => onProfile(o.offerId)} />
      ))}
      <Text variant="caption" color="textMuted" testID="ride-offers-note">
        {t('ride.offers_note')}
      </Text>
    </View>
  );
}

function OfferRow({ orderId, offer, onProfile }: { orderId: string; offer: RideOfferCard; onProfile: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const nudge = useNudgeOffer(orderId);
  const name = offer.firstName ?? t('track.driver_fallback');
  const live = offer.state === 'sent' || offer.state === 'seen';
  const nudged = offer.nudgedAt !== null;
  const send = () => {
    theme.haptic('selection');
    nudge.mutate(
      { orderId, offerId: offer.offerId },
      {
        onSuccess: () => toast.show({ message: t('ride.nudge_sent', { name }), tone: 'success', icon: 'bell' }),
        onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'warning' }),
      },
    );
  };
  return (
    <Animated.View
      entering={theme.reduceMotion ? undefined : FadeIn.duration(220)}
      layout={theme.reduceMotion ? undefined : LinearTransition.duration(220)}
      testID={`ride-offer-${offer.offerId}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: offer.favourite && live ? theme.colors.accent : theme.colors.border,
        backgroundColor: theme.colors.surface,
        opacity: live ? 1 : 0.55,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('ride.profile_open', { name })}
        onPress={onProfile}
        testID={`ride-offer-open-${offer.offerId}`}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], opacity: pressed ? 0.7 : 1 })}
      >
        <View>
          <Avatar name={name} uri={apiPhoto(offer.photoUrl) ?? undefined} size={52} />
          {offer.favourite ? (
            <View style={{ position: 'absolute', bottom: -2, end: -2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent, borderWidth: 2, borderColor: theme.colors.surface }}>
              <Icon name="heart" size={11} color="onAccent" filled fillColor="onAccent" />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </Text>
            <Icon name="star" size={13} color="star" filled fillColor="star" />
            <Text variant="footnote" weight={700} tabular>
              {offer.rating !== null ? offer.rating.toFixed(1) : t('track.rating_new')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CarLine model={offer.vehicleModel} colour={offer.vehicleColour} fallback={t(offer.vehicleClass === 'tuktuk' ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi')} />
            {live && offer.minutesAway !== null ? (
              <Text variant="footnote" color="textMuted" tabular>
                {`· ${t('ride.offer_minutes', { n: offer.minutesAway })}`}
              </Text>
            ) : null}
          </View>
          <FeatureTags features={offer.features} max={3} testID={`ride-offer-tags-${offer.offerId}`} />
        </View>
      </Pressable>
      {live ? (
        nudged ? (
          <View testID={`ride-nudged-${offer.offerId}`} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: theme.space[2] }}>
            <Icon name="check" size={16} color="successText" strokeWidth={2.4} />
            <Text variant="label" weight={600} color="successText">
              {t('ride.nudged')}
            </Text>
          </View>
        ) : (
          <Pressable
            testID={`ride-nudge-${offer.offerId}`}
            accessibilityRole="button"
            accessibilityLabel={t('ride.nudge_a11y', { name })}
            accessibilityState={{ busy: nudge.isPending }}
            disabled={nudge.isPending}
            onPress={send}
            style={({ pressed }) => ({
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: theme.space[3],
              borderRadius: 22,
              backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surface,
              borderWidth: 1.5,
              borderColor: theme.colors.accent,
              opacity: nudge.isPending ? 0.6 : 1,
            })}
          >
            <Icon name="bell" size={16} color="accentText" strokeWidth={2.2} />
            <Text variant="label" weight={700} color="accentText">
              {t('ride.nudge')}
            </Text>
          </Pressable>
        )
      ) : (
        <Text variant="caption" color="textMuted" style={{ paddingHorizontal: theme.space[2] }}>
          {t(offer.state === 'declined' ? 'ride.offer_passed' : 'ride.offer_expired')}
        </Text>
      )}
    </Animated.View>
  );
}
