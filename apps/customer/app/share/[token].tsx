import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MessageKey } from '@driver/i18n';
import type { SharedTrip, VehicleClass } from '@driver/contracts';
import { Avatar, EmptyState, formatClock, Icon, ltr, SketchScene, Skeleton, StatusPill, Text, useTheme, type IconName, type StatusTone } from '@driver/ui';
import { Wordmark } from '@/components/Wordmark';
import { useSharedTrip } from '@/features/share/queries';
import { ShareMap } from '@/features/share/ShareMap';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';

const STALE_SEC = 90;
const VEHICLE_KEY: Record<VehicleClass, MessageKey> = { bike: 'track.vehicle.bike', tuktuk: 'track.vehicle.tuktuk', car: 'track.vehicle.car', suv: 'track.vehicle.car', van: 'track.vehicle.car', intercity: 'track.vehicle.car' };
const STATUS: Record<SharedTrip['status'], { key: MessageKey; delivery: MessageKey; tone: StatusTone; live: boolean }> = {
  waiting: { key: 'share.status_waiting', delivery: 'share.delivery_waiting', tone: 'neutral', live: false },
  to_pickup: { key: 'share.status_to_pickup', delivery: 'share.delivery_to_pickup', tone: 'accent', live: true },
  on_trip: { key: 'share.status_on_trip', delivery: 'share.delivery_on_trip', tone: 'accent', live: true },
  arrived: { key: 'share.status_arrived', delivery: 'share.delivery_arrived', tone: 'success', live: false },
  ended: { key: 'share.ended_expired', delivery: 'share.ended_expired', tone: 'neutral', live: false },
};
const TITLE: Record<SharedTrip['subject'], MessageKey> = { ride: 'share.page_title', intercity: 'share.page_title_intercity', delivery: 'share.page_title_delivery' };

/**
 * Public share-trip page (`/share/<token>`, no sign-in; scoring & safety §5; maps program SP5c, and
 * deliveries in SP3c: the store's name and the courier instead of a ride). What the family sees, live: the driver's first name, the car and plate, the car moving on the map
 * inside the sharing window with the road to where it is heading (a pin, never an address in words)
 * and the ETA. Never a phone number or a full name — the API does not send them.
 */
export default function SharePage() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const { token = '' } = useLocalSearchParams<{ token: string }>();
  const q = useSharedTrip(token);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const trip = q.data;
  if (q.isError || (trip && trip.status === 'ended')) {
    const invalid = apiErrorCode(q.error) === 'share_link_invalid';
    // l8: a link that ran out after a safe arrival says so — the family's last view is reassurance.
    const safe = trip && trip.endedReason === 'expired' && trip.arrivedAt ? trip.arrivedAt : null;
    const title = safe
      ? t(trip?.subject === 'delivery' ? 'share.ended_safe_delivery' : 'share.ended_safe', { time: formatClock(safe) })
      : trip
      ? t(trip.endedReason === 'revoked' ? 'share.ended_revoked' : trip.endedReason === 'cancelled' ? (trip.subject === 'delivery' ? 'share.delivery_cancelled' : 'share.ended_cancelled') : 'share.ended_expired')
      : invalid
        ? t('share.invalid_title')
        : apiErrorMessage(q.error, t('error.network'), locale);
    return (
      <View testID="share-ended" style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top + theme.space[8], paddingHorizontal: theme.space[5] }}>
        <Stack.Screen options={{ headerShown: false, title: t('share.page_title') }} />
        <View style={{ width: '100%', maxWidth: 520, alignSelf: 'center', gap: theme.space[8] }}>
          <Wordmark size="md" />
          <EmptyState icon={safe ? 'check' : trip ? 'clock' : 'x'} art={safe && trip?.subject !== 'delivery' ? <SketchScene name="safe_arrival" vehicle={trip?.subject === 'intercity' ? 'minibus' : 'car'} /> : undefined} title={title} body={safe ? t('share.ended_safe_body') : trip ? t('share.ended_body') : invalid ? t('share.invalid_body') : undefined} />
          <Footer />
        </View>
      </View>
    );
  }

  const status = trip ? STATUS[trip.status] : null;
  const delivery = trip?.subject === 'delivery';
  const statusKey = status ? (delivery ? status.delivery : status.key) : null;
  const ageMin = trip?.position ? Math.floor((trip.position.ageSec + Math.max(0, (now - q.dataUpdatedAt) / 1000)) / 60) : 0;
  const stale = Boolean(trip?.position && trip.position.ageSec > STALE_SEC);
  const etaMin = trip?.eta ? Math.max(1, Math.round((trip.eta.getTime() - (trip.serverNow.getTime() + (now - q.dataUpdatedAt))) / 60_000)) : null;
  const vehicle = trip ? [trip.vehicleClass && trip.subject !== 'intercity' ? t(VEHICLE_KEY[trip.vehicleClass]) : null, trip.vehicleLabel].filter(Boolean).join(' · ') : '';

  return (
    <View testID="share-page" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false, title: t(trip ? TITLE[trip.subject] : 'share.page_title') }} />
      <View style={{ height: '50%' }}>
        {trip ? (
          <ShareMap token={token} trip={trip} stale={stale} live={q.live} minutes={trip.position && etaMin !== null && !stale ? t('track.map_minutes', { minutes: etaMin }) : null} />
        ) : (
          <View style={{ flex: 1, backgroundColor: theme.colors.surfaceSunken }} />
        )}
      </View>
      <View style={{ position: 'absolute', top: insets.top + theme.space[3], start: theme.space[4], paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
        <Wordmark size="md" />
      </View>
      <ScrollView
        style={{ flex: 1, marginTop: -24, backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius['2xl'], borderTopRightRadius: theme.radius['2xl'] }}
        contentContainerStyle={{ width: '100%', maxWidth: 560, alignSelf: 'center', padding: theme.space[5], paddingBottom: theme.space[10] + insets.bottom, gap: theme.space[5] }}
      >
        {!trip || !status ? (
          <View style={{ gap: theme.space[3] }}>
            <Skeleton width={120} height={22} />
            <Skeleton width="70%" height={28} />
            <Skeleton lines={3} />
          </View>
        ) : (
          <>
            <View style={{ gap: theme.space[2] }}>
              <Text variant="caption" color="textMuted">
                {t(TITLE[trip.subject])}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <View style={{ flex: 1, gap: theme.space[1] }}>
                  <StatusPill size="sm" tone={status.tone} live={status.live} label={status.live ? t('share.live') : t(statusKey ?? status.key)} style={{ alignSelf: 'flex-start' }} />
                  <Text variant="heading" testID="share-status">
                    {t(statusKey ?? status.key)}
                  </Text>
                  {trip.storeName ? (
                    <Text variant="label" color="textMuted" numberOfLines={1} testID="share-store">
                      {t('share.store', { name: trip.storeName })}
                    </Text>
                  ) : null}
                  {trip.route ? (
                    <Text variant="label" color="textMuted" testID="share-route">
                      {t('share.route', { from: t(`rajaa.city_${trip.route.fromCityId}` as MessageKey), to: t(`rajaa.city_${trip.route.toCityId}` as MessageKey) })}
                    </Text>
                  ) : null}
                </View>
                {trip.eta && etaMin !== null ? (
                  <View testID="share-eta" style={{ alignItems: 'center', paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint, minWidth: 92 }}>
                    <Text variant="caption" color="accentText" style={{ lineHeight: 16 }}>
                      {trip.status === 'to_pickup' && !delivery ? t('share.pickup_label') : t('share.eta_label')}
                    </Text>
                    <Text variant="amount" tabular color="accentText" style={{ lineHeight: 30 }}>
                      {formatClock(trip.eta)}
                    </Text>
                    <Text variant="caption" color="textMuted" tabular style={{ lineHeight: 16 }}>
                      {t('share.minutes', { minutes: etaMin })}
                    </Text>
                  </View>
                ) : null}
              </View>
              {trip.position && ageMin >= 2 ? (
                <Text variant="caption" color="warningText" testID="share-stale">
                  {t('share.last_fix', { minutes: ageMin })}
                </Text>
              ) : null}
            </View>

            <View style={{ borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4], gap: theme.space[4] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <Avatar name={trip.driverFirstName ?? t(delivery ? 'share.courier' : 'share.driver')} uri={apiPhoto(trip.driverPhotoUrl) ?? undefined} size={52} />
                <View style={{ flex: 1 }}>
                  <Text variant="caption" color="textMuted">
                    {t(delivery ? 'share.courier' : 'share.driver')}
                  </Text>
                  <Text variant="title" testID="share-driver">
                    {trip.driverFirstName ?? '—'}
                  </Text>
                </View>
              </View>
              <Line icon={trip.vehicleClass === 'tuktuk' ? 'tuktuk' : trip.vehicleClass === 'bike' ? 'bike' : 'car'} label={t(delivery ? 'share.vehicle_any' : 'share.vehicle')} value={vehicle || '—'} />
              {trip.plate ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                  <Icon name="receipt" size={20} color="textMuted" />
                  <Text variant="label" color="textMuted" style={{ flex: 1 }}>
                    {t('share.plate')}
                  </Text>
                  <View testID="share-plate" style={{ paddingHorizontal: theme.space[3], paddingVertical: 2, borderRadius: theme.radius.sm, borderWidth: 2, borderColor: theme.colors.text, backgroundColor: theme.colors.surface }}>
                    <Text variant="bodyStrong" tabular>
                      {ltr(trip.plate)}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start', backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <Icon name="shield" size={18} color="successText" />
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                {t('share.privacy')}
              </Text>
            </View>
            <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }} testID="share-expiry">
              {trip.status === 'arrived' && trip.expiresAt ? t('share.expires', { time: formatClock(trip.expiresAt) }) : t('share.expires_after')}
            </Text>
            <Footer />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Line({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <Icon name={icon} size={20} color="textMuted" />
      <Text variant="label" color="textMuted" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Text>
    </View>
  );
}

function Footer() {
  const t = useT();
  return (
    <Text variant="caption" color="textMuted" style={{ textAlign: 'center' }}>
      {t('share.footer')}
    </Text>
  );
}
