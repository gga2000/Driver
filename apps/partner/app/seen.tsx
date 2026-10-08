import { router, Stack, type Href } from 'expo-router';
import { View } from 'react-native';
import { LOUD_FEATURES, sortFeatures, type DriverProfile, type VehicleFeature } from '@driver/contracts';
import { pluralKey } from '@driver/i18n';
import { Avatar, Card, Icon, ListRow, RetryState, retryKindFor, Skeleton, Text, useLoadTimeout, useNetwork, useTheme, type IconName } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { memberSpan } from '@/features/account/logic';
import { CLASS_KEY } from '@/features/fleet/logic';
import { absoluteUrl } from '@/features/account/photo';
import { useMainPhoto, usePublicProfile } from '@/features/account/queries';
import { colourKey, featureKey, featuresSummary, hasFeatures } from '@/features/vehicle/logic';
import { useMyVehicle } from '@/features/vehicle/queries';
import { ColourDot } from '@/features/vehicle/VehicleParts';
import { useStatus } from '@/features/work/queries';
import { useLocale, useT } from '@/lib/i18n';

/**
 * «هيج يشوفك الزبون» (partner redesign r4): the very page a rider opens when they tap his photo
 * (`driverAccount.publicProfile`, built by the same server code as the rider's `tracking.driverProfile`)
 * drawn as the rider's sheet: photo, how long he has driven here, rating · trips · on time, the car
 * with its colour and only the features the car check confirmed, and what riders say most. Under it,
 * what would make the page better, each one tap away (photo, the car's features, every compliment).
 */
export default function Seen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const q = usePublicProfile();
  const photo = useMainPhoto().data;
  const canDrive = useStatus().data?.canDrive ?? false;
  const vehicle = useMyVehicle(canDrive).data;
  const [slow, restartSlow] = useLoadTimeout(q.data === undefined && !q.isError);
  const p = q.data;

  const tips: { key: string; icon: IconName; title: string; subtitle?: string; href: Href }[] = [];
  if (photo && !photo.approved) {
    tips.push(
      photo.state === 'pending'
        ? { key: 'photo', icon: 'clock', title: t('partner.seen_photo_waiting'), href: '/photo' }
        : { key: 'photo', icon: 'user', title: t('partner.seen_photo_missing'), subtitle: t('partner.seen_photo_missing_sub'), href: '/photo' },
    );
  }
  if (vehicle && hasFeatures(vehicle.vehicleClass)) {
    const f = featuresSummary(vehicle);
    if (f.pending.length > 0) tips.push({ key: 'features', icon: 'clock', title: t('partner.seen_features_waiting'), subtitle: f.pending.map((x) => t(featureKey(x))).join('، '), href: '/vehicle' });
    else if (f.confirmed.length === 0) tips.push({ key: 'features', icon: 'car', title: t('partner.seen_features_add'), subtitle: t('partner.seen_features_add_sub'), href: '/vehicle' });
  }
  tips.push({ key: 'words', icon: 'heart', title: t('partner.seen_words'), href: '/compliments' });

  return (
    <Screen testID="seen-screen" edges={['bottom']}>
      <Stack.Screen options={{ title: t('partner.seen_title') }} />
      <Text variant="body" color="textMuted">
        {t('partner.seen_intro')}
      </Text>
      {p ? (
        <RiderSheet p={p} />
      ) : q.isError || slow ? (
        <RetryState
          testID="seen-retry"
          kind={retryKindFor({ net, error: q.error, slow })}
          locale={locale}
          title={t('partner.seen_failed')}
          onRetry={() => {
            restartSlow();
            void q.refetch();
          }}
        />
      ) : (
        <View testID="seen-loading" style={{ gap: theme.space[3], alignItems: 'center' }}>
          <Skeleton width={96} height={96} radius={48} />
          <Skeleton height={72} />
          <Skeleton lines={3} />
        </View>
      )}
      {p ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[1] }}>
            {t('partner.seen_better')}
          </Text>
          <Card elevation={0} padding={0}>
            {tips.map((r, i) => (
              <ListRow key={r.key} testID={`seen-tip-${r.key}`} leading={r.icon} title={r.title} subtitle={r.subtitle} onPress={() => router.push(r.href)} divider={i < tips.length - 1} />
            ))}
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

/** The rider's sheet, as a phone sheet would draw it: the grab bar, his name, then the page. */
function RiderSheet({ p }: { p: DriverProfile }) {
  const theme = useTheme();
  const t = useT();
  const name = p.firstName ?? t('track.driver_fallback');
  const span = memberSpan(p.memberSince, Date.now());
  return (
    <View
      testID="seen-sheet"
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border,
        paddingHorizontal: theme.space[5],
        paddingTop: theme.space[3],
        paddingBottom: theme.space[5],
        gap: theme.space[5],
        shadowColor: theme.colors.shadow,
        shadowOpacity: 0.1,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
      }}
    >
      <View style={{ alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.borderStrong }} />
        <Text variant="title" weight={700} align="center">
          {name}
        </Text>
        <Avatar name={name} uri={p.photoUrl ? absoluteUrl(p.photoUrl) : undefined} size={96} />
        {span ? (
          <Text testID="seen-since" variant="footnote" color="textMuted" tabular>
            {span.unit === 'new' ? t('ride.member_new') : t(pluralKey(span.unit === 'months' ? 'ride.member_months' : 'ride.member_years', span.n), { n: span.n })}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <Stat testID="seen-rating" star value={p.rating !== null ? p.rating.toFixed(1) : t('track.rating_new')} label={p.ratingCount > 0 ? t(pluralKey('ride.profile_ratings', p.ratingCount), { n: p.ratingCount }) : t('ride.profile_rating')} />
        <Stat testID="seen-trips" value={p.tripCount.toLocaleString('en-US')} label={t('ride.profile_trips')} />
        <Stat testID="seen-ontime" value={p.onTimePct !== null ? `${p.onTimePct}٪` : '—'} label={p.onTimePct !== null ? t('ride.profile_on_time') : t('ride.profile_on_time_new')} />
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted">
          {t('ride.profile_car')}
        </Text>
        <View testID="seen-car" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          {p.vehicleColour ? <ColourDot colour={p.vehicleColour} size={16} /> : null}
          <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
            {[p.vehicleModel ?? t(CLASS_KEY[p.vehicleClass]), p.vehicleColour ? t(colourKey(p.vehicleColour)) : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Tags features={p.features} />
        <Text variant="caption" color="textMuted">
          {`${t('partner.seen_plate_note')} ${t('partner.seen_features_note')}`}
        </Text>
      </View>

      {p.compliments.length > 0 ? (
        <View testID="seen-compliments" style={{ gap: theme.space[2] }}>
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

/** The confirmed features: AC and heating first and bolder, in the partner palette (no blue). */
function Tags({ features }: { features: readonly VehicleFeature[] }) {
  const theme = useTheme();
  const t = useT();
  const shown = sortFeatures(features);
  if (shown.length === 0) return null;
  return (
    <View testID="seen-tags" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {shown.map((f) => {
        const loud = LOUD_FEATURES.includes(f);
        return (
          <View key={f} style={{ minHeight: 26, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 13, backgroundColor: loud ? theme.colors.accentTint : theme.colors.surfaceSunken }}>
            <Text variant="caption" weight={loud ? 700 : 500} color={loud ? 'accentText' : 'textMuted'}>
              {t(featureKey(f))}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
