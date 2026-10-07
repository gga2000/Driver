import { View } from 'react-native';
import type { DriverProfile } from '@driver/contracts';
import { pluralKey } from '@driver/i18n';
import { Avatar, Button, Icon, ModalSheet, PlateChip, RetryState, retryKindFor, Skeleton, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { CarLine, FeatureTags } from './DriverParts';
import { useAvoidDriver, useDriverProfile } from './driver-queries';
import { memberSpan } from './logic';

/**
 * Ride idea n5 (screen F): a driver's profile on tap — his photo and name, three numbers (rating,
 * trips, on time), how long he has driven here, his car with its colour and plate (the plate only for
 * the driver of this ride), the car's tags, and what riders say about him most. `offerId` opens a
 * driver offered the searching ride; without it, the driver of this ride. After the ride, `onAvoid`
 * adds «ما أريده مرة ثانية» (s5).
 */
export function DriverProfileSheet({ orderId, offerId, visible, now, onClose, onAvoid }: { orderId: string; offerId: string | null; visible: boolean; now: number; onClose: () => void; onAvoid?: () => void }) {
  const t = useT();
  const profile = useDriverProfile(orderId, offerId, visible);
  const p = profile.data;
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={p ? (p.firstName ?? t('track.driver_fallback')) : t('ride.profile_title')}
      testID="driver-profile"
      footer={onAvoid && p ? <Button label={t('ride.avoid_button')} icon="x" variant="ghost" fullWidth onPress={onAvoid} testID="driver-profile-avoid" /> : undefined}
    >
      {p ? <ProfileBody p={p} now={now} /> : profile.isError ? <ProfileError onRetry={() => void profile.refetch()} error={profile.error} /> : <ProfileLoading />}
    </ModalSheet>
  );
}

function ProfileBody({ p, now }: { p: DriverProfile; now: number }) {
  const theme = useTheme();
  const t = useT();
  const name = p.firstName ?? t('track.driver_fallback');
  const span = memberSpan(p.memberSince, now);
  return (
    <View style={{ gap: theme.space[5], paddingBottom: theme.space[4] }} testID="driver-profile-body">
      <View style={{ alignItems: 'center', gap: theme.space[2] }}>
        <Avatar name={name} uri={apiPhoto(p.photoUrl) ?? undefined} size={96} />
        {span ? (
          <Text variant="footnote" color="textMuted" testID="driver-profile-since">
            {span.unit === 'new' ? t('ride.member_new') : t(pluralKey(span.unit === 'months' ? 'ride.member_months' : 'ride.member_years', span.n), { n: span.n })}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <Stat value={p.rating !== null ? p.rating.toFixed(1) : t('track.rating_new')} label={p.ratingCount > 0 ? t(pluralKey('ride.profile_ratings', p.ratingCount), { n: p.ratingCount }) : t('ride.profile_rating')} star testID="driver-profile-rating" />
        <Stat value={p.tripCount.toLocaleString('en-US')} label={t('ride.profile_trips')} testID="driver-profile-trips" />
        <Stat value={p.onTimePct !== null ? `${p.onTimePct}٪` : '—'} label={p.onTimePct !== null ? t('ride.profile_on_time') : t('ride.profile_on_time_new')} testID="driver-profile-ontime" />
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted">
          {t('ride.profile_car')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[3] }}>
          <CarLine model={p.vehicleModel} colour={p.vehicleColour} fallback={t(p.vehicleClass === 'tuktuk' ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi')} testID="driver-profile-car" />
          {p.plate ? <PlateChip plate={p.plate} accessibilityLabel={t('driver.plate')} size="md" /> : null}
        </View>
        <FeatureTags features={p.features} testID="driver-profile-tags" />
      </View>
      {p.compliments.length > 0 ? (
        <View style={{ gap: theme.space[2] }} testID="driver-profile-compliments">
          <Text variant="label" color="textMuted">
            {t('ride.profile_say')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {p.compliments.map((c) => (
              <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: theme.space[3], borderRadius: 18, backgroundColor: theme.colors.successTint }}>
                <Icon name="heart" size={14} color="successText" />
                <Text variant="label" color="successText">
                  {t(`compliment.${c.key}`)}
                </Text>
                <Text variant="caption" weight={700} color="successText" tabular>
                  {c.count}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ value, label, star = false, testID }: { value: string; label: string; star?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {star ? <Icon name="star" size={16} color="star" filled fillColor="star" /> : null}
        <Text variant="title" tabular>
          {value}
        </Text>
      </View>
      <Text variant="caption" color="textMuted" align="center">
        {label}
      </Text>
    </View>
  );
}

function ProfileLoading() {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[4], alignItems: 'center', paddingBottom: theme.space[4] }} testID="driver-profile-loading">
      <Skeleton width={96} height={96} radius={48} />
      <View style={{ flexDirection: 'row', gap: theme.space[2], alignSelf: 'stretch' }}>
        <Skeleton height={64} style={{ flex: 1 }} />
        <Skeleton height={64} style={{ flex: 1 }} />
        <Skeleton height={64} style={{ flex: 1 }} />
      </View>
      <Skeleton height={20} width="70%" />
    </View>
  );
}

function ProfileError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const net = useNetwork();
  const locale = useLocale();
  return <RetryState kind={retryKindFor({ net, error })} locale={locale} onRetry={onRetry} />;
}

/**
 * Ride idea s5: «ما أريده مرة ثانية» asks once, plainly — he isn't told, and the rider can undo it
 * from «سواقي» — then the server keeps him off this rider's rides (and off the favourites).
 */
export function AvoidDriverSheet({ orderId, name, visible, onClose }: { orderId: string; name: string; visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const avoid = useAvoidDriver();
  const confirm = () =>
    avoid.mutate(
      { orderId },
      {
        onSuccess: () => {
          toast.show({ message: t('ride.avoid_done', { name }), tone: 'neutral', icon: 'check' });
          onClose();
        },
        onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }),
      },
    );
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={t('ride.avoid_title', { name })}
      testID="avoid-sheet"
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button label={t('ride.avoid_confirm')} variant="destructive" fullWidth loading={avoid.isPending} onPress={confirm} testID="avoid-confirm" />
          <Button label={t('action.cancel')} variant="ghost" fullWidth onPress={onClose} testID="avoid-cancel" />
        </View>
      }
    >
      <Text color="textMuted" style={{ paddingBottom: theme.space[3] }}>
        {t('ride.avoid_body')}
      </Text>
    </ModalSheet>
  );
}
